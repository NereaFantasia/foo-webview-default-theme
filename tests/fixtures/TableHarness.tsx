import { Provider, useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createTypeSearch, type TypeSearch } from '../../src/kit/typeSearch.ts';
import type { AppServices } from '../../src/app/services.ts';
import { useStore } from 'jotai/react';
import { CommandsContext } from '../../src/nav/useCommand.ts';
import { TableContext } from '../../src/table/tableContext.ts';
import { PlayingMark } from '../../src/track/PlayingMark.tsx';
import { trackKeyOf } from '../../src/playback/playbackContract.ts';
import { playingAudibleAtom, playingTrackKeyAtom } from '../../src/playback/playingTrack.ts';
import { discTrackText } from '../../src/table/cellText.ts';
import type { ColumnId } from '../../src/table/columns/columns.ts';
import { createColumnsModel, type ColumnsModel } from '../../src/table/columns/columnsModel.ts';
import { rowsOf } from '../../src/table/rangeSelection.ts';
import { createRowSelection } from '../../src/table/rowSelection.ts';
import type {
  TableGroupItem,
  TableItem,
  TableRowItem,
  TableTrack,
} from '../../src/table/tableItems.ts';
import {
  TrackTable,
  type TrackTableHandle,
  type TableRatingStamp,
} from '../../src/table/TrackTable.tsx';
import type { TableSort } from '../../src/table/TrackTableHeader.tsx';
import { ThemeRoot } from '../../src/theme/ThemeRoot.tsx';
import {
  buildTree,
  flatten,
  log,
  type HarnessGroup,
  type HarnessScenario,
} from './tableHarnessScenario.ts';
import { useHarnessMenu } from './useHarnessMenu.ts';

// 浏览器测试用的表格试验页：按地址栏参数（见 `HarnessScenario`）造一条条目流，扮演表格的调用方（开合、排序、
// 选中），把交给调用方的动作记进 `window.__tableLog`，测试在 Node 那边读出来断言。句柄的 `reveal` 挂在
// `window.__tableReveal` 上，测试从页面里直接调。

const ROW_HEIGHT = 36;
const GROUP_HEIGHT = 32;
/** 页面滚动场景里滚动盒的上内边距：吸顶的列头贴在内边距以内，表格要把它算进去。 */
const PAGE_PADDING = 16;

const numberText = (track: TableTrack) => discTrackText(track, 1);

/** 试验页的列：曲目表的基本八列，各份 e2e 按它们断言列头与列序。 */
const HARNESS_COLUMNS: readonly ColumnId[] = [
  'cover',
  'status',
  'number',
  'title',
  'artist',
  'album',
  'rating',
  'duration',
];

/** 评分戳：整张表一个，或按 `pageStamps` 行一页、各页一个。 */
function useHarnessStamp(
  scenario: HarnessScenario,
  total: number,
  stamp: () => number,
): TableRatingStamp {
  const size = scenario.pageStamps;
  const [stamps] = useState(() =>
    Array.from({ length: size > 0 ? Math.ceil(total / size) : 1 }, stamp),
  );
  const byPage = useCallback(
    (item: TableRowItem) => stamps[Math.floor(item.order / size)] ?? 0,
    [stamps, size],
  );
  return size > 0 ? byPage : (stamps[0] ?? 0);
}

/** 试验页自己做的打字即跳：从头找标题以这串字开头的第一首，找到经句柄落焦点并选中。 */
function useHarnessSearch(
  enabled: boolean,
  items: readonly TableItem<HarnessGroup>[],
  handle: RefObject<TrackTableHandle | null>,
): TypeSearch | undefined {
  const latest = useRef(items);
  useLayoutEffect(() => {
    latest.current = items;
  });
  const [search, setSearch] = useState<TypeSearch>();
  useEffect(() => {
    if (!enabled) return;
    const created = createTypeSearch(
      (text) => {
        const needle = text.toLocaleLowerCase();
        const at = latest.current.findIndex(
          (item) => item.kind === 'row' && item.track?.title.toLocaleLowerCase().startsWith(needle),
        );
        return at >= 0 ? at : undefined;
      },
      (index) => {
        log({ type: 'typeSearch', key: latest.current[index]?.key });
        handle.current?.reveal(index, true);
      },
    );
    setSearch(created);
    return () => created.dispose();
  }, [enabled, handle]);
  return search;
}

interface HarnessTableProps {
  readonly scenario: HarnessScenario;
  readonly columns: ColumnsModel;
  readonly ratingStamp: () => number;
  /** 页面滚动的场景里那个滚动盒；挂上之前是 null，表格自己滚的场景不给。 */
  readonly scrollParent?: HTMLElement | null;
}

