import { describe, expect, it } from 'vitest';
import { arrangeRuns } from '../../../src/track/runOrder.ts';

interface Row {
  readonly group: string;
  readonly disc: number;
  readonly key: number;
  readonly tail: string;
}
const row = (group: string, key: number, tail: string, disc = 1): Row => ({
  group,
  disc,
  key,
  tail,
});
const names = (rows: readonly Row[]) =>
  rows.map((item) => `${item.group}${item.disc}:${item.key}${item.tail}`);
const same = (a: Row, b: Row) => a.key === b.key;

describe('arrangeRuns', () => {
  it('主键各不相同时，降序与整份倒过来一样', () => {
    const rows = [row('A', 1, 'a'), row('A', 2, 'a'), row('A', 3, 'a')];
    expect(arrangeRuns(rows, { same, descending: true })).toEqual([...rows].reverse());
  });

  it('同值的各项保持宿主给的次序，只有主键不同的段倒过来', () => {
    const rows = [
      row('A', 1, 'a'),
      row('A', 1, 'b'),
      row('A', 2, 'a'),
      row('A', 3, 'a'),
      row('A', 3, 'b'),
    ];
    expect(names(arrangeRuns(rows, { same, descending: true }))).toEqual([
      'A1:3a',
      'A1:3b',
      'A1:2a',
      'A1:1a',
      'A1:1b',
    ]);
  });

  it('没有 same 或没要降序时不动次序', () => {
    const rows = [row('A', 1, 'a'), row('A', 2, 'a')];
    expect(arrangeRuns(rows, { descending: true })).toEqual(rows);
    expect(arrangeRuns(rows, { same })).toEqual(rows);
  });

  it('组序反过来时组内次序不动', () => {
    const rows = [row('A', 1, 'a'), row('A', 2, 'a'), row('B', 1, 'a'), row('B', 2, 'a')];
    expect(
      names(arrangeRuns(rows, { groupOf: (item) => item.group, groupDescending: true })),
    ).toEqual(['B1:1a', 'B1:2a', 'A1:1a', 'A1:2a']);
  });

  it('分组时降序只在组内进行，组序不跟着倒', () => {
    const rows = [
      row('A', 1, 'a'),
      row('A', 2, 'a'),
      row('B', 1, 'a'),
      row('B', 1, 'b'),
      row('B', 2, 'a'),
    ];
    expect(
      names(arrangeRuns(rows, { groupOf: (item) => item.group, same, descending: true })),
    ).toEqual(['A1:2a', 'A1:1a', 'B1:2a', 'B1:1a', 'B1:1b']);
  });

  it('组序与降序可以同时反过来', () => {
    const rows = [row('A', 1, 'a'), row('A', 2, 'a'), row('B', 1, 'a'), row('B', 2, 'a')];
    expect(
      names(
        arrangeRuns(rows, {
          groupOf: (item) => item.group,
          groupDescending: true,
          same,
          descending: true,
        }),
      ),
    ).toEqual(['B1:2a', 'B1:1a', 'A1:2a', 'A1:1a']);
  });

  it('子段次序固定，降序不越过碟', () => {
    const rows = [
      row('A', 1, 'a', 1),
      row('A', 2, 'a', 1),
      row('A', 1, 'a', 2),
      row('A', 2, 'a', 2),
    ];
    expect(
      names(
        arrangeRuns(rows, {
          groupOf: (item) => item.group,
          cellOf: (item) => String(item.disc),
          same,
          descending: true,
        }),
      ),
    ).toEqual(['A1:2a', 'A1:1a', 'A2:2a', 'A2:1a']);
  });

  it('空入参返回空，不改入参', () => {
    expect(arrangeRuns([], { same, descending: true, groupDescending: true })).toEqual([]);
    const rows = [row('A', 1, 'a'), row('A', 2, 'a')];
    const before = [...rows];
    arrangeRuns(rows, { same, descending: true });
    expect(rows).toEqual(before);
  });
});
