import type { Modifiers } from '../kit/keyedSelection.ts';

// 曲目表格的键盘落点与打字即跳的匹配：在条目流上算，不碰 DOM 与滚动。位置一律是显示位（条目流的下标）。

/** 键盘要知道的那几项；`TableItem` 满足它。 */
export interface KeyEntry {
  readonly kind: 'row' | 'group' | 'filler';
  readonly level?: number;
  readonly collapsed?: boolean;
}

export interface KeyEntries {
  readonly count: number;
  itemAt(index: number): KeyEntry | undefined;
}

export interface TableKeySource extends KeyEntries {
  /** 焦点所在的显示位；没有焦点时为 -1。 */
  readonly focus: number;
  /** 一屏放得下几个条目，翻页按它跳。 */
  readonly pageSize: number;
  /**
   * 上下键停不停在分组头上。不停时分组头只能点到；焦点在它上面时开合键（回车、空格、← →、`*`）照样管用，
   * 曲目行上的 ← 不回分组头。
   */
  readonly groupFocus: boolean;
}

export type TableKeyInput = Pick<KeyboardEvent, 'key'> &
  Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>>;

/**
 * 一次按键归表格做什么。`land` 是焦点落到那一位上：落在曲目行上按修饰键改选中，落在分组头上只移焦点。
 * `block` 是移动键到了头：什么都不做，但缺省要拦下，外层不跟着滚。
 */
export type TableKeyAction =
  | { readonly kind: 'land'; readonly index: number; readonly modifiers: Modifiers }
  | { readonly kind: 'play'; readonly index: number }
  | { readonly kind: 'toggleGroup'; readonly index: number }
  | { readonly kind: 'setGroup'; readonly index: number; readonly collapsed: boolean }
  | { readonly kind: 'expandSiblings'; readonly index: number }
  | { readonly kind: 'selectAll' }
  | { readonly kind: 'menu'; readonly index: number }
  | { readonly kind: 'block' }
  | { readonly kind: 'none' };

const NONE: TableKeyAction = { kind: 'none' };
const BLOCK: TableKeyAction = { kind: 'block' };

function focusable(source: TableKeySource, index: number): boolean {
  const kind = source.itemAt(index)?.kind;
  return kind === 'row' || (kind === 'group' && source.groupFocus);
}

/** 从 `from` 起（含）朝 `step` 方向找第一个能拿焦点的位置；出界答 -1。 */
function seek(source: TableKeySource, from: number, step: 1 | -1): number {
  for (let at = from; at >= 0 && at < source.count; at += step) {
    if (focusable(source, at)) return at;
  }
  return -1;
}

/** 翻页落点：跳一屏，落在空位上就往前找，前面没有再往回找。 */
function page(source: TableKeySource, step: 1 | -1): number {
  const target = Math.min(source.count - 1, Math.max(0, source.focus + step * source.pageSize));
  const ahead = seek(source, target, step);
  return ahead >= 0 ? ahead : seek(source, target, step === 1 ? -1 : 1);
}

/**
 * 这一位外面套着的分组头，由外到里。上面第一个比它层级浅的分组头是它的上一层，依次往外找；
 * 曲目行与空位比任何分组头都深。
 */
export function ancestorsOf(entries: KeyEntries, index: number): number[] {
  const item = entries.itemAt(index);
  let depth = item?.kind === 'group' ? (item.level ?? 0) : Infinity;
  const out: number[] = [];
  for (let at = index - 1; at >= 0 && depth > 0; at -= 1) {
    const above = entries.itemAt(at);
    if (above?.kind !== 'group' || (above.level ?? 0) >= depth) continue;
    out.unshift(at);
    depth = above.level ?? 0;
  }
  return out;
}

function moveTarget(source: TableKeySource, key: string): number | undefined {
  const { focus, count } = source;
  if (focus < 0 && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(key)) {
    return seek(source, 0, 1);
  }
  switch (key) {
    case 'ArrowDown':
      return seek(source, focus + 1, 1);
    case 'ArrowUp':
      return seek(source, focus - 1, -1);
    case 'PageDown':
      return page(source, 1);
    case 'PageUp':
      return page(source, -1);
    case 'Home':
      return seek(source, 0, 1);
    case 'End':
      return seek(source, count - 1, -1);
    default:
      return undefined;
  }
}

