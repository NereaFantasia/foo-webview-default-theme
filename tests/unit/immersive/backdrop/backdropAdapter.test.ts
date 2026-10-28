// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  BACKDROP_LOW_FREQ,
  BACKDROP_MAX_FPS,
  BACKDROP_RENDER_SCALE,
  BACKDROP_RETRY_MS,
  backdropCover,
  createBackdrop,
  type BackdropInputs,
} from '../../../../src/immersive/backdrop/backdropAdapter.ts';
import type { BackdropRendererId } from '../../../../src/immersive/backdrop/backdropChoice.ts';
import type { BackdropRenderer } from '../../../../src/immersive/backdrop/backdropRegistry.ts';
import type { FrameClock } from '../../../../src/immersive/frame/frameScheduler.ts';

/** 替身渲染器：记下收到的调用，canvas 是真元素 */
function fakeRenderer(id: BackdropRendererId) {
  const calls: string[] = [];
  const canvas = document.createElement('canvas');
  canvas.dataset['renderer'] = id;
  const renderer: BackdropRenderer = {
    getElement: () => canvas,
    setAlbum: (source) => {
      calls.push(`album:${source}`);
      return Promise.resolve();
    },
    setRenderScale: (scale) => void calls.push(`scale:${scale}`),
    setLowFreqVolume: (volume) => void calls.push(`lowfreq:${volume}`),
    setFPS: (fps) => void calls.push(`fps:${fps}`),
    setStaticMode: (enable) => void calls.push(`static:${enable}`),
    setHasLyric: (has) => void calls.push(`lyric:${has}`),
    dispose: () => void calls.push('dispose'),
  };
  return { renderer, calls, canvas };
}

/** 手动走的帧时钟：`frame(ms)` 让排着的那一拍在 ms 毫秒之后到 */
function manualClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, (time: number) => void>();
  const clock: FrameClock = {
    request: (callback) => {
      const handle = next++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => void pending.delete(handle),
  };
  return {
    clock,
    pending: () => pending.size,
    frame(ms: number) {
      now += ms;
      const due = [...pending];
      pending.clear();
      for (const [, callback] of due) callback(now);
    },
  };
}

function setup(options: { failOn?: BackdropRendererId } = {}) {
  const host = document.createElement('div');
  const made: ReturnType<typeof fakeRenderer>[] = [];
  const timing = manualClock();
  const events: string[] = [];
  const backdrop = createBackdrop(host, {
    create: (id) => {
      if (id === options.failOn) throw new Error('context');
      const fake = fakeRenderer(id);
      made.push(fake);
      return fake.renderer;
    },
    onUnavailable: (id) => void events.push(`unavailable:${id}`),
    onDegrade: () => void events.push('degrade'),
    onRecover: () => void events.push('recover'),
    clock: timing.clock,
  });
  return { host, made, timing, events, backdrop, last: () => made[made.length - 1]! };
}

const base: BackdropInputs = {
  renderer: 'mesh',
  cover: 'fb2k://cover/a',
  hasLyric: true,
  reducedMotion: false,
  degraded: false,
  visible: true,
  fpsCap: null,
};

describe('backdropCover', () => {
  it('地址取到了（解码中或已显示）就用，没有图、缺图、读取失败退回中性', () => {
    const url = 'fb2k://cover/a';
    expect(backdropCover({ url, status: 'loading', token: 1 })).toBe(url);
    expect(backdropCover({ url, status: 'shown', token: 1 })).toBe(url);
    expect(backdropCover({ url, status: 'missing', token: 1 })).toBeNull();
    expect(backdropCover({ url, status: 'failed', token: 1 })).toBeNull();
    expect(backdropCover({ url: null, status: 'idle', token: 0 })).toBeNull();
    expect(backdropCover({ url: null, status: 'loading', token: 1 })).toBeNull();
  });
});

