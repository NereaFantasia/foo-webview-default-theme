import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  findTablePrefix,
  resolveTableKey,
  type KeyEntry,
  type TableKeyInput,
  type TableKeySource,
} from '../../../src/table/tableKeys.ts';

const group = (level: number, collapsed = false): KeyEntry => ({ kind: 'group', level, collapsed });
const ROW: KeyEntry = { kind: 'row' };
const FILLER: KeyEntry = { kind: 'filler' };

// 0 流派 A，1 专辑 a1，2–3 曲目，4 空位，5 专辑 a2（收起），6 流派 B，7 专辑 b1，8 曲目
const STREAM: KeyEntry[] = [
  group(0),
  group(1),
  ROW,
  ROW,
  FILLER,
  group(1, true),
  group(0),
  group(1),
  ROW,
];

function source(focus: number, overrides: Partial<TableKeySource> = {}): TableKeySource {
  return {
    count: STREAM.length,
    itemAt: (index) => STREAM[index],
    focus,
    pageSize: 4,
    groupFocus: true,
    ...overrides,
  };
}

const key = (name: string, modifiers: Partial<TableKeyInput> = {}): TableKeyInput => ({
  key: name,
  ...modifiers,
});
const PLAIN = { ctrl: false, shift: false };

describe('移动焦点', () => {
  it('上下键逐条走，分组头也停，空位跳过', () => {
    expect(resolveTableKey(source(1), key('ArrowDown'))).toEqual({
      kind: 'land',
      index: 2,
      modifiers: PLAIN,
    });
    expect(resolveTableKey(source(3), key('ArrowDown'))).toMatchObject({ index: 5 });
    expect(resolveTableKey(source(5), key('ArrowUp'))).toMatchObject({ index: 3 });
  });

  it('分组头不拿焦点时上下键跳过它们', () => {
    const skip = { groupFocus: false };
    expect(resolveTableKey(source(3, skip), key('ArrowDown'))).toMatchObject({ index: 8 });
    expect(resolveTableKey(source(-1, skip), key('ArrowUp'))).toMatchObject({ index: 2 });
  });

  it('还没有焦点时都落到第一条；到头时拦下但不动', () => {
    expect(resolveTableKey(source(-1), key('ArrowUp'))).toMatchObject({ index: 0 });
    expect(resolveTableKey(source(-1), key('PageDown'))).toMatchObject({ index: 0 });
    expect(resolveTableKey(source(0), key('ArrowUp'))).toEqual({ kind: 'block' });
    expect(resolveTableKey(source(8), key('End'))).toEqual({ kind: 'block' });
  });

  it('翻页跳一屏，落在空位上往前找', () => {
    expect(resolveTableKey(source(0), key('PageDown'))).toMatchObject({ index: 5 });
    expect(resolveTableKey(source(8), key('PageUp'))).toMatchObject({ index: 3 });
    expect(resolveTableKey(source(6), key('PageDown'))).toMatchObject({ index: 8 });
  });

  it('条目流以空位收尾时，翻页落在空位上就往回找', () => {
    const tail: KeyEntry[] = [ROW, ROW, FILLER];
    const short = source(0, { count: tail.length, itemAt: (index) => tail[index] });
    expect(resolveTableKey(short, key('PageDown'))).toMatchObject({ kind: 'land', index: 1 });
  });

  it('Home、End 到首尾；修饰键原样带出去', () => {
    expect(resolveTableKey(source(5), key('Home', { shiftKey: true }))).toEqual({
      kind: 'land',
      index: 0,
      modifiers: { ctrl: false, shift: true },
    });
    expect(resolveTableKey(source(2), key('End', { ctrlKey: true }))).toEqual({
      kind: 'land',
      index: 8,
      modifiers: { ctrl: true, shift: false },
    });
  });

  it('Alt 组合一律不接：留给后退、前进', () => {
    expect(resolveTableKey(source(2), key('ArrowDown', { altKey: true }))).toEqual({
      kind: 'none',
    });
    expect(resolveTableKey(source(2), key('ArrowLeft', { altKey: true }))).toEqual({
      kind: 'none',
    });
  });
});

