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
import type { ColumnId } from './columns/columns.ts';
import type { ColumnsModel } from './columns/columnsModel.ts';
import { containsRow } from './rangeSelection.ts';
import type { RowSelection } from './rowSelection.ts';
import {
  ariaRowsOf,
  type TableGroupItem,
  type TableItem,
  type TableArtwork,
  type TableTrack,
  type TableRowItem,
} from './tableItems.ts';
import styles from './TrackTable.module.css';
import { TrackTableGroup } from './TrackTableGroup.tsx';
import { TrackTableHeader, type TableSort } from './TrackTableHeader.tsx';
import { TrackTableRow, type PlayingState } from './TrackTableRow.tsx';
import { atom } from 'jotai/vanilla';
import { isTrackFieldId, type TrackFieldValues } from '../track/trackFields.ts';
import { ratingsVersionAtom } from '../track/trackRatings.ts';
import { useScrollFrame } from './useScrollFrame.ts';
import { useStickyViewport } from './useStickyViewport.ts';
import { useTrackTableInput, type TableCallbacks } from './useTrackTableInput.ts';
import { useTrackTableRows } from './useTrackTableRows.ts';
import { useTrackTableStyles } from './useTrackTableStyles.ts';
import { useTableGroupFold } from './useTableGroupFold.ts';
import { useTableHorizontalScroll } from './useTableHorizontalScroll.ts';

/** 表格交给调用方的句柄：离开页面时保存焦点行，回到页面时恢复，也供外部定位到某一行 */
export interface TrackTableHandle {
  /** 焦点所在条目的键。没有焦点时为 null */
  focusedKey(): string | null;
  /**
   * 将焦点置于指定键的条目上，不改变选中状态，也不滚动。
   * 表格尚未出现过焦点时，该条目即使不在条目流中也会被记录，待它出现后生效，因此数据晚到时先恢复焦点不会落空
   */
  setFocusKey(key: string | null): void;
  /**
   * 将焦点移到指定显示位，并滚动到视口中央。`select` 为真且该位是曲目行时，只选中该行。
   * 供定位正在播放的曲目、键入跳转等来自表格外部的定位使用。
   * 显示位按最近一次提交的条目流计算，调用方应在条目流更新后的 effect 中调用。
   * 该位既不是曲目行也不是分组头时不执行任何操作，并返回 false
   */
  reveal(index: number, select: boolean): boolean;
  /** 将 DOM 焦点转移到表格根元素，不滚动 */
  focus(): void;
  /** 行随之滚动的元素：表格自己的滚动区，或调用方传入的页面滚动元素。尚未挂载时为 null */
  scrollElement(): HTMLElement | null;
  horizontalScrollElement(): HTMLElement | null;
  /** 按条目键展开或折叠单个分组，沿用分组头的锚点与动效。条目已不在表内时不执行操作，并返回 false */
  toggleGroup(key: string): boolean;
}

/**
 * 表格行的评分戳，见 `TrackRatingsService.stamp`。可以整张表共用一个，也可以按行提供。
 * 分页取行的表，各页取回的时刻不同，因此戳按页各有一个。
 * 按行提供时必须是稳定的函数，并与条目流同时更换，它一变就会使整张表重新登记一次
 */
export type TableRatingStamp = number | ((item: TableRowItem) => number);

/** 调用方绘制分组头时收到的状态 */
export interface TableGroupState {
  readonly focused: boolean;
  /** 展开或折叠这一组，交由 `onToggleGroup` 处理。展开或折叠前后，该分组头在视口中的位置不变 */
  toggle(): void;
}

