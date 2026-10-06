/**
 * 交还的滚动位置最多挂这么久，毫秒；过了就作罢。挂着是在等条目流按快照里的过滤词重排，那在交还后的
 * 一两次提交里就到；再晚才变的条目流是用户自己的操作带来的，不该把视图拉回旧位置。
 */
export const RESTORE_WINDOW_MS = 1000;

/** 滚动容器上用到的那一项；浏览器会把越界的值夹到能滚到的范围里。 */
export interface ScrollElement {
  scrollTop: number;
}

export interface ScrollRestore {
  /** 交还一个滚动位置；`items` 是交还时的条目流，只按身份比。 */
  hold(top: number, items: object): void;
  /** 用户动了（按键、按下指针、滚轮）：挂着的作罢。 */
  cancel(): void;
  /** 每次提交后在布局阶段调，该设就设。 */
  commit(element: ScrollElement, items: object): void;
}

/**
 * 封面墙交还滚动的挂起。每一份条目流只设一次：滚到位就撤；目标超出了现在的内容高（库里少了专辑、
 * 换了更小的封面），浏览器停在最低处，这时只等条目流再变一次再设，其间用户自己滚过、动过或过了期限
 * 就作罢。
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
        // 设过一次没滚到位：停下的位置变了是用户滚过，条目流没变就不必再设。
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
