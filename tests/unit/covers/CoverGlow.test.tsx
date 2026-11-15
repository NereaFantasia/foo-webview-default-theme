// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

/** 光晕的内容是 `.bloom` 与 `.grain` 两层，没挂上时外框里是空的 */
const LAYERS = 2;

/** jsdom 不实现 canvas 的 2d 上下文：换成只记 `drawImage` 的替身，用完还原 */
const GET_CONTEXT = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
function fakeContext(drawImage: () => void) {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage }),
  });
}

describe('光晕的入场与跟随', () => {
  let environment: ActEnvironment;
  let host: HTMLDivElement;
  let root: Root;

  // 第一次载入界面库与主题要几秒，先热一遍，免得算进第一个用例的超时里
  beforeAll(async () => {
    await import('../../../src/covers/CoverGlow.tsx');
    await import('../../../src/covers/CoverTheme.tsx');
  }, 60_000);

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (GET_CONTEXT) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', GET_CONTEXT);
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  /** 每个用例要一份没画过光晕的模块状态，「本次运行里是否画过」是模块级的 */
  async function glow() {
    vi.resetModules();
    const { CoverGlow } = await import('../../../src/covers/CoverGlow.tsx');
    const { CoverVisualContext } = await import('../../../src/covers/CoverTheme.tsx');
    return (
      visual: { url: string; video?: HTMLVideoElement },
      props: { synced?: boolean } = {},
    ): ReactElement =>
      createElement(
        CoverVisualContext,
        { value: { url: visual.url, profile: null, video: visual.video ?? null } },
        createElement(CoverGlow, props),
      );
  }
  const outer = () => host.querySelector<HTMLElement>('[data-cover-glow]');
  const layers = () => outer()?.children.length ?? 0;

  it('本次运行里第一次画光晕等满 1 秒，画过之后再挂上的光晕不再等', async () => {
    const element = await glow();
    act(() => root.render(element({ url: 'a.png' })));
    expect(layers()).toBe(0);
    act(() => void vi.advanceTimersByTime(999));
    expect(layers()).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(layers()).toBe(LAYERS);
    // 换一处页面：重新挂上的光晕当时就画
    act(() => root.render(createElement('div')));
    act(() => root.render(element({ url: 'b.png' })));
    expect(layers()).toBe(LAYERS);
  });

  it('跟着头图出的光晕不按时间等：挂上就在，等自己的图就位才淡入', async () => {
    const element = await glow();
    act(() => root.render(element({ url: 'hero.png' }, { synced: true })));
    expect(layers()).toBe(LAYERS);
    expect(outer()?.hasAttribute('data-hold')).toBe(true);
    // 图没到，过多久都不显现
    act(() => void vi.advanceTimersByTime(5000));
    expect(outer()?.hasAttribute('data-hold')).toBe(true);
    const image = host.querySelector('img');
    act(() => void image?.dispatchEvent(new Event('load')));
    expect(outer()?.hasAttribute('data-hold')).toBe(false);
  });

  it('头图模式下换了图（封面换成头图）要重新等新图就位，等的时候当场隐去；图取不到也算就位', async () => {
    const element = await glow();
    // 先是普通光晕，画着封面
    act(() => root.render(element({ url: 'cover.png' })));
    act(() => void vi.advanceTimersByTime(1000));
    act(() => void host.querySelector('img')?.dispatchEvent(new Event('load')));
    expect(outer()?.hasAttribute('data-hold')).toBe(false);
    // 头图能画了：切到头图模式、换成头图，新图没到之前隐着
    act(() => root.render(element({ url: 'hero.png' }, { synced: true })));
    expect(outer()?.hasAttribute('data-hold')).toBe(true);
    act(() => void host.querySelector('img')?.dispatchEvent(new Event('load')));
    expect(outer()?.hasAttribute('data-hold')).toBe(false);
    // 再换一张：仍要等它；取不到不能一直等
    act(() => root.render(element({ url: 'other.png' }, { synced: true })));
    expect(outer()?.hasAttribute('data-hold')).toBe(true);
    act(() => void host.querySelector('img')?.dispatchEvent(new Event('error')));
    expect(outer()?.hasAttribute('data-hold')).toBe(false);
  });

  it('头图还在取时（没切到头图模式）光晕不动：仍按原来的时机画，不被头图的等待拖住', async () => {
    const element = await glow();
    act(() => root.render(element({ url: 'cover.png' })));
    act(() => void vi.advanceTimersByTime(1000));
    expect(layers()).toBe(LAYERS);
    expect(outer()?.hasAttribute('data-synced')).toBe(false);
    expect(outer()?.hasAttribute('data-hold')).toBe(false);
  });

  it('跟着头图出的光晕画出来后，之后挂上的光晕也不再等', async () => {
    const element = await glow();
    act(() => root.render(element({ url: 'hero.png' }, { synced: true })));
    act(() => void host.querySelector('img')?.dispatchEvent(new Event('load')));
    act(() => root.render(createElement('div')));
    act(() => root.render(element({ url: 'cover.png' })));
    expect(layers()).toBe(LAYERS);
  });

  describe('视频', () => {
    /** 一个能放的视频替身：只给光晕要读的几项 */
    function clip() {
      const video = document.createElement('video');
      const state = { paused: true };
      Object.defineProperty(video, 'readyState', { value: 4 });
      Object.defineProperty(video, 'videoWidth', { value: 1280 });
      Object.defineProperty(video, 'paused', { get: () => state.paused });
      return {
        video,
        play() {
          state.paused = false;
          video.dispatchEvent(new Event('play'));
        },
        pause() {
          state.paused = true;
          video.dispatchEvent(new Event('pause'));
        },
      };
    }

    /** 认得 requestVideoFrameCallback 的视频：测试手动「出帧」，一次出一个新画面 */
    function presenting() {
      const made = clip();
      const pending = new Map<number, (now: number) => void>();
      let next = 1;
      Object.assign(made.video, {
        requestVideoFrameCallback(callback: (now: number) => void) {
          const id = next;
          next += 1;
          pending.set(id, callback);
          return id;
        },
        cancelVideoFrameCallback(id: number) {
          pending.delete(id);
        },
      });
      return {
        ...made,
        waiting: () => pending.size,
        present(now: number) {
          const callbacks = [...pending.values()];
          pending.clear();
          for (const callback of callbacks) callback(now);
        },
      };
    }

    it('按视频出的新画面取样：24 帧的视频每帧都取，60 帧的视频不超过每秒 30 次；暂停后不再等帧', async () => {
      const draw = vi.fn();
      fakeContext(draw);
      const element = await glow();
      const { video, play, pause, present, waiting } = presenting();
      act(() => root.render(element({ url: 'hero.png', video }, { synced: true })));
      act(() => play());
      const base = draw.mock.calls.length;
      // 24 帧：每 41.7 毫秒一帧，一秒里 24 帧都取
      for (let at = 1; at <= 24; at += 1) act(() => present(at * (1000 / 24)));
      expect(draw.mock.calls.length - base).toBe(24);
      // 60 帧：每 16.7 毫秒一帧，一秒里只取约一半
      const before = draw.mock.calls.length;
      for (let at = 1; at <= 60; at += 1) act(() => present(2000 + at * (1000 / 60)));
      const taken = draw.mock.calls.length - before;
      expect(taken).toBeGreaterThanOrEqual(28);
      expect(taken).toBeLessThanOrEqual(31);
      act(() => pause());
      expect(waiting()).toBe(0);
    });

    it('第一帧到了就画；播放时每隔一小段取一次画面，光晕跟着视频；暂停后停在最后一帧', async () => {
      const draw = vi.fn();
      fakeContext(draw);
      const element = await glow();
      const { video, play, pause } = clip();
      act(() => root.render(element({ url: 'hero.png', video }, { synced: true })));
      const first = draw.mock.calls.length;
      expect(first).toBeGreaterThan(0);
      // 没放时不取样
      act(() => void vi.advanceTimersByTime(1000));
      expect(draw).toHaveBeenCalledTimes(first);
      act(() => play());
      act(() => void vi.advanceTimersByTime(1000));
      const playing = draw.mock.calls.length;
      expect(playing).toBeGreaterThan(first + 3);
      act(() => pause());
      act(() => void vi.advanceTimersByTime(1000));
      expect(draw).toHaveBeenCalledTimes(playing);
      expect(host.querySelector('canvas')?.hasAttribute('data-ready')).toBe(true);
    });
  });
});