export interface TrackTableProps<G> extends TableCallbacks<G> {
  /** 列模型，创建在摆放表格的那一层，每张表使用独立的存档键 */
  readonly columns: ColumnsModel;
  /**
   * 条目流，按显示顺序排列。分组、折叠与垫位由调用方排好。
   * 必须记忆化：每更换一份，就会整份重新计算行位置，并重新登记整条流的评分
   */
  readonly items: readonly TableItem<G>[];
  /** 本地多选，按行序号记录。换了一批行或重新排序时由调用方清空 */
  readonly selection: RowSelection;
  /** 供读屏朗读的表名 */
  readonly label: string;
  /** 曲目行与空位的高度，CSS 像素 */
  readonly rowHeight: number;
  /** 分组头的高度，必须是稳定的函数。未提供时与曲目行同高 */
  readonly groupHeight?: (item: TableGroupItem<G>) => number;
  /**
   * 分组头里绘制的内容。表格只管理它的位置、焦点与展开折叠。
   * 其中的按钮应设置 `tabIndex={-1}`：鼠标点击按钮时焦点会交还表格，键盘操作可以接续
   */
  readonly renderGroup?: (item: TableGroupItem<G>, state: TableGroupState) => ReactNode;
  /** 上下方向键是否停留在分组头上 */
  readonly groupFocus?: boolean;
  /** 是否允许播放单个分组的展开折叠动画。批量操作与数据刷新仍直接到位 */
  readonly animateGroupFold?: (item: TableGroupItem<G>) => boolean;
  /**
   * 发出取这批行的请求之前，从评分服务取得的评分戳，见 `TrackRatingsService.stamp`。
   * 若等应答返回后才取，请求途中到达的评分事件会被行里的旧值覆盖。
   * 可以整张表共用一个，也可以按行提供，见 `TableRatingStamp`
   */
  readonly ratingStamp: TableRatingStamp;
  /**
   * 绘制出来的显示位区间 [start, end) 变化（含视口上下多绘制的几条），或条目流更换了一份时触发。
   * 分页取行的调用方据此取回缺失的页
   */
  readonly onRange?: (start: number, end: number) => void;
  /** 序号格的文字写法。曲目行按属性判断是否跳过重新渲染，因此必须是稳定的函数 */
  readonly numberText: (track: TableTrack) => string;
  /** 缩略图列里绘制的内容，`size` 是缩略图边长（CSS 像素，随行高变化）。未提供时这一列留空。同样必须是稳定的函数 */
  readonly artwork?: TableArtwork;
  readonly sort?: TableSort | null;
  /** 单击列头时按该列排序。未提供时，列头不能通过点击排序 */
  readonly onSort?: (column: ColumnId) => void;
  /** 行仍在取回中，读屏据此报告「忙」 */
  readonly loading?: boolean;
  /** 条目流为空时绘制在行的位置上。仍在取回与取回结果为空两种情形，由调用方分别绘制 */
  readonly empty?: ReactNode;
  /**
   * 行随之滚动的元素。指定后，表格按内容高度放在页面的滚动内容里，上方可以有其他内容，列头滚到顶部时吸附。
   * 若它是定位元素，表格与它之间不能再有滚动容器。尚未挂载时传入 null，不传（undefined）时表格撑满父容器并自行滚动
   */
  readonly scrollParent?: HTMLElement | null;
  /** 读写焦点行的句柄，离开页面时保存，回到页面时恢复 */
  readonly handle?: Ref<TrackTableHandle>;
}

type TableVariables = CSSProperties & Record<`--${string}`, string>;

/** 缩略图上下各留出的空白，CSS 像素，使相邻两行的缩略图不贴在一起 */
const ART_INSET = 4;

