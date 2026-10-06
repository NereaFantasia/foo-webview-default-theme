import {
  addRange,
  NO_RANGES,
  rangesOfRows,
  type SelectionRanges,
} from '../table/rangeSelection.ts';
import type { TableItem, TableRowItem } from '../table/tableItems.ts';
import { buildGroupLayout, type GroupRun } from './groups/groupLayout.ts';
import type { PlaylistHit } from './filter/playlistFilter.ts';
import type { PlaylistRow } from './playlistRow.ts';

/** 分组头带的：哪一级、组键、多少首，与组内第一行（组头的专辑、艺术家、年份从它取）。 */
export interface PlaylistGroupHead {
  /** 1 是一级组（专辑这类），2 是一级组里的子组（碟号这类）。 */
  readonly level: 1 | 2;
  readonly key: string;
  readonly count: number;
  /** 组内第一行的行号。 */
  readonly start: number;
  /** 所属一级游程的下标，取组封面按它。 */
  readonly runIndex: number;
  /** 组内第一行；那一页还没取到时为 undefined，组头先写组键。 */
  readonly row: PlaylistRow | undefined;
  /** 游程在重取：这一份可能已经对不上行，组头先画空的。 */
  readonly pending: boolean;
}

export type PlaylistItem = TableItem<PlaylistGroupHead>;

/**
 * `flat` 扁平；`grouped` 组头与行混排；`filtered` 只有过滤命中；`waiting` 分组开着、第一份游程还没到，
 * 先不画（画成扁平再换成分组，整张表会跳一下）。
 */
export type PlaylistViewShape = 'flat' | 'grouped' | 'filtered' | 'waiting';

export interface PlaylistViewInput {
  readonly total: number;
  /** 行服务缓存里的一行，不触发取数。 */
  rowAt(row: number): PlaylistRow | undefined;
  /** 这一行取数之前拿的评分戳；没取到时为 undefined。 */
  stampAt(row: number): number | undefined;
  /** 这一行取到了，而且取回之后宿主没有增删、重排过行，见 `PlaylistRowsService.currentAt`。 */
  currentAt(row: number): boolean;
  /** 生效的过滤；不在过滤态时为 null。 */
  readonly filter: { readonly hits: readonly PlaylistHit[]; readonly stamp: number } | null;
  /** 分组开着。 */
  readonly grouping: boolean;
  readonly runs: readonly GroupRun[];
  readonly collapsed: ReadonlySet<string>;
  /** 在等游程。 */
  readonly groupsLoading: boolean;
  /** 取不到游程、组太多，退回了扁平。 */
  readonly groupsFailed: boolean;
  /** 每组至少占几行（封面列开着时是封面的高折成的行数），不足的在组尾垫空位；0 是不垫。 */
  readonly countMinimum: number;
}

/**
 * 表格看到的那份条目流，与显示位和行号之间的换算。行序号（`order`）就是宿主的行号：三种形态里显示顺序都
 * 随行号递增，Shift 扩选按行号区间算，选中直接按行号推给宿主。
 */
export interface PlaylistView {
  readonly shape: PlaylistViewShape;
  readonly items: readonly PlaylistItem[];
  /** 评分戳按行取，交给表格的 `ratingStamp`。 */
  stampOf(item: TableRowItem): number;
  /** 显示位上那一行的行号；分组头、空位与越界答 -1。 */
  rowOf(display: number): number;
  /** 行号在显示空间里的位置；被折叠、被过滤挡住或越界答 -1。 */
  displayOf(row: number): number;
  /** 这一行落在哪个折起来的一级组里，答组键；不在折起的组里答 null。 */
  collapsedGroupOf(row: number): string | null;
  /** 这一行的行对象：过滤态取命中快照里的（它可能不在行服务的缓存里），其余取行服务缓存的。 */
  trackOf(row: number): PlaylistRow | undefined;
  /** Shift 扩选与全选只收这些行：过滤态是命中，分组态是没折起的，其余是整张。 */
  reachable(): SelectionRanges;
}

const rowItem = (row: number, track: PlaylistRow | undefined): PlaylistItem => ({
  kind: 'row',
  key: `r${row}`,
  order: row,
  track,
});

/**
 * 按行服务、分组与过滤此刻的样子排出条目流。过滤态不套用游程：游程是宿主对整张列表求的，起止是绝对行号，
 * 套到抽稀了的命中上每组的边界都不成立。
 *
 * 条目的键跨形态稳定，焦点按键记，开合、换形态之后仍跟着同一条：行是 `r` 加行号，组头是 `g` 加级别与组内
 * 第一行，空位是 `f` 加显示位。
 */
