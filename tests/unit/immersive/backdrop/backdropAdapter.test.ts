// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  BACKDROP_LEAVE_MS,
  BACKDROP_LOW_FREQ,
  BACKDROP_MAX_FPS,
  BACKDROP_RENDER_SCALE,
  BACKDROP_RETRY_MS,
  BACKDROP_REVEAL_MS,
  BACKDROP_REVEAL_WAIT_MS,
  BACKDROP_SWAP_MS,
  PAUSE_SPEED,
  TITANIUM_PULSE,
  backdropCover,
  createBackdrop,
  type BackdropInputs,
  type Fade,
} from '../../../../src/immersive/backdrop/backdropAdapter.ts';
import type {
  LowFreqDrive,
  LowFreqFactory,
  LowFreqMode,
} from '../../../../src/immersive/backdrop/backdropAudio.ts';
import type { BackdropRendererId } from '../../../../src/immersive/backdrop/backdropChoice.ts';
import {
  NO_OPTIONS,
  parseBackdropOptions,
  resolveBackdropOptions,
} from '../../../../src/immersive/backdrop/backdropOptions.ts';
import type { BackdropRenderer } from '../../../../src/immersive/backdrop/backdropRegistry.ts';
import type { FrameClock } from '../../../../src/immersive/frame/frameScheduler.ts';

