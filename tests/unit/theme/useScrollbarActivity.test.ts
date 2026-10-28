// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCROLLBAR_FADE_STEP_MS,
  SCROLLBAR_IDLE_DELAY_MS,
  useScrollbarActivity,
} from '../../../src/theme/useScrollbarActivity.ts';

class FakePointerEvent extends MouseEvent {
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

if (typeof globalThis.PointerEvent === 'undefined') {
  Object.defineProperty(globalThis, 'PointerEvent', {
    value: FakePointerEvent,
    configurable: true,
    writable: true,
  });
}

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function mountHook(hook: () => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function TestHarness() {
    hook();
    return null;
  }
  act(() => {
    root.render(createElement(TestHarness));
  });
  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function createScrollable(name: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.testName = name;
  Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 600, configurable: true });
  el.style.overflowY = 'auto';
  document.body.appendChild(el);
  return el;
}

describe('useScrollbarActivity（滚动显示与平滑阶梯淡出）', () => {
  beforeEach(() => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('挂载时不激活任何容器，默认保持透明', () => {
    const containerA = createScrollable('A');
    const containerB = createScrollable('B');

    const { unmount } = mountHook(() => useScrollbarActivity());

    expect(containerA.dataset.scrollbarsVisible).toBeUndefined();
    expect(containerB.dataset.scrollbarsVisible).toBeUndefined();

    unmount();
  });

  it('滚动时立刻激活目标容器并显示滚动条，其他容器不显示', () => {
    const containerA = createScrollable('A');
    const containerB = createScrollable('B');

    const { unmount } = mountHook(() => useScrollbarActivity());

    // 容器 A 发生真实滚动
    act(() => {
      containerA.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    // 容器 A 立刻激活
    expect(containerA.dataset.scrollbarsVisible).toBe('active');
    // 容器 B 保持隐藏
    expect(containerB.dataset.scrollbarsVisible).toBeUndefined();

    unmount();
  });

  it('停止滚动 1500ms 后进入丝滑阶梯淡出，逐步平滑隐去', () => {
    const container = createScrollable('A');

    const { unmount } = mountHook(() => useScrollbarActivity());

    act(() => {
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(container.dataset.scrollbarsVisible).toBe('active');

    // 快进 1500ms，开始进入阶梯淡出
    act(() => {
      vi.advanceTimersByTime(SCROLLBAR_IDLE_DELAY_MS);
    });
    expect(container.dataset.scrollbarsVisible).toBe('fade-3');

    // 40ms 后淡出到下一档
    act(() => {
      vi.advanceTimersByTime(SCROLLBAR_FADE_STEP_MS);
    });
    expect(container.dataset.scrollbarsVisible).toBe('fade-2');

    // 再 40ms
    act(() => {
      vi.advanceTimersByTime(SCROLLBAR_FADE_STEP_MS);
    });
    expect(container.dataset.scrollbarsVisible).toBe('fade-1');

    // 最后 40ms，彻底完全收回
    act(() => {
      vi.advanceTimersByTime(SCROLLBAR_FADE_STEP_MS);
    });
    expect(container.dataset.scrollbarsVisible).toBeUndefined();

    unmount();
  });

  it('淡出过程中发生新的滚动，立即打断淡出并重新激活', () => {
    const container = createScrollable('A');

    const { unmount } = mountHook(() => useScrollbarActivity());

    act(() => {
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(SCROLLBAR_IDLE_DELAY_MS + SCROLLBAR_FADE_STEP_MS);
    });
    expect(container.dataset.scrollbarsVisible).toBe('fade-2');

    // 用户在淡出过程中又滚动了
    act(() => {
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    // 立即重新回到活跃状态
    expect(container.dataset.scrollbarsVisible).toBe('active');

    unmount();
  });

  it('指针从容器 A 移动到容器 B 时，容器 A 平滑淡出，容器 B 立即亮起', () => {
    const containerA = createScrollable('A');
    const containerB = createScrollable('B');

    const { unmount } = mountHook(() => useScrollbarActivity());

    act(() => {
      containerA.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }),
      );
    });
    expect(containerA.dataset.scrollbarsVisible).toBe('active');
    expect(containerB.dataset.scrollbarsVisible).toBeUndefined();

    // 移入容器 B
    act(() => {
      containerB.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 300, clientY: 200, bubbles: true }),
      );
    });
    expect(containerB.dataset.scrollbarsVisible).toBe('active');
    // 容器 A 进入淡出
    expect(containerA.dataset.scrollbarsVisible).toBe('fade-3');

    // 完成容器 A 的淡出
    act(() => {
      vi.advanceTimersByTime(SCROLLBAR_FADE_STEP_MS * 3);
    });
    expect(containerA.dataset.scrollbarsVisible).toBeUndefined();
    // 容器 B 保持 active
    expect(containerB.dataset.scrollbarsVisible).toBe('active');

    unmount();
  });

  it('同一物理屏幕坐标重复派发的虚假 pointermove 会被过滤', () => {
    const container = createScrollable('A');

    const { unmount } = mountHook(() => useScrollbarActivity());

    act(() => {
      container.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 150, clientY: 200, bubbles: true }),
      );
    });
    expect(container.dataset.scrollbarsVisible).toBe('active');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // 假事件
    act(() => {
      container.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 150, clientY: 200, bubbles: true }),
      );
    });

    // 再过 500ms（总计 1500ms），正常进入淡出
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.dataset.scrollbarsVisible).toBe('fade-3');

    unmount();
  });

  it('卸载时清理所有定时器并复位状态', () => {
    const container = createScrollable('A');

    const { unmount } = mountHook(() => useScrollbarActivity());

    act(() => {
      container.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 80, clientY: 80, bubbles: true }),
      );
    });
    expect(container.dataset.scrollbarsVisible).toBe('active');

    unmount();
    expect(container.dataset.scrollbarsVisible).toBeUndefined();
  });
});
