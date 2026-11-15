// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FAST_SCROLL_SPEED,
  SCROLL_IDLE_MS,
  watchFastScroll,
} from '../../../src/covers/fastScroll.ts';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup() {
  vi.useFakeTimers();
  let clock = 0;
  const changes: boolean[] = [];
  const stop = watchFastScroll(
    document,
    (fast) => changes.push(fast),
    () => clock,
  );
  const container = () => {
    const element = document.createElement('div');
    document.body.append(element);
    return element;
  };
  /** 在 `at` 毫秒把容器滚到 `top`，触发一次 scroll */
  const scrollTo = (element: HTMLElement, top: number, at: number) => {
    clock = at;
    element.scrollTop = top;
    element.dispatchEvent(new Event('scroll'));
  };
  return { changes, stop, container, scrollTo };
}

describe('watchFastScroll', () => {
  it('速度达到门槛报一次「快」，仍在快不重复报；慢下来报「不快」', () => {
    const { changes, container, scrollTo } = setup();
    const list = container();
    scrollTo(list, 0, 0);
    // 每 16 毫秒滚 40 像素，约 2.5 像素每毫秒
    scrollTo(list, 40, 16);
    scrollTo(list, 80, 32);
    expect(changes).toEqual([true]);
    // 16 毫秒只滚 5 像素，约 0.3 像素每毫秒，低于「慢下来」的门槛
    scrollTo(list, 85, 48);
    expect(changes).toEqual([true, false]);
  });

  it('正常浏览的速度不算快，封面照常加载', () => {
    const { changes, container, scrollTo } = setup();
    const list = container();
    scrollTo(list, 0, 0);
    // 每 16 毫秒滚 12 像素，约 0.75 像素每毫秒，低于门槛
    for (let step = 1; step <= 20; step += 1) scrollTo(list, step * 12, step * 16);
    expect(0.75).toBeLessThan(FAST_SCROLL_SPEED);
    expect(changes).toEqual([]);
  });

  it('停下来（一阵子没有新的滚动）报「不快」', () => {
    const { changes, container, scrollTo } = setup();
    const list = container();
    scrollTo(list, 0, 0);
    scrollTo(list, 60, 16);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);
  });

  it('各容器各算各的：两个容器交替慢滚，不拿一个的位置去减另一个', () => {
    const { changes, container, scrollTo } = setup();
    const left = container();
    const right = container();
    scrollTo(left, 0, 0);
    scrollTo(right, 5000, 8);
    scrollTo(left, 8, 16);
    scrollTo(right, 5008, 24);
    expect(changes).toEqual([]);
  });

  it('隔了很久才来的下一次不算速度：一次大跳转不会被当成快速滚动', () => {
    const { changes, container, scrollTo } = setup();
    const list = container();
    scrollTo(list, 0, 0);
    scrollTo(list, 9000, SCROLL_IDLE_MS + 400);
    expect(changes).toEqual([]);
  });

  it('停止监视：还在「快」时先报「不快」，之后的滚动不再理会', () => {
    const { changes, stop, container, scrollTo } = setup();
    const list = container();
    scrollTo(list, 0, 0);
    scrollTo(list, 60, 16);
    stop();
    expect(changes).toEqual([true, false]);
    scrollTo(list, 200, 32);
    scrollTo(list, 400, 48);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true, false]);
  });
});