function HarnessTable({ scenario, columns, scrollParent, ratingStamp }: HarnessTableProps) {
  const store = useStore();
  const layout = useAtomValueRawSync(columns.layout);
  const tree = useMemo(() => buildTree(scenario), [scenario]);
  const total = scenario.rows * Math.max(1, scenario.albums) * Math.max(1, scenario.sections);
  const [selection] = useState(() => createRowSelection(store, { total }));
  const stamp = useHarnessStamp(scenario, total, ratingStamp);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<TableSort | null>(null);
  const handle = useRef<TrackTableHandle>(null);
  const fillers = Math.ceil(layout.coverWidth / ROW_HEIGHT);
  const items = useMemo(() => flatten(tree, collapsed, fillers), [tree, collapsed, fillers]);
  const search = useHarnessSearch(scenario.asyncSearch, items, handle);
  const columnMenu = useHarnessMenu(scenario.menu, items, setCollapsed);
  useEffect(() => {
    Reflect.set(window, '__tableReveal', (index: number, select: boolean) =>
      handle.current ? handle.current.reveal(index, select) : false,
    );
  }, []);
  const setGroup = (key: string, shut: boolean) =>
    setCollapsed((now) => {
      const next = new Set(now);
      if (shut) next.add(key);
      else next.delete(key);
      return next;
    });
  const groupAt = (index: number) => {
    const item = items[index];
    return item?.kind === 'group' ? item : undefined;
  };
  const groupHeight = useCallback(() => GROUP_HEIGHT, []);
  const renderGroup = (item: TableGroupItem<HarnessGroup>, state: { toggle(): void }) => (
    <div data-group-label={item.data.label}>
      <button type="button" tabIndex={-1} onClick={() => state.toggle()}>
        {item.collapsed ? '+' : '-'}
      </button>
      {item.data.label}
    </div>
  );

  return (
    <TrackTable
      columns={columns}
      items={items}
      selection={selection}
      label="试验表"
      rowHeight={ROW_HEIGHT}
      groupHeight={groupHeight}
      renderGroup={renderGroup}
      groupFocus={scenario.groupFocus}
      ratingStamp={stamp}
      numberText={numberText}
      sort={sort}
      onSort={
        scenario.sortable
          ? (column) => {
              log({ type: 'sort', column });
              setSort((now) => ({ column, descending: now?.column === column && !now.descending }));
            }
          : undefined
      }
      onPlay={(index) => log({ type: 'play', key: items[index]?.key })}
      onMenu={(target, point) =>
        log({
          type: 'menu',
          key: items[target.index]?.key,
          rows: target.kind === 'rows' ? rowsOf(target.rows) : null,
          point,
        })
      }
      onGroupClick={(index, modifiers) =>
        log({ type: 'groupClick', key: items[index]?.key, ...modifiers })
      }
      onToggleGroup={
        scenario.albums > 0
          ? (index) => {
              const group = groupAt(index);
              if (group) setGroup(group.key, !group.collapsed);
            }
          : undefined
      }
      onSetGroup={(index, shut) => {
        const group = groupAt(index);
        if (group) setGroup(group.key, shut);
      }}
      onExpandSiblings={(index) => {
        const group = groupAt(index);
        const siblings = items.filter(
          (item) =>
            item.kind === 'group' &&
            item.level === group?.level &&
            item.data.parent === group.data.parent,
        );
        setCollapsed(
          (now) => new Set([...now].filter((key) => !siblings.some((s) => s.key === key))),
        );
      }}
      rank={
        scenario.typing
          ? (item, needle) =>
              item.kind === 'row' && item.track?.title.toLocaleLowerCase().startsWith(needle)
                ? 0
                : undefined
          : undefined
      }
      typeSearch={search}
      columnMenu={columnMenu}
      onRange={scenario.range ? (start, end) => log({ type: 'range', start, end }) : undefined}
      loading={scenario.loading}
      empty={<div data-empty>空表</div>}
      scrollParent={scrollParent}
      handle={handle}
    />
  );
}

/** 页面滚动的场景：一个定高的滚动盒，表格上方垫一块内容，表格按内容高摆在它下面。 */
function PageScrollBox({ scenario, columns, ratingStamp }: HarnessTableProps) {
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setScroll}
      data-harness-page
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        overflowY: 'auto',
        width: scenario.width,
        height: scenario.height,
        paddingTop: PAGE_PADDING,
        paddingBottom: scenario.below,
      }}
    >
      <div data-harness-above style={{ height: scenario.above }}>
        表格上方的内容
      </div>
      <HarnessTable
        scenario={scenario}
        columns={columns}
        scrollParent={scroll}
        ratingStamp={ratingStamp}
      />
    </div>
  );
}

export interface TableHarnessProps {
  readonly services: AppServices;
  readonly scenario: HarnessScenario;
}

/** 试验页：与正式页面同一套 store、服务与主题根，只把主窗换成一张定宽定高的表。 */
export function TableHarness({ services, scenario }: TableHarnessProps) {
  const table = useMemo(
    () => ({
      ratings: services.ratings,
      playingKey: playingTrackKeyAtom,
      audible: playingAudibleAtom,
      trackKey: trackKeyOf,
      PlayingMark,
    }),
    [services.ratings],
  );
  const [columns] = useState(() => {
    const offered: ColumnId[] = HARNESS_COLUMNS.filter((id) => scenario.cover || id !== 'cover');
    return createColumnsModel(services.store, { key: scenario.key, offered });
  });
  return (
    <Provider store={services.store}>
      <CommandsContext value={services.commands}>
        <TableContext value={table}>
          <ThemeRoot>
            {scenario.page ? (
              <PageScrollBox
                scenario={scenario}
                columns={columns}
                ratingStamp={services.ratings.stamp}
              />
            ) : (
              <div
                data-harness-box
                style={{ display: 'flex', width: scenario.width, height: scenario.height }}
              >
                <HarnessTable
                  scenario={scenario}
                  columns={columns}
                  ratingStamp={services.ratings.stamp}
                />
              </div>
            )}
          </ThemeRoot>
        </TableContext>
      </CommandsContext>
    </Provider>
  );
}
