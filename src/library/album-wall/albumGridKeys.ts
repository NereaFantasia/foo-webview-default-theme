import type { GridItem } from './albumGridLayout.ts';
import { albumArtistOf, type Album } from '../../host/libraryContract.ts';

// 封面墙的键盘落点与打字即跳的匹配：在条目流上算，不碰 DOM 与滚动。
// 位置是「第几个条目 + 行内第几块」，与 `gridIndexOf` 答的同一种。

export interface GridPosition {
  readonly index: number;
  readonly column: number;
}

/** 落点上的那张专辑。列号超出这一行的块数时取行尾那块：上下移动跨到短行就是这样。 */
export function albumAt(
  items: readonly GridItem[],
  position: GridPosition | undefined,
): Album | undefined {
  const item = position ? items[position.index] : undefined;
  if (item?.kind !== 'row' || !position) return undefined;
  return item.albums[Math.min(position.column, item.albums.length - 1)];
}

/** 所有图块行的下标，按显示顺序；上下移动与翻页都在这一串上走，节头跳过。 */
function rowIndices(items: readonly GridItem[]): number[] {
  return items.flatMap((item, index) => (item.kind === 'row' ? [index] : []));
}

/**
 * 同一列上下走，跨节时落到相邻节的那一行；到头就停，不回绕。目标行比这一列短时落在行尾那块，
 * 落点总是一块真有的图块，选择的区间才按得准。
 */
function vertical(
  items: readonly GridItem[],
  from: GridPosition,
  step: 1 | -1,
  distance: number,
): GridPosition | undefined {
  const rows = rowIndices(items);
  const at = rows.indexOf(from.index);
  if (at < 0) return undefined;
  const next = rows[Math.min(rows.length - 1, Math.max(0, at + step * distance))];
  const target = next === undefined ? undefined : items[next];
  if (next === undefined || target?.kind !== 'row') return undefined;
  return { index: next, column: Math.min(from.column, target.albums.length - 1) };
}

/** 左右逐块走，行尾接下一行的行首、节尾接下一节，与资源管理器一致。 */
function horizontal(
  items: readonly GridItem[],
  from: GridPosition,
  step: 1 | -1,
): GridPosition | undefined {
  const item = items[from.index];
  if (item?.kind !== 'row') return undefined;
  const column = Math.min(from.column, item.albums.length - 1) + step;
  if (column >= 0 && column < item.albums.length) return { index: from.index, column };
  const row = vertical(items, from, step, 1);
  const target = row ? items[row.index] : undefined;
  if (!row || row.index === from.index || target?.kind !== 'row') return undefined;
  return { index: row.index, column: step > 0 ? 0 : target.albums.length - 1 };
}

function edge(items: readonly GridItem[], last: boolean): GridPosition | undefined {
  const rows = rowIndices(items);
  const index = last ? rows[rows.length - 1] : rows[0];
  const item = index === undefined ? undefined : items[index];
  if (index === undefined || item?.kind !== 'row') return undefined;
  return { index, column: last ? item.albums.length - 1 : 0 };
}

type Move = (
  at: GridPosition,
  items: readonly GridItem[],
  pageRows: number,
) => GridPosition | undefined;

const MOVES: Readonly<Record<string, Move>> = {
  ArrowRight: (at, items) => horizontal(items, at, 1),
  ArrowLeft: (at, items) => horizontal(items, at, -1),
  ArrowDown: (at, items) => vertical(items, at, 1, 1),
  ArrowUp: (at, items) => vertical(items, at, -1, 1),
  PageDown: (at, items, pageRows) => vertical(items, at, 1, Math.max(1, pageRows)),
  PageUp: (at, items, pageRows) => vertical(items, at, -1, Math.max(1, pageRows)),
  Home: (_, items) => edge(items, false),
  End: (_, items) => edge(items, true),
};

/**
 * 一次移动键的落点；不是移动键、已到这个方向的尽头或落回原地时为 undefined。还没有落点时
 * 任何移动键都落到第一块。`pageRows` 是一屏放得下几行，翻页按它跳。
 */
export function moveInGrid(
  items: readonly GridItem[],
  from: GridPosition | undefined,
  key: string,
  pageRows: number,
): GridPosition | undefined {
  const move = Object.hasOwn(MOVES, key) ? MOVES[key] : undefined;
  if (!move) return undefined;
  if (!from) return edge(items, false);
  const next = move(from, items, pageRows);
  return next && (next.index !== from.index || next.column !== from.column) ? next : undefined;
}

/**
 * 一次按键归网格做什么。回车在有落点时播放。移动键一律拦下：算不出落点、到了头也不能让外层滚动
 * 跟着走；算得出就连同那张专辑一起给回去。别的键不管。
 */
