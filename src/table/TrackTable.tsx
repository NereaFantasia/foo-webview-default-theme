import { mergeClasses, Table, TableBody } from '@fluentui/react-components';
import type { VirtualItem } from '@tanstack/react-virtual';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useTableServices, type TableServices } from './tableContext.ts';
import type { ColumnMenuExtras } from './columns/ColumnMenuExtras.tsx';
import type { ColumnId } from './columns/columns.ts';
import type { ColumnsModel } from './columns/columnsModel.ts';
import { containsRow } from './rangeSelection.ts';
import type { RowSelection } from './rowSelection.ts';
import {
  ariaRowsOf,
  type TableGroupItem,
  type TableItem,
  type TableArtwork,
  type TableLinks,
  type TableTrack,
  type TableRowItem,
} from './tableItems.ts';
import styles from './TrackTable.module.css';
import { TrackTableGroup } from './TrackTableGroup.tsx';
import { TrackTableHeader, type TableSort } from './TrackTableHeader.tsx';
import { TrackTableRow, type PlayingState } from './TrackTableRow.tsx';
import { ratingsVersionAtom } from '../track/trackRatings.ts';
import { useScrollFrame } from './useScrollFrame.ts';
import { useStickyViewport } from './useStickyViewport.ts';
import { useTrackTableInput, type TableCallbacks } from './useTrackTableInput.ts';
import { useTrackTableRows } from './useTrackTableRows.ts';
import { useTrackTableStyles } from './useTrackTableStyles.ts';
import { useTableGroupFold } from './useTableGroupFold.ts';

/** 表格交给调用方的句柄：离开页面时记下焦点行、回来时交还，从外面定位到一行。 */
export interface TrackTableHandle {
  /** 焦点所在那一条的键；没有焦点时为 null。 */
  focusedKey(): string | null;
  /**
   * 焦点落到这个键的条目上，不改选中、不滚动。表格还没见过焦点时，那一条不在条目流里也照样记着，
   * 等它出现才生效：数据晚到时先交还焦点不会落空。
   */
  setFocusKey(key: string | null): void;
  /**
   * 焦点落到这一位并滚到视口中间，`select` 为真且是曲目行时只选它；给定位正在播放、打字即跳这类从外面来的
   * 定位用。下标按最近一次提交的条目流算，调用方在条目流换过之后的 effect 里调；那一位不是曲目行或分组头时
   * 什么都不动，答假。
   */
  reveal(index: number, select: boolean): boolean;
  /** 把 DOM 焦点交给表格，不滚动。 */
  focus(): void;
  /** 行跟着滚的元素：表格自己的滚动区，或调用方给的页面滚动元素。还没挂上时为 null。 */
  scrollElement(): HTMLElement | null;
  /** 按条目键开合单个分组，沿用组头的锚点与动效；条目已不在表内时不操作，答假。 */
  toggleGroup(key: string): boolean;
}

/**
 * 表格行的评分戳，见 `TrackRatingsService.stamp`：整张表一个，或按行给（分页取的表各页取回的时刻不同，戳
 * 按页各有一个）。按行给时要是稳定的函数，与条目流一起换：它一变就整张表重新登记一次。
 */
export type TableRatingStamp = number | ((item: TableRowItem) => number);

/** 调用方画分组头时拿到的状态。 */
export interface TableGroupState {
  readonly focused: boolean;
  /** 开合这一组：交给 `onToggleGroup`，开合前后这个分组头在视口里的位置不变。 */
  toggle(): void;
}

