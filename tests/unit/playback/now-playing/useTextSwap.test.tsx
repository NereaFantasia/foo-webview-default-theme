// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useTextSwap,
  type TextSwapSource,
} from '../../../../src/playback/now-playing/useTextSwap.ts';

/** 测试里的动画：结束与取消由用例控制 */
interface FakeAnimation {
  readonly finished: Promise<void>;
  finish(): void;
  cancel(): void;
  cancelled: boolean;
}

function fakeAnimation(): FakeAnimation {
  let done: () => void = () => {};
  let fail: (reason: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    done = resolve;
    fail = reject;
  });
  // 没人接 finished 时不报未处理的拒绝
  finished.catch(() => undefined);
  const animation: FakeAnimation = {
    finished,
    finish: () => done(),
    cancel: () => {
      animation.cancelled = true;
      fail(new Error('cancelled'));
    },
    cancelled: false,
  };
  return animation;
}

function Probe(props: { live: string; swap: TextSwapSource }) {
  const first = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  const shown = useTextSwap(props.live, [first, second], true, props.swap);
  return (
    <div>
      <div ref={first} data-testid="main">
        {shown}
      </div>
      <div ref={second} />
    </div>
  );
}

describe('useTextSwap', () => {
  let container: HTMLDivElement;
  let root: Root;
  let animations: FakeAnimation[];

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    animations = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => {
        const animation = fakeAnimation();
        animations.push(animation);
        return animation;
      }),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const text = () => container.querySelector('[data-testid="main"]')?.textContent;
  const render = (live: string, serial: number) =>
    act(() =>
      root.render(<Probe live={live} swap={{ serial, kind: 'track', direction: 'next' }} />),
    );

  it('换字：退场期间仍显示上一首的文字，退场播放完毕才换成新的', async () => {
    render('甲', 0);
    render('乙', 1);
    expect(text()).toBe('甲');
    await act(async () => {
      for (const animation of animations) animation.finish();
      await Promise.resolve();
    });
    expect(text()).toBe('乙');
  });

  it('退场被取消、没有播放完：文字不能一直停在上一首，超时后换成新的', async () => {
    render('甲', 0);
    render('乙', 1);
    expect(text()).toBe('甲');
    await act(async () => {
      for (const animation of animations) animation.cancel();
      await Promise.resolve();
    });
    expect(text()).toBe('甲');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(text()).toBe('乙');
  });
});