/** 替身渲染器：记下收到的调用，canvas 是真元素 */
function fakeRenderer(id: BackdropRendererId, hangAlbum = false) {
  const calls: string[] = [];
  const canvas = document.createElement('canvas');
  canvas.dataset['renderer'] = id;
  const renderer: BackdropRenderer = {
    getElement: () => canvas,
    setAlbum: (source) => {
      calls.push(`album:${source}`);
      return hangAlbum ? new Promise<void>(() => {}) : Promise.resolve();
    },
    setRenderScale: (scale) => void calls.push(`scale:${scale}`),
    setLowFreqVolume: (volume) => void calls.push(`lowfreq:${volume}`),
    setFPS: (fps) => void calls.push(`fps:${fps}`),
    setFlowSpeed: (speed) => void calls.push(`flow:${speed}`),
    setOptions: (patch) => void calls.push(`options:${JSON.stringify(patch)}`),
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

/** 替身低频音量驱动：记下模式的切换与释放，`volume` 模拟驱动往渲染器写的值 */
function fakeDrives() {
  const drives: {
    modes: LowFreqMode[];
    disposed: boolean;
    restVolume: number;
    gain(): number;
    volume(value: number): void;
  }[] = [];
  const factory: LowFreqFactory = ({ restVolume, gain, onVolume }) => {
    const record = {
      modes: [] as LowFreqMode[],
      disposed: false,
      volume: onVolume,
      restVolume,
      gain: () => gain?.() ?? 1,
    };
    drives.push(record);
    const drive: LowFreqDrive = {
      set: (mode) => void record.modes.push(mode),
      dispose: () => void (record.disposed = true),
    };
    return drive;
  };
  return { drives, factory };
}

/** 渐变的替身：记录每一段；`finish()` 使其结束，`cancel()` 后 `finished` 被拒绝，与 Web Animations 一致 */
function fakeFades() {
  const started: {
    layer: HTMLElement;
    from: number;
    to: number;
    ms: number;
    cancelled: boolean;
    finish(): void;
  }[] = [];
  const fade = (layer: HTMLElement, from: number, to: number, ms: number): Fade => {
    let finish = () => {};
    let reject: (reason: unknown) => void = () => {};
    const finished = new Promise<void>((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    const record = { layer, from, to, ms, cancelled: false, finish: () => finish() };
    started.push(record);
    return {
      finished,
      cancel: () => {
        record.cancelled = true;
        reject(new Error('AbortError'));
      },
    };
  };
  return { started, fade };
}

/** 等待已排队的微任务执行完毕 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: {
    failOn?: BackdropRendererId;
    lowFreq?: boolean;
    withFades?: boolean;
    hangAlbum?: boolean;
  } = {},
) {
  const host = document.createElement('div');
  const made: ReturnType<typeof fakeRenderer>[] = [];
  const fades = fakeFades();
  const timing = manualClock();
  const events: string[] = [];
  const lowFreq = fakeDrives();
  const backdrop = createBackdrop(host, {
    create: (id) => {
      if (id === options.failOn) throw new Error('context');
      const fake = fakeRenderer(id, options.hangAlbum);
      made.push(fake);
      return fake.renderer;
    },
    onUnavailable: (id) => void events.push(`unavailable:${id}`),
    onDegrade: () => void events.push('degrade'),
    onRecover: () => void events.push('recover'),
    clock: timing.clock,
    openLowFreq: options.lowFreq ? lowFreq.factory : undefined,
    fade: options.withFades ? fades.fade : undefined,
  });
  return {
    host,
    made,
    fades: fades.started,
    timing,
    events,
    backdrop,
    drives: lowFreq.drives,
    last: () => made[made.length - 1]!,
  };
}

const base: BackdropInputs = {
  renderer: 'mesh',
  cover: 'fb2k://cover/a',
  hasLyric: true,
  reducedMotion: false,
  degraded: false,
  visible: true,
  fpsCap: null,
  options: NO_OPTIONS,
  playing: true,
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
      'flow:1',
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
        setFlowSpeed: () => {},
        setOptions: () => {},
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

  it('减弱动效开静态，恢复后流动；播放暂停不开静态', () => {
    const { last, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, reducedMotion: true });
    backdrop.update({ ...base, reducedMotion: false });
    backdrop.update({ ...base, playing: false });
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
    expect(last().calls.slice(7)).toEqual(['album:fb2k://cover/b', 'lyric:false', 'album:']);
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
        setFlowSpeed: () => {},
        setOptions: () => {},
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

describe('createBackdrop：没在播放时放慢', () => {
  const FRAME_MS = 16.7;
  const flows = (calls: string[]) =>
    calls.filter((call) => call.startsWith('flow:')).map((call) => Number(call.slice(5)));
  /** 走到缓动循环结束，返回走了几帧；帧率守门的那一拍一直排着，所以排着的只剩它就是到了 */
  function settle(timing: ReturnType<typeof manualClock>): number {
    let frames = 0;
    while (timing.pending() > 1 && frames < 1000) {
      timing.frame(FRAME_MS);
      frames += 1;
    }
    return frames;
  }

  it('暂停后流速渐渐降到低速，不是一下到位；不开静态、不动帧率', () => {
    const { last, timing, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, playing: false });
    for (let i = 0; i < 7; i++) timing.frame(FRAME_MS);
    const early = flows(last().calls).at(-1)!;
    expect(early).toBeLessThan(1);
    expect(early).toBeGreaterThan(0.8);
    settle(timing);
    const speeds = flows(last().calls);
    expect(speeds[0]).toBe(1);
    expect(speeds.at(-1)).toBeCloseTo(PAUSE_SPEED, 10);
    expect(speeds.every((speed, index) => index === 0 || speed < speeds[index - 1]!)).toBe(true);
    expect(last().calls.filter((call) => call.startsWith('static:'))).toEqual(['static:false']);
    expect(last().calls.filter((call) => call.startsWith('fps:'))).toHaveLength(1);
  });

  it('恢复播放回到用户设的流速，而且比放慢时利落', () => {
    const { last, timing, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, playing: false });
    const slowing = settle(timing);
    backdrop.update(base);
    const resuming = settle(timing);
    expect(flows(last().calls).at(-1)).toBe(1);
    expect(resuming).toBeLessThan(slowing);
  });

  it('放慢途中恢复：从当前速度接着升，不跳回原速', () => {
    const { last, timing, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, playing: false });
    for (let i = 0; i < 20; i++) timing.frame(FRAME_MS);
    const before = flows(last().calls).at(-1)!;
    backdrop.update(base);
    expect(flows(last().calls).at(-1)).toBe(before);
    timing.frame(FRAME_MS);
    timing.frame(FRAME_MS);
    const after = flows(last().calls).at(-1)!;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(1);
  });

  it('进视图时已经没在播放：直接是低速，不排缓动', () => {
    const { last, timing, backdrop } = setup();
    backdrop.update({ ...base, playing: false });
    expect(flows(last().calls)).toEqual([PAUSE_SPEED]);
    expect(timing.pending()).toBe(1);
  });

  it('叠乘在用户设的流速上', () => {
    const { last, backdrop, timing } = setup();
    const options = resolveBackdropOptions('mesh', parseBackdropOptions('{"flowSpeed":200}')!);
    backdrop.update({ ...base, options });
    backdrop.update({ ...base, options, playing: false });
    settle(timing);
    expect(flows(last().calls).at(-1)).toBeCloseTo(2 * PAUSE_SPEED, 10);
  });

  it('静态模式里暂停直接到位，不排缓动；恢复流动后就是低速', () => {
    const { last, timing, backdrop } = setup();
    backdrop.update({ ...base, reducedMotion: true });
    backdrop.update({ ...base, reducedMotion: true, playing: false });
    expect(timing.pending()).toBe(0);
    expect(flows(last().calls).at(-1)).toBe(PAUSE_SPEED);
    backdrop.update({ ...base, playing: false });
    expect(timing.pending()).toBe(1);
    expect(flows(last().calls)).toEqual([1, PAUSE_SPEED]);
  });

  it('钛金属随音乐律动时与暂停系数相乘，音量回调不会把低速冲掉', () => {
    const { drives, last, backdrop } = setup({ lowFreq: true });
    const options = resolveBackdropOptions(
      'titanium',
      parseBackdropOptions('{"titanium":{"audio":true}}')!,
    );
    backdrop.update({ ...base, renderer: 'titanium', options, playing: false });
    drives[0]!.volume(0.4);
    expect(flows(last().calls).at(-1)).toBeCloseTo(
      PAUSE_SPEED * (1 + TITANIUM_PULSE.flow * 0.4),
      10,
    );
  });

  it('释放、换渲染器时撤掉排着的缓动', () => {
    const { made, timing, backdrop } = setup();
    backdrop.update(base);
    backdrop.update({ ...base, playing: false });
    expect(timing.pending()).toBe(2);
    backdrop.update({ ...base, playing: false, renderer: 'flow' });
    expect(made).toHaveLength(2);
    expect(timing.pending()).toBe(1);
    backdrop.dispose();
    expect(timing.pending()).toBe(0);
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

describe('createBackdrop：可调项', () => {
  const stored = (raw: string) => {
    const value = parseBackdropOptions(raw);
    if (!value) throw new Error('应当解析得出');
    return value;
  };
  const optionCalls = (calls: string[]) => calls.filter((call) => call.startsWith('options:'));

  it('调色挂在渲染器的元素上：改了跟着换，回到恒等就撤掉；换渲染器时新元素按新渲染器自己的调色', () => {
    const { last, backdrop } = setup();
    const tinted = stored('{"mesh":{"hue":30,"saturation":120},"flow":{"brightness":90}}');
    backdrop.update({ ...base, renderer: 'mesh', options: resolveBackdropOptions('mesh', tinted) });
    expect(last().canvas.style.filter).toBe('hue-rotate(30deg) saturate(1.2)');
    backdrop.update({
      ...base,
      renderer: 'mesh',
      options: resolveBackdropOptions('mesh', stored('{}')),
    });
    expect(last().canvas.style.filter).toBe('');
    backdrop.update({ ...base, renderer: 'flow', options: resolveBackdropOptions('flow', tinted) });
    expect(last().canvas.dataset['renderer']).toBe('flow');
    expect(last().canvas.style.filter).toBe('brightness(0.9)');
  });

  it('建渲染器后先下发流速与选项，选项排在封面之前', () => {
    const { last, backdrop } = setup();
    backdrop.update({
      ...base,
      renderer: 'titanium',
      options: resolveBackdropOptions(
        'titanium',
        stored('{"flowSpeed":150,"titanium":{"grain":50}}'),
      ),
    });
    const { calls } = last();
    expect(calls).toContain('flow:1.5');
    expect(optionCalls(calls)).toHaveLength(1);
    expect(JSON.parse(optionCalls(calls)[0]!.slice('options:'.length))).toMatchObject({
      grain: 0.5,
      sparkle: 0.75,
      paletteAlgorithm: 'auto',
    });
    expect(calls.findIndex((call) => call.startsWith('options:'))).toBeLessThan(
      calls.indexOf('album:fb2k://cover/a'),
    );
  });

  it('选项没变就不再发；变了一项整组发一次，流速只在变时发', () => {
    const { last, backdrop } = setup();
    const titanium = (raw: string) => ({
      ...base,
      renderer: 'titanium' as const,
      options: resolveBackdropOptions('titanium', stored(raw)),
    });
    backdrop.update(titanium('{}'));
    backdrop.update(titanium('{}'));
    expect(optionCalls(last().calls)).toHaveLength(1);
    expect(last().calls.filter((call) => call.startsWith('flow:'))).toEqual(['flow:1']);
    backdrop.update(titanium('{"titanium":{"metalness":80}}'));
    expect(optionCalls(last().calls)).toHaveLength(2);
    expect(JSON.parse(optionCalls(last().calls)[1]!.slice('options:'.length))).toMatchObject({
      metalness: 0.8,
      grain: 0.7,
    });
    expect(last().calls.filter((call) => call.startsWith('flow:'))).toEqual(['flow:1']);
    backdrop.update(titanium('{"flowSpeed":200,"titanium":{"metalness":80}}'));
    expect(optionCalls(last().calls)).toHaveLength(2);
    expect(last().calls.filter((call) => call.startsWith('flow:'))).toEqual(['flow:1', 'flow:2']);
  });

  it('换渲染器重建后，新的那个按它认得的那一组选项重新下发', () => {
    const { made, backdrop } = setup();
    const raw = '{"titanium":{"grain":50},"isolation":{"lightWave":true}}';
    backdrop.update({
      ...base,
      renderer: 'titanium',
      options: resolveBackdropOptions('titanium', stored(raw)),
    });
    backdrop.update({
      ...base,
      renderer: 'isolation',
      options: resolveBackdropOptions('isolation', stored(raw)),
    });
    expect(made).toHaveLength(2);
    expect(JSON.parse(optionCalls(made[1]!.calls)[0]!.slice('options:'.length))).toEqual({
      lightWave: true,
      dithering: true,
      paletteAlgorithm: 'auto',
    });
  });

  it('网格渐变没有可调项：不调 setOptions，流速照发', () => {
    const { last, backdrop } = setup();
    backdrop.update({
      ...base,
      renderer: 'mesh',
      options: resolveBackdropOptions('mesh', stored('{"flowSpeed":50}')),
    });
    expect(optionCalls(last().calls)).toEqual([]);
    expect(last().calls).toContain('flow:0.5');
  });
});

describe('createBackdrop：随音乐律动', () => {
  const stored = (raw: string) => {
    const value = parseBackdropOptions(raw);
    if (!value) throw new Error('应当解析得出');
    return value;
  };
  const driven = (renderer: BackdropRendererId, raw: string, playing: boolean): BackdropInputs => ({
    ...base,
    renderer,
    playing,
    options: resolveBackdropOptions(renderer, stored(raw)),
  });
  const ON = '{"titanium":{"audio":true},"mesh":{"audio":true},"isolation":{"audio":true}}';

  it('建渲染器时建驱动，固定值交给它；没开时只落在恒定', () => {
    const { drives, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('titanium', '{}', true));
    expect(drives).toHaveLength(1);
    expect(drives[0]).toMatchObject({ restVolume: BACKDROP_LOW_FREQ, modes: ['constant'] });
  });

  it('开着：播放跟随、暂停归零、再播放又跟随；关掉回恒定，同一状态不重复交', () => {
    const { drives, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('titanium', ON, true));
    backdrop.update(driven('titanium', ON, true));
    backdrop.update(driven('titanium', ON, false));
    backdrop.update(driven('titanium', ON, true));
    backdrop.update(driven('titanium', '{}', true));
    expect(drives[0]!.modes).toEqual(['follow', 'pause', 'follow', 'constant']);
  });

  it('网格渐变同样随音乐律动；隔离的低频音量是空实现，不接音频', () => {
    const { drives, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('mesh', ON, true));
    backdrop.update(driven('isolation', ON, true));
    expect(drives.map((drive) => drive.modes)).toEqual([['follow'], ['constant']]);
  });

  it('静态模式停在原地不订音频，恢复流动后接着跟随', () => {
    const { drives, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('titanium', ON, true));
    backdrop.update({ ...driven('titanium', ON, true), reducedMotion: true });
    backdrop.update({ ...driven('titanium', ON, true), degraded: true });
    backdrop.update(driven('titanium', ON, true));
    expect(drives[0]!.modes).toEqual(['follow', 'hold', 'follow']);
  });

  it('守门跳闸转静态时也停在原地', () => {
    const { drives, timing, events, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('titanium', ON, true));
    for (let i = 0; i < 400 && events.length === 0; i++) timing.frame(60);
    expect(drives[0]!.modes).toEqual(['follow', 'hold']);
  });

  it('驱动给的音量写到渲染器上', () => {
    const { drives, last, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('mesh', ON, true));
    drives[0]!.volume(0.4);
    expect(last().calls.at(-1)).toBe('lowfreq:0.4');
  });

  it('钛金属律动时跟着音量提亮、加快流速；关掉律动回到原样', () => {
    const { drives, last, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('titanium', ON, true));
    drives[0]!.volume(0.4);
    expect(last().calls.slice(-2)).toEqual([
      'lowfreq:0.4',
      `flow:${1 + TITANIUM_PULSE.flow * 0.4}`,
    ]);
    expect(last().canvas.style.filter).toBe(`brightness(${1 + TITANIUM_PULSE.brightness * 0.4})`);
    backdrop.update(driven('titanium', '{}', true));
    expect(last().canvas.style.filter).toBe('');
    expect(last().calls.at(-1)).toBe('flow:1');
    // 关着时驱动缓回固定值，不再带增强
    drives[0]!.volume(1);
    expect(last().calls.at(-1)).toBe('lowfreq:1');
    expect(last().canvas.style.filter).toBe('');
  });

  it('律动增强只给钛金属：网格渐变跟着音频时亮度与流速不动，调色照旧', () => {
    const { drives, last, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('mesh', '{"mesh":{"audio":true,"hue":30}}', true));
    drives[0]!.volume(0.8);
    expect(last().calls.filter((call) => call.startsWith('flow:'))).toEqual(['flow:1']);
    expect(last().canvas.style.filter).toBe('hue-rotate(30deg)');
  });

  it('倍数每次取最新一次更新里的：强度调了，驱动下一帧就用新的；钛金属恒为 1', () => {
    const { drives, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('mesh', ON, true));
    expect(drives[0]!.gain()).toBe(1);
    backdrop.update(driven('mesh', '{"mesh":{"audio":true,"audioStrength":150}}', true));
    expect(drives[0]!.gain()).toBe(1.5);
    backdrop.update(driven('titanium', ON, true));
    expect(drives[1]!.gain()).toBe(1);
  });

  it('换渲染器、窗口看不见、整个释放：驱动先于渲染器拆掉', () => {
    const { drives, made, backdrop } = setup({ lowFreq: true });
    backdrop.update(driven('titanium', ON, true));
    backdrop.update(driven('mesh', ON, true));
    expect(drives.map((drive) => drive.disposed)).toEqual([true, false]);
    backdrop.update({ ...driven('mesh', ON, true), visible: false });
    expect(drives[1]!.disposed).toBe(true);
    backdrop.update(driven('mesh', ON, true));
    expect(drives).toHaveLength(3);
    backdrop.dispose();
    expect(drives[2]!.disposed).toBe(true);
    expect(made.map((fake) => fake.calls.at(-1))).toEqual(['dispose', 'dispose', 'dispose']);
  });

  it('不给驱动工厂就不接音频，更新照常', () => {
    const { last, backdrop } = setup();
    expect(() => backdrop.update(driven('titanium', ON, true))).not.toThrow();
    expect(last().calls.filter((call) => call.startsWith('lowfreq:'))).toEqual([
      `lowfreq:${BACKDROP_LOW_FREQ}`,
    ]);
  });
});

describe('createBackdrop：进场淡入与换渲染器的交叉淡变', () => {
  const layers = (host: HTMLElement) => [
    ...host.querySelectorAll<HTMLElement>('[data-backdrop-layer]'),
  ];

  it('新建的渲染器先保持透明，第一张封面设置完成后淡入', async () => {
    const { host, fades, backdrop } = setup({ withFades: true });
    backdrop.update(base);
    expect(layers(host)[0]?.style.opacity).toBe('0');
    expect(fades).toHaveLength(0);
    await flush();
    expect(layers(host)[0]?.style.opacity).toBe('');
    expect(fades.map(({ from, to, ms }) => [from, to, ms])).toEqual([[0, 1, BACKDROP_REVEAL_MS]]);
  });

  it('封面迟迟未设置完成时，超过等待上限也淡入，背景不会一直不显示', () => {
    vi.useFakeTimers();
    try {
      const { host, fades, backdrop } = setup({ withFades: true, hangAlbum: true });
      backdrop.update(base);
      vi.advanceTimersByTime(BACKDROP_REVEAL_WAIT_MS - 1);
      expect(fades).toHaveLength(0);
      expect(layers(host)[0]?.style.opacity).toBe('0');
      vi.advanceTimersByTime(1);
      expect(fades).toHaveLength(1);
      expect(layers(host)[0]?.style.opacity).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('环境不支持播放动画或开启减弱动效：直接到终态，不播放淡入', async () => {
    const plain = setup();
    plain.backdrop.update(base);
    await flush();
    expect(layers(plain.host)[0]?.style.opacity).toBe('');

    const reduced = setup({ withFades: true });
    reduced.backdrop.update({ ...base, reducedMotion: true });
    await flush();
    expect(layers(reduced.host)[0]?.style.opacity).toBe('');
    expect(reduced.fades).toHaveLength(0);
  });

  it('换渲染器：新层在旧层上方淡入，旧画面静止，淡入结束后才释放旧渲染器', async () => {
    const { host, made, fades, backdrop } = setup({ withFades: true });
    backdrop.update(base);
    await flush();
    fades[0]!.finish();
    await flush();

    backdrop.update({ ...base, renderer: 'titanium' });
    expect(layers(host)).toHaveLength(2);
    expect(layers(host)[1]?.style.opacity).toBe('0');
    expect(made[0]!.calls).not.toContain('dispose');
    expect(made[0]!.calls.at(-1)).toBe('static:true');
    await flush();
    expect(fades.at(-1)).toMatchObject({ from: 0, to: 1, ms: BACKDROP_SWAP_MS });
    expect(fades.at(-1)?.layer).toBe(layers(host)[1]);
    expect(layers(host)).toHaveLength(2);

    fades.at(-1)!.finish();
    await flush();
    expect(made[0]!.calls).toContain('dispose');
    expect(layers(host)).toHaveLength(1);
    expect(host.querySelector('canvas')?.dataset['renderer']).toBe('titanium');
  });

  it('连续换渲染器：尚未显示的立即释放，下层的旧画面保留到最后一个渲染器显示', async () => {
    const { host, made, fades, backdrop } = setup({ withFades: true });
    backdrop.update(base);
    await flush();
    fades[0]!.finish();
    await flush();

    backdrop.update({ ...base, renderer: 'titanium' });
    backdrop.update({ ...base, renderer: 'isolation' });
    expect(made).toHaveLength(3);
    expect(made[1]!.calls).toContain('dispose');
    expect(made[0]!.calls).not.toContain('dispose');
    expect(layers(host)).toHaveLength(2);

    await flush();
    fades.at(-1)!.finish();
    await flush();
    expect(made[0]!.calls).toContain('dispose');
    expect(layers(host)).toHaveLength(1);
    expect(host.querySelector('canvas')?.dataset['renderer']).toBe('isolation');
  });

  it('交叉淡变途中再换：在途渐变直接到终态，下一个渲染器继续淡入，至多保留两个渲染器', async () => {
    const { host, made, fades, backdrop } = setup({ withFades: true });
    backdrop.update(base);
    await flush();
    fades[0]!.finish();
    await flush();
    backdrop.update({ ...base, renderer: 'titanium' });
    await flush();

    backdrop.update({ ...base, renderer: 'isolation' });
    expect(fades.at(-1)?.cancelled).toBe(true);
    expect(made[0]!.calls).toContain('dispose');
    expect(made[1]!.calls.at(-1)).toBe('static:true');
    expect(layers(host)).toHaveLength(2);
    await flush();
    fades.at(-1)!.finish();
    await flush();
    expect(made[1]!.calls).toContain('dispose');
    expect(layers(host)).toHaveLength(1);
  });

  it('选「关」：旧画面淡出后释放；窗口不可见时不播放动画，直接释放', async () => {
    const off = setup({ withFades: true });
    off.backdrop.update(base);
    await flush();
    off.fades[0]!.finish();
    await flush();
    off.backdrop.update({ ...base, renderer: null });
    expect(off.fades.at(-1)).toMatchObject({ from: 1, to: 0, ms: BACKDROP_LEAVE_MS });
    expect(off.host.querySelectorAll('canvas')).toHaveLength(1);
    off.fades.at(-1)!.finish();
    await flush();
    expect(off.host.querySelectorAll('canvas')).toHaveLength(0);
    expect(off.made[0]!.calls).toContain('dispose');

    const hidden = setup({ withFades: true });
    hidden.backdrop.update(base);
    await flush();
    hidden.fades[0]!.finish();
    await flush();
    const count = hidden.fades.length;
    hidden.backdrop.update({ ...base, visible: false });
    expect(hidden.host.querySelectorAll('canvas')).toHaveLength(0);
    expect(hidden.fades).toHaveLength(count);
  });

  it('渐变途中销毁：两个渲染器各释放一次，渐变结束后的回调不再操作', async () => {
    const { host, made, fades, backdrop } = setup({ withFades: true });
    backdrop.update(base);
    await flush();
    fades[0]!.finish();
    await flush();
    backdrop.update({ ...base, renderer: 'titanium' });
    await flush();

    backdrop.dispose();
    expect(host.children).toHaveLength(0);
    fades.at(-1)!.finish();
    await flush();
    for (const fake of made)
      expect(fake.calls.filter((call) => call === 'dispose')).toHaveLength(1);
  });
});
