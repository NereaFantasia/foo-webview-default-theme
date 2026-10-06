export interface ContextMenuPoint {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuViewport {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

export const CONTEXT_MENU_WIDTH = 300;
export const CONTEXT_MENU_MAX_WIDTH = 420;
export const CONTEXT_MENU_MAX_HEIGHT = 600;

export function contextMenuBounds(viewport: ContextMenuViewport, edge: number) {
  return {
    width: Math.max(0, Math.min(CONTEXT_MENU_MAX_WIDTH, viewport.width - edge * 2)),
    height: Math.max(0, Math.min(CONTEXT_MENU_MAX_HEIGHT, viewport.height - edge * 2)),
  };
}

/** 按父层两侧真实可用宽度判断，不以固定窗口断点代替。 */
export function contextMenuCascadeWidth(
  parent: Pick<DOMRect, 'left' | 'right'>,
  viewport: ContextMenuViewport,
  edge: number,
  gap: number,
): number {
  const before = parent.left - viewport.left - edge - gap;
  const after = viewport.left + viewport.width - parent.right - edge - gap;
  return Math.max(0, Math.min(CONTEXT_MENU_MAX_WIDTH, Math.max(before, after)));
}
