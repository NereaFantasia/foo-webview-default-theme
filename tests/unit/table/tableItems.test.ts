import { describe, expect, it } from 'vitest';
import { ariaRowsOf, type TableItem } from '../../../src/table/tableItems.ts';

const row = (key: string, order: number): TableItem => ({
  kind: 'row',
  key,
  order,
  track: undefined,
});
const group = (key: string, level: number): TableItem => ({
  kind: 'group',
  key,
  level,
  collapsed: false,
  data: null,
});

describe('ariaRowsOf', () => {
  it('空位不算行：行数、行号都跳过它，列头占第 1 行', () => {
    const items = [
      group('a', 0),
      row('r0', 0),
      { kind: 'filler', key: 'f' } as const,
      group('b', 0),
    ];
    expect(ariaRowsOf(items)).toEqual({ count: 3, rowIndex: [2, 3, 0, 4], level: [1, 2, 0, 1] });
  });

  it('曲目行比上面最近的分组头深一层；不在分组里的是第 1 层', () => {
    const items = [row('loose', 0), group('s', 0), group('a', 1), row('r1', 1), group('s2', 0)];
    expect(ariaRowsOf(items).level).toEqual([1, 1, 2, 3, 1]);
  });
});
