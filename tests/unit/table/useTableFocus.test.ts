import { describe, expect, it } from 'vitest';
import type { TableItem } from '../../../src/table/tableItems.ts';
import { fallbackFocusKey } from '../../../src/table/useTableFocus.ts';

const row = (key: string, order: number): TableItem => ({
  kind: 'row',
  key,
  order,
  track: undefined,
});
const group = (key: string, level: number, collapsed = false): TableItem => ({
  kind: 'group',
  key,
  level,
  collapsed,
  data: null,
});
const filler = (key: string): TableItem => ({ kind: 'filler', key });

describe('fallbackFocusKey', () => {
  it('平铺表里焦点那一行被删掉：落到原位置上的那一行，删的是最后一行就落到新的最后一行', () => {
    const before = [row('a', 0), row('b', 1), row('c', 2)];
    expect(fallbackFocusKey(before, 1, [row('a', 0), row('c', 1)])).toBe('c');
    expect(fallbackFocusKey(before, 2, [row('a', 0), row('b', 1)])).toBe('b');
    expect(fallbackFocusKey(before, 0, [])).toBeNull();
  });

  it('跟着分组收起的：退到外面最近一层还在、收着的分组头', () => {
    const before = [group('s', 0), group('a', 1), row('r0', 0), row('r1', 1), group('b', 1)];
    const albumShut = [group('s', 0), group('a', 1, true), group('b', 1)];
    expect(fallbackFocusKey(before, 3, albumShut)).toBe('a');
    const sectionShut = [group('s', 0, true)];
    expect(fallbackFocusKey(before, 3, sectionShut)).toBe('s');
  });

  it('组还开着、只是这一行被删掉：落到相邻的行，不退到分组头；空位跳过', () => {
    const before = [group('a', 0), row('r0', 0), row('r1', 1), filler('f0'), group('b', 0)];
    const after = [group('a', 0), row('r0', 0), filler('f0'), filler('f1'), group('b', 0)];
    expect(fallbackFocusKey(before, 2, after)).toBe('b');
    expect(fallbackFocusKey(before, 2, [group('a', 0), row('r0', 0), filler('f0')])).toBe('r0');
  });
});
