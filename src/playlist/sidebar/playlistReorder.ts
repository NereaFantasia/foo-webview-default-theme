/**
 * 侧边栏里拖动重排播放列表的纯判定：什么时候算拖起来、指针落在哪个插入位、插入位换成宿主要的完整排列、
 * 键盘移一位、拖到边缘往哪滚。手势本身在 `usePlaylistReorder.ts`。
 *
 * 插入位取 0…n：k 表示插在第 k 张之前，n 表示放到末尾。位置是侧边栏清单里的位置，清单不含宿主自己建的
 * 那几张，发给宿主之前用 `hostOrder` 换成宿主序号。
 */

/** 按下后移出这么远（CSS 像素）才算拖；没过线就松手照常是单击。 */
export const DRAG_THRESHOLD = 5;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function passedThreshold(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD;
}

/** 一行在视口里的上下沿。 */
export interface RowEdges {
  readonly top: number;
  readonly bottom: number;
}

/** 指针落在哪个插入位：在某一行的上半就插在它之前；首行之上算 0，末行之下算 n。行按清单顺序给。 */
export function slotAt(y: number, rows: readonly RowEdges[]): number {
  const before = rows.findIndex((row) => y < (row.top + row.bottom) / 2);
  return before < 0 ? rows.length : before;
}

/** 插入位就是原位：插在自己之前或紧跟自己之后，顺序都不变。 */
export function isOwnSlot(from: number, slot: number): boolean {
  return slot === from || slot === from + 1;
}

/** 挪完之后被挪那张的新序号：插入位在它后面时，它自己腾出的那一格要扣掉。 */
export function landingIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/**
 * 把第 `from` 张挪到插入位 `slot` 的完整排列，第 i 位放原来的第几张（宿主 `reorderPlaylists` 收的
 * 排列）。落在原位或越界时答 null，调用方据此不发命令。
 */
export function moveOrder(count: number, from: number, slot: number): number[] | null {
  if (from < 0 || from >= count || slot < 0 || slot > count || isOwnSlot(from, slot)) return null;
  const order = Array.from({ length: count }, (_, at) => at).filter((at) => at !== from);
  order.splice(landingIndex(from, slot), 0, from);
  return order;
}

/**
 * 把只排清单里那几张的排列换成宿主要的完整排列：宿主自己建的那几张留在原序号上，清单里的按 `order`
 * 依次填进其余的格。`listed` 是清单里各张的宿主序号，按清单顺序给；`count` 是宿主那边一共几张。
 */
export function hostOrder(
  order: readonly number[],
  listed: readonly number[],
  count: number,
): number[] {
  const taken = new Set(listed);
  const queue = order.map((at) => listed[at]);
  let next = 0;
  return Array.from({ length: count }, (_, at) => (taken.has(at) ? queue[next++] : at));
}

/** Alt+↑ / Alt+↓ 对应的插入位：上移插到上一张之前，下移插到下一张之后；到头答 null。 */
export function stepSlot(from: number, delta: -1 | 1, count: number): number | null {
  if (delta < 0) return from > 0 ? from - 1 : null;
  return from < count - 1 ? from + 2 : null;
}

/** 拖到滚动区边缘时往哪滚：离上沿不到一行高或越出上沿答 -1，下沿对称答 1，其余答 0。 */
export function edgeStep(y: number, top: number, bottom: number, rowHeight: number): -1 | 0 | 1 {
  if (y < top + rowHeight) return -1;
  if (y > bottom - rowHeight) return 1;
  return 0;
}
