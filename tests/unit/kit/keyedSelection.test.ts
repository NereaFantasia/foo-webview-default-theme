import { describe, expect, it } from 'vitest';
import {
  activate,
  emptySelection,
  orderedSelection,
  pruneSelection,
  selectAll,
  menuSelection,
  type KeyedSelection,
} from '../../../src/kit/keyedSelection.ts';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const PLAIN = { ctrl: false, shift: false };
const CTRL = { ctrl: true, shift: false };
const SHIFT = { ctrl: false, shift: true };
const BOTH = { ctrl: true, shift: true };
const NONE = emptySelection<string>();
const keys = (selection: KeyedSelection<string>) => [...selection.selected].sort();

describe('activate', () => {
  it('不带修饰键只选它并落锚', () => {
    const next = activate(selectAll(ORDER), ORDER, 'c', PLAIN);
    expect(keys(next)).toEqual(['c']);
    expect(next.anchor).toEqual({ key: 'c', at: 2 });
  });

  it('Ctrl 切换这一个并把锚移过去', () => {
    const one = activate(NONE, ORDER, 'b', PLAIN);
    const two = activate(one, ORDER, 'd', CTRL);
    expect(keys(two)).toEqual(['b', 'd']);
    expect(two.anchor?.key).toBe('d');
    expect(keys(activate(two, ORDER, 'b', CTRL))).toEqual(['d']);
  });

  it('Shift 选锚到它的区间并替换；Ctrl+Shift 并进原选中；锚不动', () => {
    const start = activate(activate(NONE, ORDER, 'a', PLAIN), ORDER, 'e', CTRL);
    const range = activate(start, ORDER, 'c', SHIFT);
    expect(keys(range)).toEqual(['c', 'd', 'e']);
    expect(range.anchor?.key).toBe('e');
    const union = activate(activate(NONE, ORDER, 'a', PLAIN), ORDER, 'e', CTRL);
    expect(keys(activate(union, ORDER, 'd', BOTH))).toEqual(['a', 'd', 'e']);
  });

  it('还没有锚时 Shift 当没按', () => {
    expect(keys(activate(NONE, ORDER, 'c', SHIFT))).toEqual(['c']);
  });

  it('同一个键出现几次时区间按位置算、选中按键记', () => {
    const order = ['a', 'b', 'a', 'c'];
    const anchored = activate(NONE, order, 'a', PLAIN, 2);
    expect(anchored.anchor).toEqual({ key: 'a', at: 2 });
    expect(keys(activate(anchored, order, 'c', SHIFT))).toEqual(['a', 'c']);
    expect(orderedSelection(activate(anchored, order, 'b', SHIFT), order)).toEqual(['a', 'b']);
  });

  it('键不在列表里时不动', () => {
    const start = activate(NONE, ORDER, 'a', PLAIN);
    expect(activate(start, ORDER, 'zz', PLAIN)).toBe(start);
  });
});

describe('menuSelection', () => {
  const picked = activate(activate(NONE, ORDER, 'b', PLAIN), ORDER, 'd', CTRL);

  it('落在选中里：保持整批，作用于整个选择（列表顺序）', () => {
    const { selection, targets } = menuSelection(picked, ORDER, 'd');
    expect(selection).toBe(picked);
    expect(targets).toEqual(['b', 'd']);
  });

  it('落在选中外：改为只选它，只作用于它', () => {
    const { selection, targets } = menuSelection(picked, ORDER, 'e');
    expect(keys(selection)).toEqual(['e']);
    expect(selection.anchor).toEqual({ key: 'e', at: 4 });
    expect(targets).toEqual(['e']);
  });

  it('不在列表里：选中不动，只作用于它，不带上别的已选键', () => {
    const { selection, targets } = menuSelection(picked, ORDER, 'zz');
    expect(selection).toBe(picked);
    expect(targets).toEqual(['zz']);
  });
});

describe('pruneSelection 与 orderedSelection', () => {
  it('看不见的键去掉，锚看不见了撤掉；没变化原样返回', () => {
    const picked = selectAll(ORDER);
    expect(pruneSelection(picked, ORDER)).toBe(picked);
    const pruned = pruneSelection(picked, ['b', 'c']);
    expect(keys(pruned)).toEqual(['b', 'c']);
    expect(pruned.anchor).toBeNull();
  });

  it('按列表顺序排，副本只取第一次', () => {
    const picked = activate(activate(NONE, ORDER, 'd', PLAIN), ORDER, 'a', CTRL);
    expect(orderedSelection(picked, ['d', 'x', 'a', 'd'])).toEqual(['d', 'a']);
  });

  it('空列表全选是空的', () => {
    expect(selectAll<string>([])).toEqual(NONE);
  });
});
