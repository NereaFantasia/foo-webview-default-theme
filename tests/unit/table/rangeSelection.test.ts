import { describe, expect, it } from 'vitest';
import {
  addRange,
  clampRanges,
  containsRow,
  countRows,
  intersectRanges,
  NO_RANGES,
  rangesOfRows,
  removeRange,
  rowsOf,
  sameRanges,
  toggleRow,
  type SelectionRanges,
} from '../../../src/table/rangeSelection.ts';

const r = (...pairs: [number, number][]): SelectionRanges =>
  pairs.map(([start, end]) => ({ start, end }));

describe('区间集合', () => {
  it('并入时相交与相接的合成一段', () => {
    expect(addRange(r([0, 2], [5, 7]), 2, 5)).toEqual(r([0, 7]));
    expect(addRange(r([0, 2], [8, 9]), 4, 6)).toEqual(r([0, 2], [4, 6], [8, 9]));
    expect(addRange(r([3, 4]), 0, 10)).toEqual(r([0, 10]));
    expect(addRange(r([1, 2]), 5, 5)).toEqual(r([1, 2]));
  });

  it('逐行点出来的连续一段是一个区间', () => {
    let ranges = NO_RANGES;
    for (const at of [3, 1, 2, 0]) ranges = toggleRow(ranges, at);
    expect(ranges).toEqual(r([0, 4]));
  });

  it('去掉时跨边界的裁短，罩住的切成两段', () => {
    expect(removeRange(r([0, 10]), 3, 5)).toEqual(r([0, 3], [5, 10]));
    expect(removeRange(r([0, 4], [6, 9]), 3, 7)).toEqual(r([0, 3], [7, 9]));
  });

  it('二分判一行在不在里面', () => {
    const ranges = r([0, 2], [5, 7], [10, 11]);
    expect([0, 1, 2, 5, 6, 7, 10, 11].map((at) => containsRow(ranges, at))).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
    ]);
    expect(containsRow(NO_RANGES, 0)).toBe(false);
  });

  it('切换一行', () => {
    expect(toggleRow(r([0, 3]), 1)).toEqual(r([0, 1], [2, 3]));
    expect(toggleRow(r([0, 1]), 1)).toEqual(r([0, 2]));
  });

  it('计数、摊平、比较', () => {
    const ranges = r([0, 2], [5, 7]);
    expect(countRows(ranges)).toBe(4);
    expect(rowsOf(ranges)).toEqual([0, 1, 5, 6]);
    expect(sameRanges(ranges, r([0, 2], [5, 7]))).toBe(true);
    expect(sameRanges(ranges, r([0, 2]))).toBe(false);
  });

  it('从行序号收成区间：顺序任意、重复只算一次，负数与非整数不收', () => {
    expect(rangesOfRows([5, 1, 2, 2, 0, 7, 6])).toStrictEqual(r([0, 3], [5, 8]));
    expect(rangesOfRows([-1, 1.5, 3])).toStrictEqual(r([3, 4]));
    expect(rangesOfRows([])).toStrictEqual([]);
  });

  it('交集与裁到行数以内', () => {
    expect(intersectRanges(r([0, 10]), r([2, 4], [6, 8]))).toEqual(r([2, 4], [6, 8]));
    expect(intersectRanges(r([0, 3], [5, 9]), r([2, 6]))).toEqual(r([2, 3], [5, 6]));
    expect(clampRanges(r([0, 3], [5, 9], [12, 14]), 7)).toEqual(r([0, 3], [5, 7]));
    expect(clampRanges(r([0, 3], [5, 9]), 5)).toEqual(r([0, 3]));
    expect(clampRanges(r([0, 3]), 3)).toEqual(r([0, 3]));
    expect(clampRanges(r([0, 3]), 0)).toEqual([]);
  });
});
