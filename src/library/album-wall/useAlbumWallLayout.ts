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
  type GridItem,
  type GridMetrics,
} from './albumGridLayout.ts';
import { gridRowHeight, layoutRow, type RowLayout } from '../cover-tile/tileGeometry.ts';
import { browserPrefsAtom, TILE_SIZE_MAX, TILE_SIZE_MIN } from '../albums/browserPrefs.ts';

export const TILE_BOUNDS = { min: TILE_SIZE_MIN, max: TILE_SIZE_MAX } as const;

export interface AlbumWallLayout {
  /** 绑定至网格滚动容器以测量内容区宽度 */
  readonly measure: RefCallback<HTMLElement>;
  /** 内容区宽度，单位 CSS 像素；未测出时为 0 */
  readonly width: number;
  readonly row: RowLayout;
  readonly metrics: GridMetrics;
  readonly rowHeight: number;
  readonly items: readonly GridItem[];
  /** 换列时是否启用图块位移动画；减弱动效偏好或侧边栏切换时直接到位 */
  readonly reflowMotion: boolean;
}

/**
 * 封面墙几何计算 hook
 * 测量内容卡片宽度，依据边长偏好与显示样式计算单行排版，并将分节与折叠拍平为条目流
 * 宽度变化时通过 flushSync 同步重排，避免 ResizeObserver 滞后渲染导致图块落后一帧
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
