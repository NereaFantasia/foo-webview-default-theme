// 基于有序键列表的多选状态机纯函数集合。操作语义与通用列表、表格保持一致：
// - 无修饰键：单选当前项并将其设为锚点；
// - Ctrl：切换当前项的选中态，并将锚点移至当前项；
// - Shift：选定锚点到当前项之间的连续区间（替换原有选择）；
// - Ctrl+Shift：将区间追加至现有选中项集合；
// - 未设置锚点时：忽略 Shift 修饰键
//
// 列表中允许同一键出现多次（如网格多视图中的引用副本）：区间按物理位置截取，选中态按键值去重记录
// 可选传 `at` 指定具体命中索引；若未传则按该键在列表中首次出现的位置计算

export interface Modifiers {
  readonly ctrl: boolean;
  readonly shift: boolean;
}

export interface KeyedSelection<K> {
  readonly selected: ReadonlySet<K>;
  /** Shift 连续区间的起始锚点（包含键名与落锚时的索引位置）。列表重排后索引可能失效，读取时重新校验 */
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

/** 激活或点击指定键，根据修饰键计算新选中状态。若目标键不存在于列表中则保持原状 */
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
 * 计算触发右键菜单或操作项时的选中状态及生效目标列表（按列表顺序）
 * - 目标项已在选中集合中：保持现有选择不变，菜单操作作用于整批选中项；
 * - 目标项未被选中：将选择重置为单选该项，菜单操作仅作用于该项；
 * - 目标项不在当前可见列表中（如刚被过滤）：保留原选择不变，菜单仅作用于该项，避免误连带其他项目
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

/** 列表条目更新时剔除已不可见的选中项与失效锚点。若无需剔除则原样返回原引用 */
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

/** 将当前选中的键按列表物理顺序排列，重复出现的键仅保留首次位置 */
export function orderedSelection<K>(selection: KeyedSelection<K>, order: readonly K[]): K[] {
  return [...new Set(order.filter((key) => selection.selected.has(key)))];
}
