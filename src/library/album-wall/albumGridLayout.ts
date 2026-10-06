import type { GridDropdownItem } from './albumDropdown.ts';
import type { AlbumSection } from '../albumSections.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';

// 封面墙的几何：一行放几块，以及把「节 + 折叠」摊平成按行虚拟滚动的条目流。
// 几千张图块不能全进 DOM，所以一个条目是一整行图块、一个节头或一条下拉。纯函数，入参一律不改。

/** 显示样式四档，取值与 config 里存的一致。四档只差间距、字行与节头高，边长归用户的滑块。 */
export const GRID_STYLES = ['grid', 'compact', 'spaced', 'gridNoText'] as const;
export type GridStyle = (typeof GRID_STYLES)[number];

/** 一档样式的几何，CSS 像素。 */
export interface GridMetrics {
  /** 块间距，也是行间距；列数按它算。 */
  readonly gap: number;
  /** 余量补进块间距的上限，按 `gap` 的倍数；1 是不拉伸，余量全去两侧。 */
  readonly stretch: number;
  /** 图块下两行字连同各自上方 2 px 留白的总高，即 `2 × (2 + lineHeight)`；无字档为 0。 */
  readonly textHeight: number;
  readonly lineHeight: number;
  readonly headerHeight: number;
}

export const GRID_METRICS: Readonly<Record<GridStyle, GridMetrics>> = {
  grid: { gap: 12, stretch: 2, textHeight: 36, lineHeight: 16, headerHeight: 32 },
  compact: { gap: 6, stretch: 1, textHeight: 32, lineHeight: 14, headerHeight: 28 },
  spaced: { gap: 24, stretch: 2, textHeight: 44, lineHeight: 20, headerHeight: 40 },
  gridNoText: { gap: 12, stretch: 2, textHeight: 0, lineHeight: 16, headerHeight: 32 },
};

/** 图块行的高度：边长加行间距，有字档再加两行字。 */
export function gridRowHeight(tileSize: number, metrics: GridMetrics): number {
  return tileSize + metrics.textHeight + metrics.gap;
}

export interface GridHeaderItem {
  readonly kind: 'header';
  readonly section: AlbumSection;
  readonly collapsed: boolean;
}

export interface GridRowItem {
  readonly kind: 'row';
  /** 这一行的图块，末行可能不满。 */
  readonly albums: readonly Album[];
  /** 所属的节；null 是「未知」节或平铺档。 */
  readonly sectionKey: string | null;
  /** 同一张专辑可能在几节里各有一块（艺术家档），图块的渲染键要带上节键才不撞。 */
  readonly repeats: boolean;
}

/** `buildGridItems` 只摊出节头与图块行，下拉由 `withDropdowns` 插进条目流。 */
export type SectionGridItem = GridHeaderItem | GridRowItem;
export type GridItem = SectionGridItem | GridDropdownItem;

/** 边长允许的区间，两端都含。 */
export interface TileBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * 一行放几块。列数只看网格所在内容卡的内宽，不看窗口：侧边栏开合、窄窗浮层都会让两者不一致。
 * 间距只在块与块之间，所以按「内宽加一个间距」除「边长加一个间距」算；还没量出宽度时按一块。
 */
export function tilesPerRow(containerWidth: number, tileSize: number, gap: number): number {
  if (!(containerWidth > 0) || !(tileSize > 0)) return 1;
  const spacing = Math.max(0, gap);
  return Math.max(1, Math.floor((containerWidth + spacing) / (tileSize + spacing)));
}

/** 一行的排法：几块、边长、块间实际留多宽、整行从哪起（节头文字也从这里起）。 */
export interface RowLayout {
  readonly perRow: number;
  readonly tileSize: number;
  readonly spacing: number;
  readonly offset: number;
}

/**
 * 边长固定、不随内宽变。余量先补进块间距，最多补到 `gap × stretch`，剩下的两侧均分，整行居中；
 * 单列或还没量出宽度时从 0 起。间距与起点可带小数，到算横坐标时才取整，免得逐块累积偏差。
 */
export function layoutRow(
  containerWidth: number,
  tileSize: number,
  metrics: Pick<GridMetrics, 'gap' | 'stretch'>,
  bounds: TileBounds,
): RowLayout {
  const gap = Math.max(0, metrics.gap);
  const size = Math.min(bounds.max, Math.max(bounds.min, Math.round(tileSize)));
  if (!(containerWidth > 0)) return { perRow: 1, tileSize: size, spacing: gap, offset: 0 };
  const perRow = tilesPerRow(containerWidth, size, gap);
  const spacing =
    perRow > 1
      ? Math.min(
          gap * Math.max(1, metrics.stretch),
          (containerWidth - perRow * size) / (perRow - 1),
        )
      : gap;
  const rowWidth = perRow * size + (perRow - 1) * spacing;
  return { perRow, tileSize: size, spacing, offset: Math.max(0, (containerWidth - rowWidth) / 2) };
}

