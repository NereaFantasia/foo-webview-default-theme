import type { CSSProperties } from 'react';

/**
 * 虚拟行的竖向位置，写成 `--row-y`：右侧卡的行用 `transform` 平移（`QueueList` 的样式），沉浸视图画成卡时用 `top`
 * 上下两端的渐隐靠滚动时间线，时间线按布局位置算行的进出，不认 `transform`
 */
export function rowOffset(y: number): CSSProperties & Record<'--row-y', string> {
  return { '--row-y': `${y}px` };
}
