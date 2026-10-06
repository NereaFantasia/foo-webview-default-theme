// 按一张有序键列表的多选，纯函数。语义与表格、树同一套：不带修饰键只选它并落锚；Ctrl 切换这一个，
// 锚移到它；Shift 选锚到它的区间（替换原选中）；Ctrl+Shift 把区间并进原选中；还没有锚时 Shift 当没按。
//
// 同一个键可以在列表里出现几次（封面墙艺术家档的副本）：区间按位置算、选中按键记，所以点哪一块副本
// 都是同一张的选中态。知道点中的是第几个位置就传 `at`，不传按键第一次出现的位置算。

export interface Modifiers {
  readonly ctrl: boolean;
  readonly shift: boolean;
}

export interface KeyedSelection<K> {
  readonly selected: ReadonlySet<K>;
  /** Shift 区间的起点：键与落锚时的位置。列表变了位置可能过时，用时按键核对再找。 */
  readonly anchor: { readonly key: K; readonly at: number } | null;
}

export function emptySelection<K>(): KeyedSelection<K> {
  return { selected: new Set<K>(), anchor: null };
}

function positionOf<K>(order: readonly K[], key: K, at?: number): number {
  return at !== undefined && order[at] === key ? at : order.indexOf(key);
}

function only<K>(key: K, at: number): KeyedSelection<K> {
  return { selected: new Set([key]), anchor: { key, at } };
}

/** 单击或键盘移动落到 `key` 上。键不在列表里时不动。 */
export function activate<K>(
  selection: KeyedSelection<K>,
  order: readonly K[],
  key: K,
  modifiers: Modifiers,
  at?: number,
): KeyedSelection<K> {
  const here = positionOf(order, key, at);
  if (here < 0) return selection;
  const { anchor } = selection;
  const from = modifiers.shift && anchor ? positionOf(order, anchor.key, anchor.at) : -1;
  if (from >= 0) {
    const range = order.slice(Math.min(from, here), Math.max(from, here) + 1);
    const selected = new Set(modifiers.ctrl ? [...selection.selected, ...range] : range);
    return { selected, anchor };
  }
  if (modifiers.ctrl) {
    const selected = new Set(selection.selected);
    if (!selected.delete(key)) selected.add(key);
    return { selected, anchor: { key, at: here } };
  }
  return only(key, here);
}

/**
 * 右键或「更多」落在 `key` 上：答改过的选中，以及菜单作用于哪些键（按列表顺序）。它已在选中里就保持
 * 整批、作用于整个选择；不在就改为只选它、只作用于它。它不在列表里（刚被过滤掉、分节还没排好）时
 * 选中不动，只作用于它：别的已选键不能被捎带进去。
 */
export function menuSelection<K>(
  selection: KeyedSelection<K>,
  order: readonly K[],
  key: K,
  at?: number,
): { readonly selection: KeyedSelection<K>; readonly targets: K[] } {
  const here = positionOf(order, key, at);
  if (here < 0) return { selection, targets: [key] };
  if (selection.selected.has(key))
    return { selection, targets: orderedSelection(selection, order) };
  return { selection: only(key, here), targets: [key] };
}

export function selectAll<K>(order: readonly K[]): KeyedSelection<K> {
  const [first] = order;
  return first === undefined
    ? emptySelection()
    : { selected: new Set(order), anchor: { key: first, at: 0 } };
}

/** 列表变了：看不见的键从选中里去掉，锚看不见了也撤掉。没变化时原样返回，调用方可按引用判断。 */
export function pruneSelection<K>(
  selection: KeyedSelection<K>,
  order: readonly K[],
): KeyedSelection<K> {
  const visible = new Set(order);
  const kept = [...selection.selected].filter((key) => visible.has(key));
  const anchorGone = selection.anchor !== null && !visible.has(selection.anchor.key);
  if (kept.length === selection.selected.size && !anchorGone) return selection;
  return { selected: new Set(kept), anchor: anchorGone ? null : selection.anchor };
}

/** 选中的键按列表顺序，副本只取第一次出现。 */
export function orderedSelection<K>(selection: KeyedSelection<K>, order: readonly K[]): K[] {
  return [...new Set(order.filter((key) => selection.selected.has(key)))];
}