/** 分组头上的 ← →：← 收起，已收起就去上一层；→ 展开，已展开就进到下面第一条。 */
function groupArrow(source: TableKeySource, item: KeyEntry, left: boolean): TableKeyAction {
  const { focus } = source;
  const plain = { ctrl: false, shift: false };
  if (left && !item.collapsed) return { kind: 'setGroup', index: focus, collapsed: true };
  if (!left && item.collapsed) return { kind: 'setGroup', index: focus, collapsed: false };
  const next = left ? ancestorsOf(source, focus).at(-1) : seek(source, focus + 1, 1);
  return next !== undefined && next >= 0 ? { kind: 'land', index: next, modifiers: plain } : BLOCK;
}

/**
 * 一次按键的去向。Alt 组合一律不接（留给后退、前进与列头换位）。回车：曲目行播放、分组头开合；
 * 空格：分组头开合，曲目行按修饰键选中焦点行；`*`：展开焦点分组头的同级。上下、翻页、Home、End 移焦点，
 * 带 Shift 扩选、带 Ctrl 切换落点那一行；还没有焦点时都落到第一条。分组头上的 ← → 按树的惯例开合；分组头
 * 能拿焦点时，曲目行上的 ← 回到它的分组头。Ctrl+A 全选。Shift+F10 开焦点那一条的菜单，没有焦点时也拦下缺省，
 * 与 Menu 键一致。
 */
export function resolveTableKey(source: TableKeySource, input: TableKeyInput): TableKeyAction {
  if (input.altKey) return NONE;
  const ctrl = input.ctrlKey === true || input.metaKey === true;
  const shift = input.shiftKey === true;
  const { focus } = source;
  const item = focus >= 0 ? source.itemAt(focus) : undefined;
  const onRow = item?.kind === 'row';
  const onGroup = item?.kind === 'group';
  if (input.key === 'F10' && shift && !ctrl) {
    return onRow || onGroup ? { kind: 'menu', index: focus } : BLOCK;
  }
  if (ctrl && !shift && (input.key === 'a' || input.key === 'A')) return { kind: 'selectAll' };
  if (input.key === 'Enter' && !ctrl && !shift) {
    if (onRow) return { kind: 'play', index: focus };
    return onGroup ? { kind: 'toggleGroup', index: focus } : NONE;
  }
  if (input.key === ' ') {
    if (onGroup && !ctrl && !shift) return { kind: 'toggleGroup', index: focus };
    return onRow ? { kind: 'land', index: focus, modifiers: { ctrl, shift } } : NONE;
  }
  if (input.key === '*' && !ctrl) {
    return onGroup ? { kind: 'expandSiblings', index: focus } : NONE;
  }
  if ((input.key === 'ArrowLeft' || input.key === 'ArrowRight') && !ctrl && !shift) {
    if (!item) return NONE;
    if (onGroup) return groupArrow(source, item, input.key === 'ArrowLeft');
    if (!source.groupFocus) return NONE;
    const owner = input.key === 'ArrowLeft' ? ancestorsOf(source, focus).at(-1) : undefined;
    return owner === undefined ? NONE : { kind: 'land', index: owner, modifiers: { ctrl, shift } };
  }
  const target = moveTarget(source, input.key);
  if (target === undefined) return NONE;
  if (target < 0 || target === focus) return BLOCK;
  return { kind: 'land', index: target, modifiers: { ctrl, shift } };
}

/**
 * 打字即跳：`rank` 给每一条打分（越小越先，undefined 是不中），分最小的赢，同分取焦点之后最近的一条。
 * 从焦点那一条（含）往下找，到头绕回。焦点外面套着的分组头与焦点本身同算「焦点自己」，最先比：接着打
 * 同一前缀时焦点留在原地。`needle` 已按 `toLocaleLowerCase` 折过，`rank` 要按同一口径比。空位不参与。
 */
export function findTablePrefix(
  entries: KeyEntries,
  focus: number,
  text: string,
  rank: (index: number, needle: string) => number | undefined,
): number | undefined {
  const needle = text.toLocaleLowerCase();
  if (!needle || entries.count === 0) return undefined;
  const start = focus >= 0 && focus < entries.count ? focus : 0;
  const own = focus === start ? ancestorsOf(entries, start) : [];
  const skip = new Set(own);
  let best: { rank: number; index: number } | undefined;
  const offer = (index: number) => {
    if (entries.itemAt(index)?.kind === 'filler') return;
    const score = rank(index, needle);
    if (score !== undefined && (!best || score < best.rank)) best = { rank: score, index };
  };
  for (const index of own) offer(index);
  for (let step = 0; step < entries.count; step += 1) {
    const index = (start + step) % entries.count;
    if (!skip.has(index)) offer(index);
  }
  return best?.index;
}
