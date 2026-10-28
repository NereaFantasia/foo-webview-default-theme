import type { GridDropdownItem } from './albumDropdown.ts';
import type { AlbumSection } from '../albumSections.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';
import {
  STANDARD_TILE_METRICS,
  type RowLayout,
  type TileBounds,
  type TileMetrics,
} from '../cover-tile/tileGeometry.ts';

// 封面墙条目流组织：将「分节 + 折叠」模型拍平成按行虚拟滚动的条目序列
// 单一完整行图块、分节头或下拉详情各自对应单一虚拟条目；纯函数不修改入参

/** 封面网格四档预设样式，取值与持久化配置对应；定义间距、字高与节头高度，边长由滑块独立控制 */
export const GRID_STYLES = ['grid', 'compact', 'spaced', 'gridNoText'] as const;
export type GridStyle = (typeof GRID_STYLES)[number];

/** 单一网格样式的几何尺寸定义，单位 CSS 像素 */
export interface GridMetrics extends TileMetrics {
  readonly headerHeight: number;
}

export const GRID_METRICS: Readonly<Record<GridStyle, GridMetrics>> = {
  grid: { ...STANDARD_TILE_METRICS, headerHeight: 32 },
  compact: { gap: 6, stretch: 1, textHeight: 32, lineHeight: 14, headerHeight: 28 },
  spaced: { gap: 24, stretch: 2, textHeight: 44, lineHeight: 20, headerHeight: 40 },
  gridNoText: { gap: 12, stretch: 2, textHeight: 0, lineHeight: 16, headerHeight: 32 },
};

export interface GridHeaderItem {
  readonly kind: 'header';
  readonly section: AlbumSection;
  readonly collapsed: boolean;
}

export interface GridRowItem {
  readonly kind: 'row';
  /** 当前行的图块集合，末行可能未填满整行 */
  readonly albums: readonly Album[];
  /** 所属分节标识；null 表示未知分节或不分节平铺模式 */
  readonly sectionKey: string | null;
  /** 同一专辑是否可能跨节多次出现（如按艺术家展示）；为 true 时图块渲染键混入分节标识 */
  readonly repeats: boolean;
}

/** `buildGridItems` 仅生成节头与图块行，下拉面板后续由 `withDropdowns` 动态插入条目流 */
export type SectionGridItem = GridHeaderItem | GridRowItem;
export type GridItem = SectionGridItem | GridDropdownItem;

/** Shift + 滚轮按步长调整图块尺寸并夹取至极值区间；无变化时返回 undefined 以避免重复落盘 */
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
 * 将分节与折叠状态拍平为网格条目流
 * 折叠的分节仅生成节头，其所属图块行不入流；headers 为 false 时不输出任何节头
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

/** 绘制图块的绝对定位坐标与其在条目流中的行列位置映射 */
export interface PlacedTile {
  /** 渲染唯一键；通常为专辑键，含 repeats 时前缀分节键以防冲突 */
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
 * 将虚拟滚动可见行转换为绝对定位图块集合
 * 图块按专辑键跨行复用 DOM 节点，换列时直接触发位移过渡且避免图片重新解码
 * 不得按索引复用节点，以保证封面加载配额与图块生命周期严格一一对应
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
 * 查询指定专辑在条目流中的行列坐标；被折叠、被过滤或未命中时返回 undefined
 * 跨节出现时优先匹配 section 指定的分节，未指定时返回首个匹配项
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

/** 计算指定图块在逻辑阅读流中的绝对索引（跳过节头）；用于计算 Shift 连续多选区间 */
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
