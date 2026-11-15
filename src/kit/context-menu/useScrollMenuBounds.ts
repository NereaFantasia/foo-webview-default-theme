import { contextMenuBounds } from './contextMenuGeometry.ts';
import { useContextMenuViewport } from './useContextMenuViewport.ts';

/** 菜单与下拉列表离可用区域各边的留白，CSS 像素 */
const EDGE = 12;

/** 标题栏下沿到窗口顶部的距离。没有标题栏（迷你窗口）或没有 `document`（服务端渲染）时为 0 */
function titlebarInset(): number {
  if (typeof document === 'undefined') return 0;
  const bar = document.querySelector<HTMLElement>('[data-titlebar]');
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}

/**
 * 菜单与下拉列表的可用范围：窗口去掉标题栏，四边各留 `EDGE`。标题栏是宿主的拖动区，浮层压上去的那一段接不到点击，
 * 所以列表的高度与定位边界都从标题栏下沿算起。窗口尺寸变了跟着重算
 */
export function useScrollMenuBounds() {
  const viewport = useContextMenuViewport();
  const inset = titlebarInset();
  return {
    bounds: contextMenuBounds({ ...viewport, height: viewport.height - inset }, EDGE),
    boundaryPadding: { top: inset + EDGE, end: EDGE, bottom: EDGE, start: EDGE },
  };
}