export type GridKeyAction =
  | { readonly kind: 'play'; readonly album: Album }
  | { readonly kind: 'move'; readonly next: GridPosition; readonly album: Album }
  | { readonly kind: 'block' }
  | { readonly kind: 'none' };

export function resolveGridKey(
  items: readonly GridItem[],
  from: GridPosition | undefined,
  key: string,
  pageRows: number,
): GridKeyAction {
  if (key === 'Enter') {
    const album = albumAt(items, from);
    return album ? { kind: 'play', album } : { kind: 'none' };
  }
  if (!Object.hasOwn(MOVES, key)) return { kind: 'none' };
  const next = moveInGrid(items, from, key, pageRows);
  const album = albumAt(items, next);
  return next && album ? { kind: 'move', next, album } : { kind: 'block' };
}

export interface GridPrefixHit {
  /** 滚进视口的条目：节头命中是那个节头，专辑命中是那一行。 */
  readonly index: number;
  /** 焦点落在哪一块：节头命中是它下面第一块，专辑命中是那一块。 */
  readonly at: GridPosition;
  readonly album: Album;
}

/** 节头下面第一块图块的位置；节折叠着、或节里一块都没有时为 undefined。 */
function firstTileUnder(items: readonly GridItem[], header: number): GridPosition | undefined {
  for (let index = header + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === 'header') return undefined;
    if (item?.kind === 'row' && item.albums.length > 0) return { index, column: 0 };
  }
  return undefined;
}

/** 这一行所在那一节的节头；平铺档没有节头，为 undefined。 */
function headerAbove(items: readonly GridItem[], row: number): number | undefined {
  for (let index = row - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === 'header') return index;
  }
  return undefined;
}

/**
 * 从 `from` 那一块含它自己起，按阅读顺序走一圈的候选：节头一项（列为 null），图块一块一项；
 * 起点所在的行先走起点之后的几块，绕回来时再走它前面的几块。焦点所在那一节的节头算焦点自己，
 * 排在最前：接着打字时这一节仍命中就不动，不跳到后面同前缀的节。
 */
function* candidatesFrom(
  items: readonly GridItem[],
  from: GridPosition | undefined,
): Generator<{ readonly index: number; readonly column: number | null }> {
  const start = from && from.index >= 0 && from.index < items.length ? from : undefined;
  const startIndex = start?.index ?? 0;
  const startColumn = start?.column ?? 0;
  const own =
    start && items[startIndex]?.kind === 'row' ? headerAbove(items, startIndex) : undefined;
  if (own !== undefined) yield { index: own, column: null };
  for (let step = 0; step <= items.length; step += 1) {
    const index = (startIndex + step) % items.length;
    const item = items[index];
    const wrapped = step === items.length;
    if (item?.kind === 'header' && !wrapped) yield { index, column: null };
    if (item?.kind !== 'row') continue;
    const first = step === 0 ? startColumn : 0;
    const end = wrapped ? Math.min(startColumn, item.albums.length) : item.albums.length;
    for (let column = first; column < end; column += 1) yield { index, column };
  }
}

/**
 * 打字即跳的匹配：节头 → 专辑名 → 专辑艺术家三级，同级取焦点之后最近的一个。候选按 `candidatesFrom`
 * 的次序从焦点起绕一圈，串越打越长时焦点仍命中就不动，在一节深处打出本节的名字则回到本节第一块。
 * 大小写按 `toLocaleLowerCase` 折，与过滤词同一口径。折叠的节无处落焦点，不算命中。
 */
export function findGridPrefix(
  items: readonly GridItem[],
  from: GridPosition | undefined,
  text: string,
): GridPrefixHit | undefined {
  const needle = text.toLocaleLowerCase();
  if (!needle || items.length === 0) return undefined;
  const starts = (value: string) => value.toLocaleLowerCase().startsWith(needle);
  let best: { rank: number; hit: GridPrefixHit } | undefined;
  const offer = (rank: number, hit: GridPrefixHit) => {
    if (!best || rank < best.rank) best = { rank, hit };
  };
  for (const { index, column } of candidatesFrom(items, from)) {
    const item = items[index];
    if (item?.kind === 'header' && column === null) {
      const at = item.collapsed ? undefined : firstTileUnder(items, index);
      const album = at ? albumAt(items, at) : undefined;
      if (item.section.key !== null && starts(item.section.key) && at && album) {
        return { index, at, album };
      }
    } else if (item?.kind === 'row' && column !== null) {
      const album = item.albums[column];
      if (!album) continue;
      const at = { index, column };
      if (starts(album.name)) offer(1, { index, at, album });
      else if (starts(albumArtistOf(album))) offer(2, { index, at, album });
    }
  }
  return best?.hit;
}
