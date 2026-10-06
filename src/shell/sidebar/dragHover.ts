/** 拖着东西停在图标上多久弹出浮层，毫秒。 */
export const DRAG_HOVER_OPEN_MS = 500;
/** 拖着东西离开图标与浮层多久收起，毫秒。 */
export const DRAG_HOVER_CLOSE_MS = 300;

/** 拖动此刻经过哪里：停在图标上、在弹出的浮层里，或别处。 */
export type DragHoverSpot = 'anchor' | 'panel' | null;

export interface DragHoverOptions {
  isOpen(): boolean;
  open(): void;
  close(): void;
}

export interface DragHover {
  /** 拖动经过一处，按 `dragover` 报；拖动停着不动时浏览器也照样隔一会儿报一次。 */
  over(spot: DragHoverSpot): void;
  /** 拖放结束（落下或取消）：拖动弹出的浮层立即收起。 */
  end(): void;
  /** 浮层由别的途径开了或关了（点图标、点外面、Esc）：不再当作拖动弹出的，排着的开合作废。 */
  reset(): void;
  dispose(): void;
}

/**
 * 拖放悬停自动弹出：拖着专辑或文件停在图标上 500 ms 弹出浮层，好把东西落到浮层里的某一张列表上；
 * 离开图标与浮层 300 ms 收起，回来就不收；落下立即收。只收拖动弹出的那一次，用户点开的不因拖放而收起。
 * 只管时机，不碰 DOM，经过哪里由调用方按事件目标认。
 */
export function createDragHover(options: DragHoverOptions): DragHover {
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // 这一次是拖动弹出的。
  let byDrag = false;

  const clearOpen = () => {
    if (openTimer !== undefined) clearTimeout(openTimer);
    openTimer = undefined;
  };
  const clearClose = () => {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const shut = () => {
    byDrag = false;
    if (options.isOpen()) options.close();
  };

  return {
    over(spot) {
      if (spot !== 'anchor') clearOpen();
      if (!options.isOpen()) {
        byDrag = false;
        if (spot === 'anchor' && openTimer === undefined) {
          openTimer = setTimeout(() => {
            openTimer = undefined;
            byDrag = true;
            options.open();
          }, DRAG_HOVER_OPEN_MS);
        }
        return;
      }
      if (!byDrag) return;
      if (spot !== null) clearClose();
      else if (closeTimer === undefined) {
        closeTimer = setTimeout(() => {
          closeTimer = undefined;
          shut();
        }, DRAG_HOVER_CLOSE_MS);
      }
    },
    end() {
      clearOpen();
      clearClose();
      if (byDrag) shut();
    },
    reset() {
      clearOpen();
      clearClose();
      byDrag = false;
    },
    dispose() {
      clearOpen();
      clearClose();
    },
  };
}