export function buildPlaylistView(input: PlaylistViewInput): PlaylistView {
  if (input.filter) return filteredView(input, input.filter);
  if (input.runs.length > 0) return groupedView(input);
  if (input.grouping && input.groupsLoading && !input.groupsFailed) return waitingView(input);
  return flatView(input);
}

function flatView(input: PlaylistViewInput): PlaylistView {
  const total = Math.max(0, input.total);
  const inRange = (at: number) => Number.isInteger(at) && at >= 0 && at < total;
  return {
    shape: 'flat',
    items: Array.from({ length: total }, (_, row) => rowItem(row, input.rowAt(row))),
    stampOf: (item) => input.stampAt(item.order) ?? 0,
    rowOf: (display) => (inRange(display) ? display : -1),
    displayOf: (row) => (inRange(row) ? row : -1),
    collapsedGroupOf: () => null,
    trackOf: (row) => input.rowAt(row),
    reachable: () => addRange(NO_RANGES, 0, total),
  };
}

function groupedView(input: PlaylistViewInput): PlaylistView {
  const { runs, collapsed } = input;
  const layout = buildGroupLayout(runs, collapsed, input.countMinimum);
  const pending = input.groupsLoading;
  // 行增删重排之后，游程与新页谁先到都有可能：先到的游程配上留着显示的旧行，行就落在别的组下面。
  // 两边都到齐之前，对不上的行画骨架，组头先写组键。
  const lined = (row: number) => (input.currentAt(row) ? input.rowAt(row) : undefined);
  const items: PlaylistItem[] = [];
  for (let display = 0; display < layout.displayTotal; display += 1) {
    const item = layout.itemAt(display);
    if (item?.kind === 'row') {
      items.push(rowItem(item.index, pending ? undefined : lined(item.index)));
    } else if (item?.kind === 'header') {
      const { level, key, count, start, runIndex } = item;
      items.push({
        kind: 'group',
        key: `g${level}:${start}`,
        level: level - 1,
        collapsed: item.collapsed,
        data: { level, key, count, start, runIndex, row: lined(start), pending },
      });
    } else {
      items.push({ kind: 'filler', key: `f${display}` });
    }
  }
  const runOf = (row: number): GroupRun | undefined => {
    let lo = 0;
    let hi = runs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const run = runs[mid];
      if (!run) break;
      if (row < run.start) hi = mid - 1;
      else if (row >= run.start + run.count) lo = mid + 1;
      else return run;
    }
    return undefined;
  };
  let reachable: SelectionRanges | null = null;
  return {
    shape: 'grouped',
    items,
    stampOf: (item) => input.stampAt(item.order) ?? 0,
    rowOf(display) {
      const item = items[display];
      return item?.kind === 'row' ? item.order : -1;
    },
    displayOf: (row) => layout.displayOf(row),
    collapsedGroupOf(row) {
      const run = Number.isInteger(row) ? runOf(row) : undefined;
      return run && collapsed.has(run.key) ? run.key : null;
    },
    trackOf: lined,
    reachable: () => (reachable ??= layout.rowsBetween(0, layout.displayTotal - 1)),
  };
}

function filteredView(
  input: PlaylistViewInput,
  filter: NonNullable<PlaylistViewInput['filter']>,
): PlaylistView {
  const { hits } = filter;
  const displayByRow = new Map(hits.map((hit, display) => [hit.index, display]));
  let reachable: SelectionRanges | null = null;
  return {
    shape: 'filtered',
    items: hits.map((hit) => rowItem(hit.index, hit.row)),
    stampOf: () => filter.stamp,
    rowOf: (display) => hits[display]?.index ?? -1,
    displayOf: (row) => displayByRow.get(row) ?? -1,
    collapsedGroupOf: () => null,
    trackOf(row) {
      const display = displayByRow.get(row);
      return display === undefined ? input.rowAt(row) : hits[display]?.row;
    },
    reachable: () => (reachable ??= rangesOfRows(hits.map((hit) => hit.index))),
  };
}

function waitingView(input: PlaylistViewInput): PlaylistView {
  return {
    shape: 'waiting',
    items: [],
    stampOf: (item) => input.stampAt(item.order) ?? 0,
    rowOf: () => -1,
    displayOf: () => -1,
    collapsedGroupOf: () => null,
    trackOf: (row) => input.rowAt(row),
    reachable: () => NO_RANGES,
  };
}
