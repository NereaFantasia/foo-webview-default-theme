import { useCallback, useLayoutEffect, useRef, type RefCallback } from 'react';

/**
 * 量元素的内容宽（不含内边距），像素：返回的 ref 挂到元素上，挂上后报一次，之后每次变宽变窄都报。
 * 宽高都是 0 的元素（没渲染出来）挂上时不报，等它有了尺寸才报第一次。
 * `report` 取最近一次渲染传进来的，调用方不必记忆化；要什么状态由调用方自己存。
 *
 * 用 ResizeObserver 而不用容器查询：`container-type` 自带布局包含，元素里 fixed 定位的浮层
 * （菜单、提示）的包含块会变成这个元素，浮层就飘到别处去了。
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
