import { useEffect, type RefObject } from 'react';

/** 滚动条活动保持时长，单位毫秒；停止滚动或指针活动后进入平滑淡出 */
export const SCROLLBAR_IDLE_DELAY_MS = 1500;

/** 淡出每档阶梯间隔，单位毫秒；4 档共 120ms，与 durationFaster 节奏一致 */
export const SCROLLBAR_FADE_STEP_MS = 40;

interface ScrollerState {
  idleTimer?: ReturnType<typeof setTimeout>;
  fadeStep?: number;
  fadeTimer?: ReturnType<typeof setTimeout>;
}

/** 检查元素是否在指定方向上具备可滚动的样式并存在实际内容溢出 */
function isScrollableContainer(node: HTMLElement): boolean {
  if (node.clientHeight === 0 && node.clientWidth === 0) return false;

  const hasY = node.scrollHeight - node.clientHeight > 1;
  const hasX = node.scrollWidth - node.clientWidth > 1;
  if (!hasY && !hasX) {
    return false;
  }

  const style = window.getComputedStyle(node);
  const oy = style.overflowY;
  const ox = style.overflowX;

  const canY = hasY && (oy === 'auto' || oy === 'scroll' || oy === 'overlay');
  const canX = hasX && (ox === 'auto' || ox === 'scroll' || ox === 'overlay');

  return canY || canX;
}

/** 向上逐级查找事件目标所在的最近有效滚动容器 */
function findScrollContainer(
  start: EventTarget | null,
  root?: HTMLElement | null,
): HTMLElement | null {
  let curr = start instanceof HTMLElement ? start : null;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (isScrollableContainer(curr)) {
      return curr;
    }
    if (root && curr === root) {
      break;
    }
    curr = curr.parentElement;
  }
  return null;
}

/**
 * 监听滚动与指针活动，按容器作用域显示并超时淡出滚动条手柄
 * 仅激活发生滚动或指针悬停的容器，并在空闲后阶梯淡出；过滤坐标未变的虚假指针事件
 */
export function useScrollbarActivity(boundaryRef?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const activeMap = new Map<HTMLElement, ScrollerState>();
    let currentHovered: HTMLElement | null = null;
    let lastX = -1;
    let lastY = -1;

    const clearTimers = (state: ScrollerState) => {
      if (state.idleTimer !== undefined) {
        clearTimeout(state.idleTimer);
        state.idleTimer = undefined;
      }
      if (state.fadeTimer !== undefined) {
        clearTimeout(state.fadeTimer);
        state.fadeTimer = undefined;
      }
    };

    const stopAndClear = (node: HTMLElement) => {
      const state = activeMap.get(node);
      if (state) {
        clearTimers(state);
        activeMap.delete(node);
      }
      delete node.dataset.scrollbarsVisible;
    };

    const startFade = (node: HTMLElement) => {
      const state = activeMap.get(node);
      if (!state) return;
      if (state.idleTimer !== undefined) {
        clearTimeout(state.idleTimer);
        state.idleTimer = undefined;
      }

      const steps = ['fade-3', 'fade-2', 'fade-1'] as const;
      const stepIndex = state.fadeStep ?? 0;

      if (stepIndex < steps.length) {
        node.dataset.scrollbarsVisible = steps[stepIndex];
        state.fadeStep = stepIndex + 1;
        state.fadeTimer = setTimeout(() => {
          startFade(node);
        }, SCROLLBAR_FADE_STEP_MS);
      } else {
        stopAndClear(node);
      }
    };

    const activate = (node: HTMLElement, delay = SCROLLBAR_IDLE_DELAY_MS) => {
      let state = activeMap.get(node);
      if (!state) {
        state = {};
        activeMap.set(node, state);
      }

      clearTimers(state);
      state.fadeStep = 0;
      node.dataset.scrollbarsVisible = 'active';

      state.idleTimer = setTimeout(() => {
        startFade(node);
      }, delay);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.clientX === lastX && event.clientY === lastY) return;
      lastX = event.clientX;
      lastY = event.clientY;

      const root = boundaryRef?.current;
      const scroller = findScrollContainer(event.target, root);

      if (currentHovered && currentHovered !== scroller) {
        startFade(currentHovered);
      }
      currentHovered = scroller;

      if (scroller) {
        activate(scroller);
      }
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      const root = boundaryRef?.current;
      if (
        target instanceof HTMLElement &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        activate(target);
      } else {
        const scroller = findScrollContainer(target, root);
        if (scroller) activate(scroller);
      }
    };

    const onWheel = (event: WheelEvent) => {
      const root = boundaryRef?.current;
      const scroller = findScrollContainer(event.target, root);
      if (scroller) {
        activate(scroller);
      }
    };

    const onPointerLeave = () => {
      lastX = -1;
      lastY = -1;
      currentHovered = null;
      for (const node of activeMap.keys()) {
        startFade(node);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('mouseleave', onPointerLeave, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mouseleave', onPointerLeave);

      for (const [node, state] of activeMap.entries()) {
        clearTimers(state);
        delete node.dataset.scrollbarsVisible;
      }
      activeMap.clear();
    };
  }, [boundaryRef]);
}
