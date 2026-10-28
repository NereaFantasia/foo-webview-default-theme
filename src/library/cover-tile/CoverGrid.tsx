import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { sidebarViewAtom } from '../../nav/sidebar/sidebarView.ts';
import styles from './CoverGrid.module.css';
import {
  flatHeight,
  flatPlace,
  gridRowHeight,
  layoutRow,
  STANDARD_TILE_METRICS,
  STANDARD_TILE_SIZE,
  tailShift,
  type TileMetrics,
} from './tileGeometry.ts';
import { REFLOW_KEY_ATTR, tileReflowKey, type ReflowPlace } from './tileReflow.ts';
import { useGridWindow } from './useGridWindow.ts';
import { useTileReflow } from './useTileReflow.ts';

/** 给了滚动区时，条目超过这么多才开窗口：几十块全画比量位置、卸装图块更省，也少一层行为 */
const WINDOW_FROM = 200;

/** 平铺网格几何规范：边长固定，其余属性继承 `TileMetrics` */
export interface CoverGridShape extends TileMetrics {
  readonly size: number;
}

/** 方形图块网格规范（用于专辑、歌单等）：边长与间距沿用封面墙默认档 */
export const STANDARD_GRID_SHAPE: CoverGridShape = {
  ...STANDARD_TILE_METRICS,
  size: STANDARD_TILE_SIZE,
};

export interface CoverGridProps<T> {
  readonly shape: CoverGridShape;
  readonly items: readonly T[];
  /** 条目稳定唯一标识，用于在换列位移动画中匹配 DOM 元素起点 */
  keyOf(item: NoInfer<T>): string;
  /** 渲染单个图块内容；单元格由网格绝对定位，宽度对应边长，高度由内容自适应 */
  render(item: T): ReactNode;
  readonly label?: string;
  /**
   * 给了滚动区、条目又很多（超过 `WINDOW_FROM`）时只画视口里与上下几行的图块，条数再多也不卡（`useGridWindow`）；
   * 滚动区还没挂上时给 null。不给就全画。离开视口的图块卸掉，它们的悬停与图片加载状态不留
   */
  readonly scroller?: HTMLElement | null;
  /** 只画前这么多行，其余不画（概览里的预览）；不给就全画 */
  readonly previewRows?: number;
  /** 最后一行不满时整行居中；不给就靠左对齐网格列 */
  readonly centerTail?: boolean;
  /** 画在网格上面的一块（节头之类）：拿到网格有没有超出 `previewRows` 行，也就是还有没露出的 */
  readonly header?: (state: { readonly overflow: boolean }) => ReactNode;
}

/**
 * 平铺封面网格组件，布局与换列位移动画沿用封面墙规范（`layoutRow`、`tileReflow.ts`）
 * 边长固定，余量优先补充块间距，剩余空间均分两侧以居中排布；未满一行时靠左对齐网格列
 * 换列时视口内元素平滑位移，跨度超过一屏的元素原地淡入；减弱动效偏好或侧边栏切换时直接到位
 *
 * 缺省不进行虚拟滚动，用于条目数量有限的搜索结果与推荐栏目；条目很多的列表传 `scroller`，按行开窗口
 */
export function CoverGrid<T>({
  shape,
  items: all,
  keyOf,
  render,
  label,
  scroller,
  previewRows,
  centerTail = false,
  header,
}: CoverGridProps<T>) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { shifting } = useAtomValueRawSync(sidebarViewAtom);
  const [width, setWidth] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // 容器宽度变化时同步刷新状态。ResizeObserver 在排版后绘制前触发，若走常规 React 调度会延迟至绘制后渲染，导致拖动窗口调整宽度时图块落后一帧
  const measure = useElementWidth<HTMLDivElement>((next) => flushSync(() => setWidth(next)));
  const row = layoutRow(width, shape.size, shape, { min: shape.size, max: shape.size });
  const rowHeight = gridRowHeight(shape.size, shape);
  const cap = previewRows === undefined ? all.length : previewRows * row.perRow;
  const overflow = all.length > cap;
  const items = overflow ? all.slice(0, cap) : all;
  const windowed = scroller !== undefined && items.length > WINDOW_FROM;
  const view = useGridWindow({
    scroller: windowed ? scroller : undefined,
    list,
    rowCount: Math.ceil(items.length / row.perRow),
    perRow: row.perRow,
    rowHeight,
  });
  const from = view.first * row.perRow;
  const shown = items.slice(from, view.last * row.perRow);
  const placeOf = (index: number) =>
    flatPlace(index, row, rowHeight, centerTail ? tailShift(index, items.length, row.perRow) : 0);
  const places = new Map<string, ReflowPlace>();
  shown.forEach((item, offset) => {
    const { x, y } = placeOf(from + offset);
    places.set(tileReflowKey(keyOf(item)), { x, y });
  });
  const scrollRef = useMemo(() => ({ current: scroller ?? null }), [scroller]);
  useTileReflow({
    rows: list,
    ...(windowed ? { scroller: scrollRef } : {}),
    places,
    columns: width > 0 ? row.perRow : 0,
    animate: !reduced && !shifting,
    scrollBefore: windowed ? view.scrollBefore : null,
  });
  const vars: CSSProperties & Record<`--${string}`, string> = {
    '--tile-size': `${row.tileSize}px`,
    '--tile-line': `${shape.lineHeight}px`,
    // 单元格横坐标由 CSS 变量在样式中计算；列数不变仅宽度微调时无需触发 React 重新渲染
    '--row-offset': `${row.offset}px`,
    '--tile-pitch': `${row.tileSize + row.spacing}px`,
  };
  return (
    <div className={styles.root}>
      {header?.({ overflow })}
      {/* 使用高度为 0 的独立标记元素测量宽度，避免因网格自身高度随内容变化引发循环尺寸观测 */}
      <div ref={measure} aria-hidden />
      <div
        ref={list}
        role="list"
        aria-label={label}
        className={styles.list}
        style={{ ...vars, height: flatHeight(items.length, row.perRow, rowHeight, shape.gap) }}
      >
        {shown.map((item, offset) => {
          const index = from + offset;
          const key = keyOf(item);
          const { column, y } = placeOf(index);
          return (
            <div
              key={key}
              role="listitem"
              {...(windowed ? { 'aria-setsize': items.length, 'aria-posinset': index + 1 } : {})}
              className={styles.cell}
              {...{ [REFLOW_KEY_ATTR]: tileReflowKey(key) }}
              style={{ '--tile-column': String(column), '--tile-y': `${y}px` } as CSSProperties}
            >
              {render(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