export interface TrackTableProps<G> extends TableCallbacks<G> {
  /** 列模型，建在摆放表格的那一层，一张表一个存档键。 */
  readonly columns: ColumnsModel;
  /**
   * 条目流，按显示顺序。分组、折叠与垫位由调用方排好。要记忆化：每换一份就整份重算行位置，并重新登记整条流的
   * 评分。
   */
  readonly items: readonly TableItem<G>[];
  /** 本地多选，按行序号记；换了一批行或重新排序时由调用方清空。 */
  readonly selection: RowSelection;
  /** 读屏念的表名。 */
  readonly label: string;
  /** 曲目行与空位的高，CSS 像素。 */
  readonly rowHeight: number;
  /** 分组头的高；要给稳定的函数。不给时与曲目行同高。 */
  readonly groupHeight?: (item: TableGroupItem<G>) => number;
  /**
   * 分组头里画什么；表格只管它的位置、焦点与开合。里面的按钮设 `tabIndex={-1}`：鼠标点它时焦点交还表格，
   * 键盘接得上。
   */
  readonly renderGroup?: (item: TableGroupItem<G>, state: TableGroupState) => ReactNode;
  /** 上下键停不停在分组头上。 */
  readonly groupFocus?: boolean;
  /** 允许播放单个分组的开合动画；批量和数据刷新仍直接到位。 */
  readonly animateGroupFold?: (item: TableGroupItem<G>) => boolean;
  /**
   * 取这批行的请求发出之前从评分服务拿的戳，见 `TrackRatingsService.stamp`；应答回来后才拿的话，请求途中来的
   * 评分事件会被行里的旧值盖掉。整张表一个，或按行给，见 `TableRatingStamp`。
   */
  readonly ratingStamp: TableRatingStamp;
  /**
   * 画出来的显示位区间 [start, end) 变了（含视口上下多画的几条），或条目流换了一份。分页取行的调用方据此
   * 取缺的页。
   */
  readonly onRange?: (start: number, end: number) => void;
  /** 序号格的写法。曲目行按属性跳过重渲染，要给稳定的函数。 */
  readonly numberText: (track: TableTrack) => string;
  /** 画成链接的列；同样要给稳定的对象。 */
  readonly links?: TableLinks;
  /** 缩略图列里画什么，`size` 是缩略图边长（CSS 像素，随行高）；不给时这一列空着。同样要给稳定的函数。 */
  readonly artwork?: TableArtwork;
  readonly sort?: TableSort | null;
  /** 单击列头排序；不给时列头不能点着排序。 */
  readonly onSort?: (column: ColumnId) => void;
  /** 列头菜单里列勾选之外的几段（排序、分组）；不给时列头菜单只有列的勾选。 */
  readonly columnMenu?: ColumnMenuExtras;
  /** 行还在取，读屏据此报「忙」。 */
  readonly loading?: boolean;
  /** 条目流为空时画在行的位置上；还在取与取到空由调用方分开画。 */
  readonly empty?: ReactNode;
  /**
   * 行跟着这个元素滚：表格按内容高摆在页面的滚动内容里，上方可以有别的内容，列头滚到顶时吸住。它要是定位
   * 元素，表格与它之间不能再有滚动容器。挂上之前给 null；不给（undefined）时表格撑满父容器、自己滚。
   */
  readonly scrollParent?: HTMLElement | null;
  /** 读写焦点行的句柄，页面离开时记下、回来时交还。 */
  readonly handle?: Ref<TrackTableHandle>;
}

type TableVariables = CSSProperties & Record<`--${string}`, string>;

/** 缩略图上下各让出的 CSS 像素，相邻两行的缩略图不贴在一起。 */
const ART_INSET = 4;

/**
 * 曲目表格：Fluent 的 `Table*` 画列头与单元格，虚拟滚动、分组头、换列与粘性视口在它上面补。条目流、选中与
 * 列模型归调用方；表格管焦点、键盘、滚动、播放记号与评分。所有位置都是显示位（条目流的下标）。
 *
 * 焦点只在表格根元素上，行不拿焦点，焦点行靠 `aria-activedescendant` 告诉读屏。滚动区、以及行带里不在 Tab
 * 次序上的元素（调用方画在分组头里、`tabIndex` 为 -1 的按钮）被鼠标点到时也会拿到焦点，这时交还给根元素，
 * 键盘照样接得上。
 *
 * 给了 `scrollParent` 时表格不自己滚：按内容高摆在页面里，列头吸在页面滚动元素的顶上，行的可见区从列头下面
 * 开始，行不会从列头底下透出来，列头因此不用铺底。
 */
