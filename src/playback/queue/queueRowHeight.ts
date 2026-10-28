import { createContext, useContext } from 'react';

/** 右侧卡队列行的默认高度，单位 CSS 像素；沉浸视图等其他场景可按版式注入特定数值 */
export const DEFAULT_QUEUE_ROW_HEIGHT = 48;

/**
 * 队列各区域共享的行高上下文：为虚拟滚动估高、拖拽槽高及历史回看区提供统一基准
 * 需与根容器上的 `--queue-row-height` CSS 自定义属性保持同步
 */
export const QueueRowHeightContext = createContext(DEFAULT_QUEUE_ROW_HEIGHT);

export function useQueueRowHeight(): number {
  return useContext(QueueRowHeightContext);
}