/** Shift + 滚轮每格走一步，夹在区间内；到头或零格答 undefined，调用方就不落盘。 */
export function stepTileSize(
  current: number,
  notches: number,
  step: number,
  bounds: TileBounds,
): number | undefined {
  if (notches === 0) return undefined;
  const next = Math.min(bounds.max, Math.max(bounds.min, Math.round(current + notches * step)));
  return next === current ? undefined : next;
}

/**
 * 节与折叠摊成条目流。折叠的节只出节头，它的行不进流，虚拟滚动的总高随之变。
 * `headers` 为假（平铺档）时一个节头都不出，也就没有可折叠的节。
 */
export function buildGridItems(
  sections: readonly AlbumSection[],
  collapsed: ReadonlySet<string | null>,
  perRow: number,
  options: { readonly headers: boolean; readonly repeats: boolean },
): SectionGridItem[] {
  const width = Math.max(1, Math.floor(perRow));
  const items: SectionGridItem[] = [];
  for (const section of sections) {
    const folded = options.headers && collapsed.has(section.key);
    if (options.headers) items.push({ kind: 'header', section, collapsed: folded });
    if (folded) continue;
    for (let at = 0; at < section.albums.length; at += width) {
      items.push({
        kind: 'row',
        albums: section.albums.slice(at, at + width),
        sectionKey: section.key,
        repeats: options.repeats,
      });
    }
  }
  return items;
}

/** 画出来的一块：绝对定位的左上角，以及它在条目流里的行与列。 */
export interface PlacedTile {
  /** 渲染键：通常是专辑键；行带 `repeats` 时前面加节键。 */
  readonly key: string;
  readonly albumKey: AlbumKey;
  readonly sectionKey: string | null;
  readonly album: Album;
  readonly index: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
}

/**
 * 把虚拟滚动给出的可见行摊成一组绝对定位的图块。图块跨行用同一个键：换列数时同一张专辑从第三行
 * 挪到第二行，渲染层复用元素而不是销毁重建，`<img>` 不必重新解码，位移过渡也才有起点。反过来键也
 * 不能按下标复用：封面名额按图块实例借还，一个实例从挂上到卸掉只能画同一张专辑。
 */
export function placeVisible(
  items: readonly GridItem[],
  rows: readonly { readonly index: number; readonly start: number }[],
  layout: Pick<RowLayout, 'tileSize' | 'spacing' | 'offset'>,
): PlacedTile[] {
  const tiles: PlacedTile[] = [];
  for (const row of rows) {
    const item = items[row.index];
    if (item?.kind !== 'row') continue;
    item.albums.forEach((album, column) => {
      const albumKey = albumKeyOf(album);
      tiles.push({
        key: item.repeats ? `${item.sectionKey ?? ''}\0${albumKey}` : albumKey,
        albumKey,
        sectionKey: item.sectionKey,
        album,
        index: row.index,
        column,
        x: Math.round(layout.offset + column * (layout.tileSize + layout.spacing)),
        y: row.start,
      });
    });
  }
  return tiles;
}

/**
 * 一张专辑此刻画在条目流的哪一行哪一列；被折叠、被过滤掉或已不在清单里时为 undefined。
 * 它在几节里各有一块时，先找 `section` 那一节的，没有再取第一块。
 */
export function gridIndexOf(
  items: readonly GridItem[],
  key: AlbumKey,
  section?: string | null,
): { index: number; column: number } | undefined {
  let first: { index: number; column: number } | undefined;
  for (const [index, item] of items.entries()) {
    if (item.kind !== 'row') continue;
    const column = item.albums.findIndex((album) => albumKeyOf(album) === key);
    if (column < 0) continue;
    if (section === undefined || item.sectionKey === section) return { index, column };
    first ??= { index, column };
  }
  return first;
}

/** 条目流里第 `index` 行第 `column` 块在阅读顺序里是第几块（节头不算）；多选的区间按它算。 */
export function readingPositionOf(
  items: readonly GridItem[],
  at: { readonly index: number; readonly column: number },
): number {
  let before = 0;
  for (let index = 0; index < at.index && index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === 'row') before += item.albums.length;
  }
  return before + at.column;
}
