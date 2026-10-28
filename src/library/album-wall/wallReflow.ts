import { albumKeyOf } from '../../host/libraryContract.ts';
import { tileReflowKey, type ReflowPlace } from '../cover-tile/tileReflow.ts';
import { flowItemSize, itemTops, rowHolding } from './albumDropdown.ts';
import type { GridItem, PlacedTile } from './albumGridLayout.ts';

// 封面墙换列重排映射与视口滚动锚定
// 维护分节头与下拉面板的重排位置键，位移动画调度依赖 cover-tile/tileReflow.ts

export const headerReflowKey = (sectionKey: string | null) =>
  sectionKey === null ? 'h' : `h:${sectionKey}`;
export const dropdownReflowKey = (id: number) => `d:${id}`;

/** 计算当前渲染帧各元素位置映射：图块使用独立坐标，节头靠左对齐，下拉与图块行共用起点偏移 */
export function reflowPlaces(
  items: readonly GridItem[],
  rows: readonly { readonly index: number; readonly start: number }[],
  tiles: readonly PlacedTile[],
  rowOffset: number,
): Map<string, ReflowPlace> {
  const places = new Map<string, ReflowPlace>();
  for (const tile of tiles) places.set(tileReflowKey(tile.key), { x: tile.x, y: tile.y });
  for (const row of rows) {
    const item = items[row.index];
    if (item?.kind === 'header') {
      places.set(headerReflowKey(item.section.key), { x: 0, y: row.start });
    } else if (item?.kind === 'dropdown') {
      places.set(dropdownReflowKey(item.id), { x: Math.round(rowOffset), y: row.start });
    }
  }
  return places;
}

/** 计算条目垂直上沿所需的尺寸参数 */
export interface FlowShape {
  readonly items: readonly GridItem[];
  readonly rowHeight: number;
  readonly headerHeight: number;
}

function topsOf(shape: FlowShape): number[] {
  return itemTops(shape.items, (item) => flowItemSize(item, shape.rowHeight, shape.headerHeight));
}

/**
 * 计算换列重排后的视口锚定滚动位置（scrollTop）
 *
 * 选取换列前视口上沿首张专辑为锚点，重排后维持该项所在行与视口上沿的相对间距，消除视觉跳变
 */
export function anchoredScrollTop(before: FlowShape, after: FlowShape, scrollTop: number): number {
  if (!(scrollTop > 0)) return scrollTop;
  const tops = topsOf(before);
  for (const [index, item] of before.items.entries()) {
    if (item.kind !== 'row' || (tops[index + 1] ?? 0) <= scrollTop) continue;
    const album = item.albums[0];
    const hit = album && rowHolding(after.items, albumKeyOf(album), item.sectionKey);
    if (!hit) return scrollTop;
    const offset = (tops[index] ?? 0) - scrollTop;
    return Math.max(0, (topsOf(after)[hit.index] ?? 0) - offset);
  }
  return scrollTop;
}