describe('createBackdrop：建与拆', () => {
  it('第一次更新建渲染器、放进宿主，并把各项输入交给它', () => {
    const { host, last, backdrop } = setup();
    backdrop.update(base);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(last().calls).toEqual([
      `scale:${BACKDROP_RENDER_SCALE}`,
      `lowfreq:${BACKDROP_LOW_FREQ}`,
      `fps:${BACKDROP_MAX_FPS}`,
      'static:false',
      'lyric:true',
      'album:fb2k://cover/a',
    ]);
  });

  it('输入没变就不再发，重复更新无害', () => {
    const { last, backdrop, made } = setup();
    backdrop.update(base);
    const before = [...last().calls];
    backdrop.update({ ...base });
    expect(last().calls).toEqual(before);
    expect(made).toHaveLength(1);
  });

  it('换渲染器：旧的释放并撤 canvas，新的按最新输入重建', () => {
    const { host, made, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, renderer: 'titanium' });
    expect(made).toHaveLength(2);
    expect(made[0]!.calls).toContain('dispose');
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(host.querySelector('canvas')?.dataset['renderer']).toBe('titanium');
    expect(made[1]!.calls).toContain('album:fb2k://cover/a');
  });

  it('renderer 为 null 或窗口看不见都释放，可见后重建并带上最新封面', () => {
    const { host, made, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, visible: false, cover: 'fb2k://cover/b' });
    expect(made[0]!.calls.at(-1)).toBe('dispose');
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    backdrop.update({ ...base, visible: true, cover: 'fb2k://cover/b' });
    expect(made).toHaveLength(2);
    expect(made[1]!.calls).toContain('album:fb2k://cover/b');
    backdrop.update({ ...base, renderer: null });
    expect(made[1]!.calls.at(-1)).toBe('dispose');
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('建渲染器抛错：报告 id、不放 canvas、不抛出；换一个还能建', () => {
    const { host, made, events, backdrop } = setup({ failOn: 'titanium' });
    expect(() => backdrop.update({ ...base, renderer: 'titanium' })).not.toThrow();
    expect(events).toEqual(['unavailable:titanium']);
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    backdrop.update({ ...base, renderer: 'mesh' });
    expect(made).toHaveLength(1);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('释放时渲染器抛错也照样撤 canvas', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    const backdrop = createBackdrop(host, {
      create: () => ({
        getElement: () => canvas,
        setAlbum: () => Promise.resolve(),
        setRenderScale: () => {},
        setLowFreqVolume: () => {},
        setFPS: () => {},
        setStaticMode: () => {},
        setHasLyric: () => {},
        dispose: () => {
          throw new Error('gone');
        },
      }),
      onUnavailable: () => {},
      onDegrade: () => {},
      onRecover: () => {},
    });
    backdrop.update(base);
    expect(() => backdrop.dispose()).not.toThrow();
    expect(host.contains(canvas)).toBe(false);
  });
});

describe('createBackdrop：各项输入', () => {
  it('帧率取 60 与用户上限里小的那个', () => {
    const { last, backdrop } = setup();
    backdrop.update({ ...base, fpsCap: 144 });
    backdrop.update({ ...base, fpsCap: 30 });
    backdrop.update({ ...base, fpsCap: null });
    expect(last().calls.filter((call) => call.startsWith('fps:'))).toEqual([
      'fps:60',
      'fps:30',
      'fps:60',
    ]);
  });

  it('减弱动效开静态，恢复后流动；播放暂停不影响', () => {
    const { last, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, reducedMotion: true });
    backdrop.update({ ...base, reducedMotion: false });
    expect(last().calls.filter((call) => call.startsWith('static:'))).toEqual([
      'static:false',
      'static:true',
      'static:false',
    ]);
  });

  it('不传有无歌词就不下发，传了才下发', () => {
    const { last, backdrop } = setup();
    backdrop.update({ ...base, hasLyric: undefined });
    expect(last().calls.some((call) => call.startsWith('lyric:'))).toBe(false);
    backdrop.update({ ...base, hasLyric: false });
    backdrop.update({ ...base, hasLyric: undefined });
    expect(last().calls.filter((call) => call.startsWith('lyric:'))).toEqual(['lyric:false']);
  });

  it('守门已判扛不住时从一开始就是静态', () => {
    const { last, timing, backdrop } = setup();
    backdrop.update({ ...base, degraded: true });
    expect(last().calls).toContain('static:true');
    expect(last().calls).not.toContain('static:false');
    expect(timing.pending()).toBe(0);
  });

  it('换封面、没有封面、有无歌词都只发变了的那项', () => {
    const { last, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, cover: 'fb2k://cover/b' });
    backdrop.update({ ...base, cover: null, hasLyric: false });
    expect(last().calls.slice(6)).toEqual(['album:fb2k://cover/b', 'lyric:false', 'album:']);
  });

  it('封面加载抛错不影响后面的更新', async () => {
    const host = document.createElement('div');
    const calls: string[] = [];
    const backdrop = createBackdrop(host, {
      create: () => ({
        getElement: () => document.createElement('canvas'),
        setAlbum: (source) => {
          calls.push(source);
          return Promise.reject(new Error('load'));
        },
        setRenderScale: () => {},
        setLowFreqVolume: () => {},
        setFPS: () => {},
        setStaticMode: () => {},
        setHasLyric: () => {},
        dispose: () => {},
      }),
      onUnavailable: () => {},
      onDegrade: () => {},
      onRecover: () => {},
    });
    backdrop.update(base);
    await Promise.resolve();
    expect(() => backdrop.update({ ...base, cover: 'fb2k://cover/b' })).not.toThrow();
    expect(calls).toEqual(['fb2k://cover/a', 'fb2k://cover/b']);
  });
});

