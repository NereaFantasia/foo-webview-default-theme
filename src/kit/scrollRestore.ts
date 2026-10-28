/**
 * 恢复滚动位置的最大等待窗口时长（毫秒）
 * 在返回视图时等待条目流根据历史快照完成重排渲染；超时后废弃恢复请求，
 * 避免后续由用户新操作引起的布局变动被异常拉回旧滚动位置
 */
export const RESTORE_WINDOW_MS = 1000;

/** 滚动容器接口，仅提取 `scrollTop` 属性；浏览器会自动限制越界赋值 */
export interface ScrollElement {
  scrollTop: number;
}

export interface ScrollRestore {
  /** 挂起指定的目标滚动位置与对应的条目流引用 */
  hold(top: number, items: object): void;
  /** 用户主动交互（按键、按指针或滚轮）时取消挂起中的恢复任务 */
  cancel(): void;
  /** 布局完成阶段尝试应用恢复位置，若满足重试条件则更新挂起状态 */
  commit(element: ScrollElement, items: object): void;
}

/**
 * 创建滚动位置恢复控制器，在列表条目流重新布局完成前保持预设的滚动偏移
 * 每次条目更新仅尝试恢复一次，成功到位即解除挂起。若目标位置超出当前内容高度，
 * 则等待下一次条目重排时重试；期间发生用户主动滚动或超时（`RESTORE_WINDOW_MS`）则自动终止恢复
 */
export function createScrollRestore(now: () => number = () => performance.now()): ScrollRestore {
  let pending: { top: number; items: object; until: number; left?: number } | null = null;
  return {
    hold(top, items) {
      pending = { top, items, until: now() + RESTORE_WINDOW_MS };
    },
    cancel() {
      pending = null;
    },
    commit(element, items) {
      const waiting = pending;
      if (!waiting) return;
      if (now() > waiting.until) {
        pending = null;
        return;
      }
      if (waiting.left !== undefined) {
        // 曾尝试赋值但未滚动到位：若位置变化说明发生了用户交互，若条目流未变则无需重复设置
        if (Math.abs(element.scrollTop - waiting.left) >= 1) {
          pending = null;
          return;
        }
        if (waiting.items === items) return;
      }
      element.scrollTop = waiting.top;
      const reached = Math.abs(element.scrollTop - waiting.top) < 1;
      if (reached || waiting.items !== items) pending = null;
      else waiting.left = element.scrollTop;
    },
  };
}
