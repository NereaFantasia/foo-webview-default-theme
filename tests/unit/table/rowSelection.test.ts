import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { rowsOf, type SelectionRanges } from '../../../src/table/rangeSelection.ts';
import { createRowSelection, type RowSelectionOptions } from '../../../src/table/rowSelection.ts';

const PLAIN = { ctrl: false, shift: false };
const CTRL = { ctrl: true, shift: false };
const SHIFT = { ctrl: false, shift: true };
const BOTH = { ctrl: true, shift: true };

function setup(options: RowSelectionOptions = { total: 10 }) {
  const store = createStore();
  const selection = createRowSelection(store, options);
  const rows = () => rowsOf(store.get(selection.state).ranges);
  const anchor = () => store.get(selection.state).anchor;
  return { store, selection, rows, anchor };
}

describe('选一段', () => {
  it('不带修饰键只选这一段，锚落在段首；越界的部分裁掉，空段不动', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(1, PLAIN);
    selection.selectSpan(4, 7, PLAIN);
    expect(rows()).toEqual([4, 5, 6]);
    expect(anchor()).toBe(4);
    selection.selectSpan(8, 20, PLAIN);
    expect(rows()).toEqual([8, 9]);
    selection.selectSpan(3, 3, PLAIN);
    expect(rows()).toEqual([8, 9]);
  });

  it('Ctrl 切换这一段：整段都已选中时去掉，否则并进来', () => {
    const { selection, rows } = setup();
    selection.activate(0, PLAIN);
    selection.selectSpan(2, 4, CTRL);
    expect(rows()).toEqual([0, 2, 3]);
    selection.activate(5, CTRL);
    selection.selectSpan(3, 6, CTRL);
    expect(rows()).toEqual([0, 2, 3, 4, 5]);
    selection.selectSpan(2, 6, CTRL);
    expect(rows()).toEqual([0]);
  });

  it('Shift 选锚到这一段远端的一整截，锚不动；Ctrl+Shift 并进原选中', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(8, PLAIN);
    selection.selectSpan(2, 4, SHIFT);
    expect(rows()).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(anchor()).toBe(8);
    selection.activate(0, CTRL);
    selection.selectSpan(1, 3, BOTH);
    expect(rows()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('单击与修饰键', () => {
  it('不带修饰键只选它并落锚', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(3, PLAIN);
    selection.activate(5, PLAIN);
    expect(rows()).toEqual([5]);
    expect(anchor()).toBe(5);
  });

  it('Ctrl 切换这一行并把锚移过来', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(1, PLAIN);
    selection.activate(4, CTRL);
    selection.activate(1, CTRL);
    expect(rows()).toEqual([4]);
    expect(anchor()).toBe(1);
  });

  it('Shift 选锚到它的一段并替换原选中，锚不动', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(8, PLAIN);
    selection.activate(2, CTRL);
    selection.activate(5, SHIFT);
    expect(rows()).toEqual([2, 3, 4, 5]);
    selection.activate(0, SHIFT);
    expect(rows()).toEqual([0, 1, 2]);
    expect(anchor()).toBe(2);
  });

  it('Ctrl+Shift 把一段并进原选中', () => {
    const { selection, rows } = setup();
    selection.activate(8, PLAIN);
    selection.activate(2, CTRL);
    selection.activate(4, BOTH);
    expect(rows()).toEqual([2, 3, 4, 8]);
  });

  it('还没有锚时 Shift 当没按；越界的行不动', () => {
    const { selection, rows } = setup();
    selection.activate(3, SHIFT);
    expect(rows()).toEqual([3]);
    selection.activate(10, PLAIN);
    selection.activate(-1, PLAIN);
    expect(rows()).toEqual([3]);
  });

  it('给了可达的行时，Shift 扩选只收它们', () => {
    // 行 3–6 在一张折叠起来的专辑里，看不见。
    const visible: SelectionRanges = [
      { start: 0, end: 3 },
      { start: 7, end: 10 },
    ];
    const { selection, rows } = setup({ total: 10, reachable: () => visible });
    selection.activate(1, PLAIN);
    selection.activate(8, SHIFT);
    expect(rows()).toEqual([1, 2, 7, 8]);
    selection.selectAll();
    expect(rows()).toEqual([0, 1, 2, 7, 8, 9]);
  });

  it('不给可达的行时，Shift 扩选连折叠里的行一起选', () => {
    const { selection, rows } = setup();
    selection.activate(1, PLAIN);
    selection.activate(8, SHIFT);
    expect(rows()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('右键与全选', () => {
  it('右键落在选中里：整批不变，作用于整批', () => {
    const { selection, rows } = setup();
    selection.activate(1, PLAIN);
    selection.activate(3, SHIFT);
    expect(rowsOf(selection.menuAt(2))).toEqual([1, 2, 3]);
    expect(rows()).toEqual([1, 2, 3]);
  });

  it('右键落在选中外：只选它、只作用于它', () => {
    const { selection, rows } = setup();
    selection.activate(1, PLAIN);
    selection.activate(3, SHIFT);
    expect(rowsOf(selection.menuAt(7))).toEqual([7]);
    expect(rows()).toEqual([7]);
    expect(selection.menuAt(20)).toEqual([]);
  });

  it('全选落锚在第一行；空表不动', () => {
    const { selection, rows, anchor } = setup({ total: 4 });
    selection.selectAll();
    expect(rows()).toEqual([0, 1, 2, 3]);
    expect(anchor()).toBe(0);
    const empty = setup({ total: 0 });
    empty.selection.selectAll();
    expect(empty.rows()).toEqual([]);
  });

  it('行数变短时裁掉越界的选中，锚越界就撤掉', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(2, PLAIN);
    selection.activate(8, SHIFT);
    selection.setTotal(5);
    expect(rows()).toEqual([2, 3, 4]);
    expect(anchor()).toBe(2);
    selection.activate(4, PLAIN);
    selection.setTotal(4);
    expect(anchor()).toBe(-1);
    expect(rows()).toEqual([]);
  });

  it('清空', () => {
    const { selection, rows, anchor } = setup();
    selection.activate(2, PLAIN);
    selection.clear();
    expect(rows()).toEqual([]);
    expect(anchor()).toBe(-1);
  });

  it('整份换成外面给的：越界的裁掉，锚留着；与此刻相同时不写', () => {
    const { store, selection, rows, anchor } = setup();
    selection.activate(3, PLAIN);
    selection.replace([
      { start: 5, end: 7 },
      { start: 9, end: 14 },
    ]);
    expect(rows()).toStrictEqual([5, 6, 9]);
    expect(anchor()).toBe(3);
    let writes = 0;
    store.sub(selection.state, () => {
      writes += 1;
    });
    selection.replace([
      { start: 5, end: 7 },
      { start: 9, end: 10 },
    ]);
    expect(writes).toBe(0);
  });
});