describe('createBackdrop：帧率守门', () => {
  it('流动时量页面帧间隔，静态、释放后不量', () => {
    const { timing, backdrop } = setup();
    backdrop.update(base);
    expect(timing.pending()).toBe(1);
    backdrop.update({ ...base, reducedMotion: true });
    expect(timing.pending()).toBe(0);
    backdrop.update(base);
    expect(timing.pending()).toBe(1);
    backdrop.update({ ...base, visible: false });
    expect(timing.pending()).toBe(0);
  });

  it('帧率正常不跳闸', () => {
    const { timing, events, backdrop } = setup();
    backdrop.update(base);
    for (let i = 0; i < 300; i++) timing.frame(16.7);
    expect(events).toEqual([]);
    expect(timing.pending()).toBe(1);
  });

  it('长期扛不住：报告一次、转静态，之后不再流动也不再量', () => {
    const { timing, events, last, backdrop } = setup();
    backdrop.update(base);
    for (let i = 0; i < 400 && events.length === 0; i++) timing.frame(60);
    expect(events).toEqual(['degrade']);
    expect(last().calls.at(-1)).toBe('static:true');
    expect(timing.pending()).toBe(0);
    // 调用方把 degraded 记下之前，减弱动效来回切一次，也不能再流动
    backdrop.update({ ...base, reducedMotion: true });
    backdrop.update(base);
    expect(last().calls.filter((call) => call === 'static:false')).toHaveLength(1);
    expect(timing.pending()).toBe(0);
  });

  it('跳闸后隔 30 s 通知撤销，调用方撤销后重新量；再跳闸隔 60 s', () => {
    vi.useFakeTimers();
    try {
      const { timing, events, last, backdrop } = setup();
      backdrop.update(base);
      for (let i = 0; i < 400 && events.length === 0; i++) timing.frame(60);
      expect(events).toEqual(['degrade']);
      vi.advanceTimersByTime(BACKDROP_RETRY_MS - 1);
      expect(events).toEqual(['degrade']);
      vi.advanceTimersByTime(1);
      expect(events).toEqual(['degrade', 'recover']);
      // 调用方撤销了判定，下一次更新就流动并重新量
      backdrop.update(base);
      expect(last().calls.at(-1)).toBe('static:false');
      expect(timing.pending()).toBe(1);
      for (let i = 0; i < 400 && events.length === 2; i++) timing.frame(60);
      expect(events).toEqual(['degrade', 'recover', 'degrade']);
      vi.advanceTimersByTime(BACKDROP_RETRY_MS * 2 - 1);
      expect(events).toHaveLength(3);
      vi.advanceTimersByTime(1);
      expect(events.at(-1)).toBe('recover');
    } finally {
      vi.useRealTimers();
    }
  });

  it('窗口看不见时清掉判定与重试，可见后重新量，间隔也从头算', () => {
    vi.useFakeTimers();
    try {
      const { made, timing, events, backdrop } = setup();
      backdrop.update(base);
      for (let i = 0; i < 400 && events.length === 0; i++) timing.frame(60);
      backdrop.update({ ...base, visible: false });
      vi.advanceTimersByTime(BACKDROP_RETRY_MS * 16);
      expect(events).toEqual(['degrade']);
      backdrop.update(base);
      expect(made[1]!.calls).not.toContain('static:true');
      expect(timing.pending()).toBe(1);
      for (let i = 0; i < 400 && events.length === 1; i++) timing.frame(60);
      vi.advanceTimersByTime(BACKDROP_RETRY_MS);
      expect(events).toEqual(['degrade', 'degrade', 'recover']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('释放时撤掉重试', () => {
    vi.useFakeTimers();
    try {
      const { timing, events, backdrop } = setup();
      backdrop.update(base);
      for (let i = 0; i < 400 && events.length === 0; i++) timing.frame(60);
      backdrop.dispose();
      vi.advanceTimersByTime(BACKDROP_RETRY_MS * 16);
      expect(events).toEqual(['degrade']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('释放后撤掉排着的那一拍', () => {
    const { timing, backdrop } = setup();
    backdrop.update(base);
    backdrop.dispose();
    expect(timing.pending()).toBe(0);
  });
});

describe('createBackdrop：释放', () => {
  it('渲染器拆掉、canvas 撤掉', () => {
    const { host, made, backdrop } = setup();
    backdrop.update(base);
    backdrop.dispose();
    expect(made[0]!.calls.at(-1)).toBe('dispose');
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  });
});