describe('分组头', () => {
  it('回车与空格开合', () => {
    expect(resolveTableKey(source(1), key('Enter'))).toEqual({ kind: 'toggleGroup', index: 1 });
    expect(resolveTableKey(source(5), key(' '))).toEqual({ kind: 'toggleGroup', index: 5 });
  });

  it('← 收起，已收起就去上一层；→ 展开，已展开就进到下面第一条', () => {
    expect(resolveTableKey(source(1), key('ArrowLeft'))).toEqual({
      kind: 'setGroup',
      index: 1,
      collapsed: true,
    });
    expect(resolveTableKey(source(5), key('ArrowLeft'))).toMatchObject({ kind: 'land', index: 0 });
    expect(resolveTableKey(source(5), key('ArrowRight'))).toEqual({
      kind: 'setGroup',
      index: 5,
      collapsed: false,
    });
    expect(resolveTableKey(source(1), key('ArrowRight'))).toMatchObject({ kind: 'land', index: 2 });
  });

  it('曲目行上的 ← 回到它的分组头，→ 不接', () => {
    expect(resolveTableKey(source(3), key('ArrowLeft'))).toMatchObject({ kind: 'land', index: 1 });
    expect(resolveTableKey(source(3), key('ArrowRight'))).toEqual({ kind: 'none' });
  });

  it('分组头不拿焦点时：曲目行上的 ← 不回分组头，分组头上的 ← → 照样开合', () => {
    const skip = { groupFocus: false };
    expect(resolveTableKey(source(3, skip), key('ArrowLeft'))).toEqual({ kind: 'none' });
    expect(resolveTableKey(source(1, skip), key('ArrowLeft'))).toEqual({
      kind: 'setGroup',
      index: 1,
      collapsed: true,
    });
    expect(resolveTableKey(source(5, skip), key('ArrowRight'))).toEqual({
      kind: 'setGroup',
      index: 5,
      collapsed: false,
    });
  });

  it('* 展开同级，只在分组头上', () => {
    expect(resolveTableKey(source(7), key('*', { shiftKey: true }))).toEqual({
      kind: 'expandSiblings',
      index: 7,
    });
    expect(resolveTableKey(source(8), key('*'))).toEqual({ kind: 'none' });
  });
});

describe('曲目行与其他键', () => {
  it('回车播放；空格按修饰键选中焦点行', () => {
    expect(resolveTableKey(source(2), key('Enter'))).toEqual({ kind: 'play', index: 2 });
    expect(resolveTableKey(source(2), key(' ', { ctrlKey: true }))).toEqual({
      kind: 'land',
      index: 2,
      modifiers: { ctrl: true, shift: false },
    });
  });

  it('Ctrl+A 全选；Shift+F10 开焦点那一条的菜单，没有焦点时只拦下缺省', () => {
    expect(resolveTableKey(source(-1), key('a', { ctrlKey: true }))).toEqual({
      kind: 'selectAll',
    });
    expect(resolveTableKey(source(2), key('F10', { shiftKey: true }))).toEqual({
      kind: 'menu',
      index: 2,
    });
    expect(resolveTableKey(source(-1), key('F10', { shiftKey: true }))).toEqual({ kind: 'block' });
  });

  it('不认的键不接', () => {
    expect(resolveTableKey(source(2), key('x'))).toEqual({ kind: 'none' });
    expect(resolveTableKey(source(2), key('Escape'))).toEqual({ kind: 'none' });
  });
});

describe('打字即跳', () => {
  const entries = { count: STREAM.length, itemAt: (index: number) => STREAM[index] };
  const names = [
    'Jazz',
    'Blue Train',
    'Blue in Green',
    'Bye',
    '',
    'Kind of Blue',
    'Rock',
    'Ok',
    'Brr',
  ];
  const byName = (index: number, needle: string) =>
    names[index]?.toLocaleLowerCase().startsWith(needle) ? 0 : undefined;

  it('外面套着的分组头由外到里', () => {
    expect(ancestorsOf(entries, 3)).toEqual([0, 1]);
    expect(ancestorsOf(entries, 7)).toEqual([6]);
    expect(ancestorsOf(entries, 0)).toEqual([]);
  });

  it('从焦点（含）往下找，到头绕回，大小写不论', () => {
    expect(findTablePrefix(entries, 6, 'b', byName)).toBe(8);
    expect(findTablePrefix(entries, 8, 'JA', byName)).toBe(0);
    expect(findTablePrefix(entries, -1, 'rock', byName)).toBe(6);
    expect(findTablePrefix(entries, 2, 'zz', byName)).toBeUndefined();
  });

  it('焦点外面的分组头算焦点自己：它仍命中就回到它，不跳到后面同前缀的一条', () => {
    expect(findTablePrefix(entries, 1, 'blue t', byName)).toBe(1);
    expect(findTablePrefix(entries, 2, 'blue', byName)).toBe(1);
    expect(findTablePrefix(entries, 2, 'blue i', byName)).toBe(2);
  });

  it('空位不参与匹配', () => {
    expect(findTablePrefix(entries, 2, 'x', (index) => (index === 4 ? 0 : undefined))).toBe(
      undefined,
    );
  });

  it('分数小的赢，同分取焦点之后最近的', () => {
    const ranked = (index: number, needle: string) =>
      names[index]?.toLocaleLowerCase().startsWith(needle) ? (index === 8 ? 0 : 1) : undefined;
    expect(findTablePrefix(entries, 2, 'b', ranked)).toBe(8);
  });
});
