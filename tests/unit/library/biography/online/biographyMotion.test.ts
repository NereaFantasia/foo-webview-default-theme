import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppleMotionClip } from '../../../../../src/library/biography/apple/appleMedia.ts';
import { startBiographyMotion } from '../../../../../src/library/biography/online/biographyMotion.ts';
import type { MotionVideoResult } from '../../../../../src/library/biography/online/appleMotionVideo.ts';

const CLIP: AppleMotionClip = {
  video: 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic211/v4/71/d3/P1_default.m3u8',
  poster: 'https://is1-ssl.mzstatic.com/image/thumb/Video221/v4/1a/ef/queen',
};
const OTHER: AppleMotionClip = { ...CLIP, video: CLIP.video.replace('P1_', 'P2_') };
const OK: MotionVideoResult = { ok: true, url: 'https://mvod.itunes.apple.com/a/P1_video-.mp4' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

function setup(answers: (master: string, width: number) => Promise<MotionVideoResult>) {
  const store = createStore();
  const clip = atom<AppleMotionClip | null>(CLIP);
  const enabled = atom(true);
  const active = atom(true);
  const resolve = vi.fn(answers);
  const motion = startBiographyMotion(store, { clip, enabled, active, width: () => 1500 }, resolve);
  return { store, clip, enabled, active, resolve, motion };
}

describe('动态艺术照的视频地址', () => {
  it('打开、艺人页显示、有宽幅动态艺术照时取一次，取到后交出 mp4 地址', async () => {
    const { store, motion, resolve } = setup(async () => OK);
    expect(store.get(motion.state)).toEqual({ status: 'loading', url: null });
    await vi.runAllTimersAsync();
    expect(store.get(motion.state)).toEqual({ status: 'ready', url: OK.ok ? OK.url : null });
    expect(resolve).toHaveBeenCalledTimes(1);
    // 按头部宽度挑画质，把宽度交给解析
    expect(resolve).toHaveBeenCalledWith(CLIP.video, 1500);
    motion.dispose();
  });

  it('开关关着、艺人页没显示、没有动态艺术照时都不请求，状态是空闲', async () => {
    const { store, enabled, active, clip, motion, resolve } = setup(async () => OK);
    await vi.runAllTimersAsync();
    for (const [source, value] of [
      [enabled, false],
      [active, false],
    ] as const) {
      store.set(source, value);
      expect(store.get(motion.state).status).toBe('idle');
      store.set(source, true);
      await vi.runAllTimersAsync();
    }
    store.set(clip, null);
    expect(store.get(motion.state).status).toBe('idle');
    // 来回切换用的是记下的结果，没有再请求
    expect(resolve).toHaveBeenCalledTimes(1);
    motion.dispose();
  });

  it('失败后在重试时间之前不再请求，之后才再试；换了一位艺人，上一位晚到的答复不算', async () => {
    let attempt = 0;
    const { store, clip, motion, resolve } = setup(async () => {
      attempt += 1;
      return attempt === 1 ? { ok: false, retryAt: Date.now() + 60_000 } : OK;
    });
    await vi.runAllTimersAsync();
    expect(store.get(motion.state).status).toBe('failed');
    store.set(clip, null);
    store.set(clip, CLIP);
    expect(store.get(motion.state).status).toBe('failed');
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    store.set(clip, null);
    store.set(clip, CLIP);
    await vi.runAllTimersAsync();
    expect(store.get(motion.state).status).toBe('ready');
    expect(resolve).toHaveBeenCalledTimes(2);

    // 慢的那次答复到的时候艺人已经换了
    let release: (value: MotionVideoResult) => void = () => {};
    const slow = setup((master) =>
      master === CLIP.video
        ? new Promise<MotionVideoResult>((resolveSlow) => {
            release = resolveSlow;
          })
        : Promise.resolve({ ok: true, url: 'https://mvod.itunes.apple.com/b/P2_video-.mp4' }),
    );
    slow.store.set(slow.clip, OTHER);
    await vi.runAllTimersAsync();
    release(OK);
    await vi.runAllTimersAsync();
    expect(slow.store.get(slow.motion.state)).toEqual({
      status: 'ready',
      url: 'https://mvod.itunes.apple.com/b/P2_video-.mp4',
    });
    slow.motion.dispose();
    motion.dispose();
  });
});
