/**
 * 选中行的区间集合：有序、互不相交、相邻即合并的 `[start, end)` 序列，纯函数。
 *
 * 存区间而不是逐行的集合：全选十万首时一个 `Set<number>` 要占好几 MB，而全选与 Shift 扩选本来就是
 * 连续的一段，只有 Ctrl 逐行点才会碎。坐标是表格的调用方给的行序号，不是显示位置：折叠、分组让显示位置
 * 整体重排时行序号不变，选中也就不丢。
 */

export interface SelectionRange {
  readonly start: number;
  /** 不含这一行。 */
  readonly end: number;
}

export type SelectionRanges = readonly SelectionRange[];

export const NO_RANGES: SelectionRanges = [];

/** 起点不大于 `target` 的最后一个区间的下标；没有则 -1。 */
function lastAtMost(ranges: SelectionRanges, target: number): number {
  let low = 0;
  let high = ranges.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (range && range.start <= target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** 并入 `[from, to)`。端点相接也合并，逐行 Ctrl 点出来的连续一段因此是一个区间。 */
export function addRange(ranges: SelectionRanges, from: number, to: number): SelectionRanges {
  if (to <= from) return ranges;
  const out: SelectionRange[] = [];
  let at = 0;
  for (; at < ranges.length; at += 1) {
    const range = ranges[at];
    if (!range || range.end >= from) break;
    out.push(range);
  }
  let start = from;
  let end = to;
  for (; at < ranges.length; at += 1) {
    const range = ranges[at];
    if (!range || range.start > end) break;
    start = Math.min(start, range.start);
    end = Math.max(end, range.end);
  }
  out.push({ start, end });
  for (; at < ranges.length; at += 1) {
    const range = ranges[at];
    if (range) out.push(range);
  }
  return out;
}

/** 去掉 `[from, to)`：跨在边界上的区间裁短，罩住它的区间切成两段。 */
export function removeRange(ranges: SelectionRanges, from: number, to: number): SelectionRanges {
  if (to <= from) return ranges;
  const out: SelectionRange[] = [];
  for (const range of ranges) {
    if (range.end <= from || range.start >= to) {
      out.push(range);
      continue;
    }
    if (range.start < from) out.push({ start: range.start, end: from });
    if (range.end > to) out.push({ start: to, end: range.end });
  }
  return out;
}

export function containsRow(ranges: SelectionRanges, at: number): boolean {
  const range = ranges[lastAtMost(ranges, at)];
  return range !== undefined && at < range.end;
}

/** 切换一行：选着就去掉，没选就加上。 */
export function toggleRow(ranges: SelectionRanges, at: number): SelectionRanges {
  return containsRow(ranges, at) ? removeRange(ranges, at, at + 1) : addRange(ranges, at, at + 1);
}

export function countRows(ranges: SelectionRanges): number {
  return ranges.reduce((total, range) => total + range.end - range.start, 0);
}

/** 两份区间集合的交集。 */
export function intersectRanges(left: SelectionRanges, right: SelectionRanges): SelectionRanges {
  const out: SelectionRange[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i];
    const b = right[j];
    if (!a || !b) break;
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (start < end) out.push({ start, end });
    if (a.end < b.end) i += 1;
    else j += 1;
  }
  return out;
}

/** 裁掉 `total` 及以后的部分：表变短时用。 */
export function clampRanges(ranges: SelectionRanges, total: number): SelectionRanges {
  const out: SelectionRange[] = [];
  for (const range of ranges) {
    if (range.start >= total) break;
    out.push(range.end <= total ? range : { start: range.start, end: total });
  }
  return out;
}

export function sameRanges(left: SelectionRanges, right: SelectionRanges): boolean {
  return (
    left.length === right.length &&
    left.every((range, at) => range.start === right[at]?.start && range.end === right[at]?.end)
  );
}

/** 从行序号收成区间集合：顺序任意，重复的只算一次，负数与非整数不收。宿主报的选中从这里进来。 */
export function rangesOfRows(rows: readonly number[]): SelectionRanges {
  const sorted = [...new Set(rows)]
    .filter((row) => Number.isInteger(row) && row >= 0)
    .sort((left, right) => left - right);
  const out: SelectionRange[] = [];
  let start = -1;
  let previous = -1;
  for (const at of sorted) {
    if (start < 0) {
      start = at;
    } else if (at !== previous + 1) {
      out.push({ start, end: previous + 1 });
      start = at;
    }
    previous = at;
  }
  if (start >= 0) out.push({ start, end: previous + 1 });
  return out;
}

/** 摊平成行序号，升序。代价与选中行数成正比，只在要把一批交出去时用；判一行选没选中用 `containsRow`。 */
export function rowsOf(ranges: SelectionRanges): number[] {
  const out: number[] = [];
  for (const range of ranges) {
    for (let at = range.start; at < range.end; at += 1) out.push(at);
  }
  return out;
}
