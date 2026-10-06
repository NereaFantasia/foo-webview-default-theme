import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState, type RefCallback } from 'react';
import { flushSync } from 'react-dom';
import { sidebarViewAtom } from '../../nav/sidebar/sidebarView.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { albumBrowseAtom } from '../albums/albumBrowse.ts';
import {
  buildGridItems,
  GRID_METRICS,
  gridRowHeight,
  layoutRow,
  type GridItem,
  type GridMetrics,
  type RowLayout,
} from './albumGridLayout.ts';
import { browserPrefsAtom, TILE_SIZE_MAX, TILE_SIZE_MIN } from '../albums/browserPrefs.ts';

export const TILE_BOUNDS = { min: TILE_SIZE_MIN, max: TILE_SIZE_MAX } as const;

export interface AlbumWallLayout {
  /** 挂到网格的滚动容器上，量它的内容宽。 */
  readonly measure: RefCallback<HTMLElement>;
  /** 内容宽，CSS 像素；还没量到时为 0。 */
  readonly width: number;
  readonly row: RowLayout;
  readonly metrics: GridMetrics;
  readonly rowHeight: number;
  readonly items: readonly GridItem[];
  /** 换列时图块滑不滑到新位置：减弱动效、侧边栏换形态挤出来的换列都直接到位。 */
  readonly reflowMotion: boolean;
}

/**
 * 封面墙的几何：量内容卡的宽（不看窗口宽），按偏好的边长与显示样式排一行，再把节与折叠摊成条目流。
 *
 * 宽度一变当场同步重排：ResizeObserver 在这一帧排版之后、绘制之前报，照常排进 React 的队列要等到绘制
 * 之后才渲染，拖窗口时图块就总比内容卡慢一帧。
 */
export function useAlbumWallLayout(): AlbumWallLayout {
  const { sections, collapsed, headers, repeats } = useAtomValueRawSync(albumBrowseAtom);
  const { style, tileSize } = useAtomValueRawSync(browserPrefsAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { shifting } = useAtomValueRawSync(sidebarViewAtom);
  const [width, setWidth] = useState(0);
  const measure = useElementWidth<HTMLElement>((next) => flushSync(() => setWidth(next)));
  const metrics = GRID_METRICS[style];
  const row = useMemo(
    () => layoutRow(width, tileSize, metrics, TILE_BOUNDS),
    [width, tileSize, metrics],
  );
  const items = useMemo(
    () => buildGridItems(sections, collapsed, row.perRow, { headers, repeats }),
    [sections, collapsed, row.perRow, headers, repeats],
  );
  return {
    measure,
    width,
    row,
    metrics,
    rowHeight: gridRowHeight(row.tileSize, metrics),
    items,
    reflowMotion: !reduced && !shifting,
  };
}