export function TrackTable<G>(props: TrackTableProps<G>) {
  const { columns, items, selection, rowHeight, renderGroup, scrollParent } = props;
  const classes = useTrackTableStyles();
  const services = useTableServices();
  const ratings = useTableRatings(items, props.ratingStamp, services.ratings);
  const t = useAtomValueRawSync(translateAtom);
  const layout = useAtomValueRawSync(columns.layout);
  const { ranges } = useAtomValueRawSync(selection.state);
  const playingKey = useAtomValueRawSync(services.playingKey);
  const audible = useAtomValueRawSync(services.audible);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const id = useId();
  const rowId = useCallback((index: number) => `${id}-${index}`, [id]);
  const sameHeight = useCallback(() => rowHeight, [rowHeight]);
  const groupHeight = props.groupHeight ?? sameHeight;
  const { scroller: scrolling, frame } = useScrollFrame(scrollParent, scroller, root);

  useColumnsContainer(scroller, columns);
  const rows = useTrackTableRows(scrolling, {
    items,
    rowHeight,
    groupHeight,
    coverWidth: layout.coverWidth,
    frame,
  });
  const fold = useTableGroupFold({
    root,
    scroller: scrolling,
    items,
    rowHeight,
    groupHeight,
    enabled: props.animateGroupFold,
  });
  const input = useTrackTableInput({
    ...props,
    onToggleGroup:
      props.onToggleGroup && ((index) => fold.run(index, () => props.onToggleGroup?.(index))),
    onSetGroup:
      props.onSetGroup &&
      ((index, collapsed) => fold.run(index, () => props.onSetGroup?.(index, collapsed))),
    ...frame,
    groupHeight,
    groupFocus: props.groupFocus ?? false,
    rows,
    scroller: scrolling,
    rowId,
    rate: (track, value) => void services.ratings.setRating(track, value),
  });
  useTableHandle(props.handle, {
    items,
    focus: input.focus,
    setFocusKey: input.setFocusKey,
    reveal: input.reveal,
    toggleGroup: input.groupHandlers.toggle,
    root,
    scroller: scrolling,
  });
  useStickyViewport(scrolling, viewport, strip, {
    ...frame,
    total: rows.totalSize,
    height: rows.viewportHeight,
  });
  useVisibleRange(rows.visible, items, props.onRange);
  useLayoutEffect(() => fold.commit());

  const playingOf = (track: TableTrack): PlayingState => {
    if (playingKey === '' || services.trackKey(track) !== playingKey) return 'none';
    return audible ? 'active' : 'paused';
  };
  // 焦点按行走，读屏整行念：照 ARIA 的模式只有 treegrid 的行能拿焦点，所以平铺表也是一棵只有一层的树。
  // 调用方接了开合才报展开态。
  const expandable = props.onToggleGroup !== undefined;
  const aria = useMemo(() => ariaRowsOf(items), [items]);
  const focusShown = rows.visible.some((virtual) => virtual.index === input.focus);
  const pageScroll = scrollParent !== undefined;
  const artSize = Math.max(rowHeight - ART_INSET * 2, 0);
  const variables: TableVariables = {
    '--table-header-template': layout.headerTemplate,
    '--table-row-template': layout.rowTemplate,
    '--table-row-left': `${layout.coverWidth}px`,
    '--table-row-height': `${rowHeight}px`,
    '--table-art-size': `${artSize}px`,
  };

  return (
    <Table
      ref={root}
      noNativeElements
      size="extra-small"
      role="treegrid"
      tabIndex={0}
      className={mergeClasses(classes.table, pageScroll && classes.pageScrollTable)}
      style={variables}
      aria-label={props.label}
      aria-rowcount={aria.count + 1}
      aria-colcount={layout.header.length}
      aria-multiselectable
      aria-busy={props.loading || undefined}
      aria-activedescendant={focusShown ? rowId(input.focus) : undefined}
      onKeyDown={input.onKeyDown}
      onKeyUp={input.onKeyUp}
    >
      <TrackTableHeader
        columns={columns}
        root={root}
        sort={props.sort}
        onSort={props.onSort}
        sticky={pageScroll}
        menu={props.columnMenu}
      />
      <div
        ref={scroller}
        className={styles.scroller}
        data-page-scroll={pageScroll || undefined}
        tabIndex={-1}
        onFocus={(event) => {
          const target = event.target;
          const loose = target instanceof HTMLElement && target.tabIndex < 0;
          if (target === event.currentTarget || loose) root.current?.focus({ preventScroll: true });
        }}
      >
        {items.length === 0 ? (
          props.empty !== undefined && (
            <div role="row" aria-rowindex={2} className={styles.empty}>
              <div role="gridcell" aria-colspan={layout.header.length} className={styles.empty}>
                {props.empty}
              </div>
            </div>
          )
        ) : (
          <TableBody className={classes.body} style={{ height: rows.totalSize }} data-table-body>
            <div
              ref={viewport}
              className={styles.viewport}
              role="none"
              style={{ top: frame.header }}
            >
              <div ref={strip} className={styles.strip} role="none">
                {rows.visible.map((virtual) => {
                  const item = items[virtual.index];
                  const index = virtual.index;
                  const focused = index === input.focus;
                  if (!item || item.kind === 'filler') return null;
                  if (item.kind === 'group') {
                    return (
                      <TrackTableGroup
                        key={item.key}
                        id={rowId(index)}
                        index={index}
                        rowIndex={aria.rowIndex[index] ?? 0}
                        item={item}
                        top={virtual.start - frame.margin}
                        height={virtual.size}
                        expandable={expandable}
                        columns={layout.header.length}
                        focused={focused}
                        handlers={input.groupHandlers}
                      >
                        {renderGroup?.(item, {
                          focused,
                          toggle: () => input.groupHandlers.toggle(index),
                        })}
                      </TrackTableGroup>
                    );
                  }
                  const track = item.track;
                  return (
                    <TrackTableRow
                      key={item.key}
                      id={rowId(index)}
                      index={index}
                      rowIndex={aria.rowIndex[index] ?? 0}
                      level={aria.level[index] ?? 1}
                      item={item}
                      top={virtual.start - frame.margin}
                      cells={layout.cells}
                      firstColumn={layout.header.length - layout.cells.length + 1}
                      selected={containsRow(ranges, item.order)}
                      focused={focused}
                      playing={track ? playingOf(track) : 'none'}
                      PlayingMark={services.PlayingMark}
                      rating={ratings.ratingOf(item)}
                      ratable={ratings.canRate(item)}
                      numberText={props.numberText}
                      links={props.links}
                      artwork={props.artwork}
                      artSize={artSize}
                      handlers={input.rowHandlers}
                      t={t}
                    />
                  );
                })}
              </div>
            </div>
          </TableBody>
        )}
      </div>
    </Table>
  );
}

