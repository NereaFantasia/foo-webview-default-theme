import { createContext } from 'react';

/**
 * full 档的舞台整幅 `transform: scale(s)`，里面的 canvas 按 CSS 尺寸开物理像素会被一起缩放，放大发虚。
 * 舞台经这个上下文给出 s，canvas 件的物理尺寸取 CSS 尺寸 × s × 设备像素比；舞台外的 canvas 不在它下面，按 1。
 * s 变了而 CSS 尺寸不变时 ResizeObserver 不报，canvas 件要把 s 放进自己重开 canvas 的依赖里。
 */
export const StageScaleContext = createContext(1);

/** canvas 每个 CSS 像素对应的物理像素数。设备像素比每次现读：换了屏，下一次开 canvas 就跟上。 */
export function canvasRatio(stageScale: number): number {
  return (window.devicePixelRatio || 1) * stageScale;
}