/**
 * 曲目表格：由 Fluent 的 `Table*` 绘制列头与单元格，在其上补充虚拟滚动、分组头、拖动换列与粘性视口。
 * 条目流、选中与列模型归调用方，表格管理焦点、键盘、滚动、播放标记与评分。所有位置都是显示位，即条目流的下标。
 *
 * 焦点只在表格根元素上，行不持有焦点，焦点行通过 `aria-activedescendant` 告知读屏。
 * 滚动区，以及行带里不在 Tab 次序上的元素（调用方绘制在分组头里、`tabIndex` 为 -1 的按钮）被鼠标点击时也会获得焦点。
 * 此时焦点交还给根元素，键盘仍可继续操作。
 *
 * 给定 `scrollParent` 时表格不自行滚动：按内容高度放在页面里，列头吸附在页面滚动元素的顶部。
 * 行的可见区从列头下方开始，行不会从列头底下透出，因此列头不需要铺底
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
  const horizontal = useRef<HTMLDivElement>(null);
  const columnState = useAtomValueRawSync(columns.state);
  useTableHorizontalScroll(root, horizontal);
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
  const fieldsOf = useTableFields(rows.visible, items, layout.cells, services.fields);
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
    horizontal,
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
  // 焦点以行为单位移动，读屏整行朗读。按 ARIA 的模式只有 treegrid 的行能获得焦点，所以平铺表也是只有一层的树。
  // 调用方接入了展开折叠，才向读屏报告展开状态
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
    '--table-content-width': layout.contentWidth,
    '--table-viewport-width':
      columnState.containerWidth > 0 ? `${columnState.containerWidth}px` : '100%',
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
                      fields={track ? fieldsOf(track) : undefined}
                      numberText={props.numberText}
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
      <div ref={horizontal} className={styles.horizontal} data-table-horizontal aria-hidden>
        <div className={styles['horizontal-content']} />
      </div>
    </Table>
  );
}

interface TableHandleSource<G> {
  readonly items: readonly TableItem<G>[];
  /** 焦点所在的显示位，没有焦点时为 -1 */
  readonly focus: number;
  readonly setFocusKey: (key: string | null) => void;
  /** 见 `TrackTableHandle.reveal`，必须是稳定的函数 */
  readonly reveal: (index: number, select: boolean) => boolean;
  readonly toggleGroup: (index: number) => void;
  /** 表格根元素，焦点只在它上面 */
  readonly root: RefObject<HTMLElement | null>;
  readonly scroller: RefObject<HTMLElement | null>;
  readonly horizontal: RefObject<HTMLElement | null>;
}

/** 把表格的焦点行交给调用方读写，读到的是调用时最近一次提交的条目流与焦点 */
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
      horizontalScrollElement: () => latest.current.horizontal.current,
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
  /** 这一行当前的星级。曲目尚未取到时为 0 */
  ratingOf(item: TableRowItem): number;
  canRate(item: TableRowItem): boolean;
}

/**
 * 表格的评分：评分的已知偏离一变就重新绘制，并登记条目流里已取到的曲目。
 * 一个文件里有多首曲目时，评分事件无法区分是哪一首，因此对登记着的曲目逐首补读。
 * 整张表一次登记，所以同一个文件落在两页里时，也能认出它不止一首
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

const NO_FIELDS_VERSION = atom(0);

/**
 * 按标签现算的列：屏幕上绘制的行缺少这些列的值时，由服务去取。
 * 值取回后服务的版本加一，表格重新绘制，行按新值显示。
 * 没有这些列显示，或装配层没有提供服务时，什么都不取
 */
function useTableFields<G>(
  visible: readonly VirtualItem[],
  items: readonly TableItem<G>[],
  cells: readonly ColumnId[],
  service: TableServices['fields'],
): (track: TableTrack) => TrackFieldValues | undefined {
  const version = useAtomValueRawSync(service?.version ?? NO_FIELDS_VERSION);
  const wanted = useMemo(() => cells.filter(isTrackFieldId), [cells]);
  useEffect(() => {
    if (!service || wanted.length === 0) return;
    service.ensure(
      visible.flatMap((virtual) => {
        const item = items[virtual.index];
        return item?.kind === 'row' && item.track ? [item.track] : [];
      }),
      wanted,
    );
  }, [service, visible, items, wanted, version]);
  return (track) => service?.valuesOf(track);
}

/**
 * 把表格容器的内容宽度报给列模型，供旧比例列的换算与封面上限使用。
 * 列头与曲目行按同一个盒对齐
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
 * 把此刻绘制出来的显示位区间 [start, end) 报给调用方，含视口上下多绘制的几条，分页取行的调用方据此取回缺失的页。
 * 区间变化，或条目流更换了一份时才报告：分组展开或折叠之后，同一段显示位对应的已是另一批行。什么都没绘制时不报告
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
