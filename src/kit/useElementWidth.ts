import { useCallback, useLayoutEffect, useRef, type RefCallback } from 'react';

/**
 * 监听并获取 DOM 元素内容区宽度（不含内边距，单位为像素）的 Ref 回调 Hook
 * 元素初次挂载就绪后派发初次测量值，后续尺寸变动时持续上报
 * 针对初次挂载尺寸为 0 的未就绪元素，延迟至首次获得有效尺寸后派发
 * 回调引用自动保持最新，调用方无需使用 `useCallback` 包裹 `report`
 *
 * 注：采用 ResizeObserver 代替 CSS 容器查询，避免 `container-type` 引入的包含块格式化上下文
 * 导致内部 fixed 定位的浮层（如 Tooltip、菜单等）偏离预设视口锚点
 */
export function useElementWidth<E extends Element>(
  report: (width: number) => void,
): RefCallback<E> {
  const latest = useRef(report);
  useLayoutEffect(() => {
    latest.current = report;
  });
  return useCallback((element: E | null) => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) latest.current(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
}