interface TableHandleSource<G> {
  readonly items: readonly TableItem<G>[];
  /** 焦点所在的显示位，-1 是没有。 */
  readonly focus: number;
  readonly setFocusKey: (key: string | null) => void;
  /** 见 `TrackTableHandle.reveal`；要是稳定的函数。 */
  readonly reveal: (index: number, select: boolean) => boolean;
  readonly toggleGroup: (index: number) => void;
  /** 表格根元素：焦点只在它上面。 */
  readonly root: RefObject<HTMLElement | null>;
  readonly scroller: RefObject<HTMLElement | null>;
}

/** 把表格的焦点行交给调用方读写；读的是调用那一刻最近一次提交的条目流与焦点。 */
function useTableHandle<G>(
  handle: Ref<TrackTableHandle> | undefined,
  source: TableHandleSource<G>,
): void {
  const latest = useRef(source);
  useLayoutEffect(() => {
    latest.current = source;
  });
  const { setFocusKey, reveal } = source;
  useImperativeHandle(
    handle,
    () => ({
      focusedKey: () => latest.current.items[latest.current.focus]?.key ?? null,
      setFocusKey,
      reveal,
      focus: () => latest.current.root.current?.focus({ preventScroll: true }),
      scrollElement: () => latest.current.scroller.current,
      toggleGroup: (key: string) => {
        const index = latest.current.items.findIndex(
          (item) => item.kind === 'group' && item.key === key,
        );
        if (index < 0) return false;
        latest.current.toggleGroup(index);
        return true;
      },
    }),
    [setFocusKey, reveal],
  );
}

interface TableRatings {
  /** 这一行此刻几星；曲目还没取到时是 0。 */
  ratingOf(item: TableRowItem): number;
  canRate(item: TableRowItem): boolean;
}

/**
 * 表格的评分：评分的已知偏离一变就重画，并登记条目流里取到了的曲目。一个文件里有好几首时，评分事件分不出
 * 是哪一首，登记着的逐首补读；整张表一次登记，同一个文件落在两页里也认得出它不止一首。
 */
function useTableRatings<G>(
  items: readonly TableItem<G>[],
  stamp: TableRatingStamp,
  ratings: TableServices['ratings'],
): TableRatings {
  useAtomValueRawSync(ratingsVersionAtom);
  useEffect(() => {
    const rows = items.flatMap((item) =>
      item.kind === 'row' && item.track ? [{ item, track: item.track }] : [],
    );
    const stamps = typeof stamp === 'number' ? stamp : rows.map((row) => stamp(row.item));
    return ratings.watch(
      rows.map((row) => row.track),
      stamps,
    );
  }, [ratings, items, stamp]);
  const stampOf = (item: TableRowItem) => (typeof stamp === 'number' ? stamp : stamp(item));
  return {
    ratingOf: (item) => (item.track ? ratings.ratingOf(item.track, stampOf(item)) : 0),
    canRate: (item) => (item.track ? ratings.canRate(item.track) : false),
  };
}

/**
 * 把表格容器的内容宽报给列模型：窄档与封面列的上限都按它算，列模型自己不量 DOM。量的必须是列头与
 * 曲目行共用的那个盒，否则两边不在同一帧换档，栅格的轨道数与格子数对不上。
 */
function useColumnsContainer(element: RefObject<HTMLElement | null>, columns: ColumnsModel): void {
  useLayoutEffect(() => {
    const box = element.current;
    if (!box) return;
    const observer = new ResizeObserver((entries) => {
      columns.setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [element, columns]);
}

/**
 * 把此刻画出来的显示位区间 [start, end) 报给调用方，含视口上下多画的那几条；分页取行的调用方据此取缺的页。
 * 区间变了、或条目流换了一份才报：分组开合之后，同一段显示位对应的已是另一批行。什么都没画时不报。
 */
function useVisibleRange(
  visible: readonly VirtualItem[],
  items: readonly unknown[],
  onRange: ((start: number, end: number) => void) | undefined,
): void {
  const latest = useRef(onRange);
  useLayoutEffect(() => {
    latest.current = onRange;
  });
  const start = visible[0]?.index ?? 0;
  const end = (visible.at(-1)?.index ?? -1) + 1;
  useEffect(() => {
    if (end > start) latest.current?.(start, end);
  }, [start, end, items]);
}
