import { useCallback, type RefCallback } from 'react';

/**
 * 把元素挂载时的左上圆角写到根元素的 `name` 变量上
 *
 * 带 `backdrop-filter` 的元素在视图过渡中由快照组承载模糊。组是直角矩形，圆角须设在 `::view-transition-group` 上。
 * 伪元素位于根元素下，读不到组件上的变量，因此由元素把圆角写到根元素上，读取方见 `sceneTransition.css`
 */
export function useRootRadius(name: `--${string}`): RefCallback<HTMLElement> {
  return useCallback(
    (element) => {
      if (!element) return;
      const radius = getComputedStyle(element).borderTopLeftRadius;
      document.documentElement.style.setProperty(name, radius);
    },
    [name],
  );
}
