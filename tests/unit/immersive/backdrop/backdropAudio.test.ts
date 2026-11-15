import type {
  AudioSpectrumPayload,
  AudioSubscribeSpectrumParams,
  SpectrumSubscribeOutcome,
  SpectrumSubscription,
} from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_BANDS,
  AUDIO_EVENT,
  AUDIO_FFT_SIZE,
  AUDIO_FPS,
  AUDIO_MAX_HZ,
  AUDIO_MIN_HZ,
  WINDOW_MS,
  MIN_SPAN,
  cleanBands,
  createLevelFollower,
  createLowFreqDrive,
  type LowFreqHost,
  type LowFreqMode,
} from '../../../../src/immersive/backdrop/backdropAudio.ts';
import type { FrameClock } from '../../../../src/immersive/frame/frameScheduler.ts';

const REST = 1;
const FRAME_MS = 16;

/** 手动走的帧时钟，同一个时刻也交给驱动当「此刻」 */
function manualClock() {
  let time = 0;
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
    now: () => time,
    pending: () => pending.size,
    /** 走 ms 毫秒，每 FRAME_MS 一拍 */
    run(ms: number) {
      for (let spent = 0; spent < ms; spent += FRAME_MS) {
        time += FRAME_MS;
        const due = [...pending];
        pending.clear();
        for (const [, callback] of due) callback(time);
      }
    },
    skip(ms: number) {
      time += ms;
    },
  };
}

interface FakeOptions {
  /** 登记的结局，缺省立即成功；`'later'` 悬着，由 `settle` 放出来 */
  outcome?: SpectrumSubscribeOutcome | 'later';
  throws?: boolean;
}

interface FakeSubscription {
  params: AudioSubscribeSpectrumParams | undefined;
  closes: number;
  push(frame: Partial<AudioSpectrumPayload>): void;
  settle(outcome: SpectrumSubscribeOutcome): void;
}

const GRANTED: SpectrumSubscribeOutcome = {
  ok: true,
  subscriptionId: 'spectrum-1',
  fftSize: AUDIO_FFT_SIZE,
  bands: AUDIO_BANDS,
  fps: AUDIO_FPS,
  scale: 'weighted',
  output: 'bands',
  channels: 'mix',
  backgroundThrottle: true,
  minFrequency: AUDIO_MIN_HZ,
  maxFrequency: AUDIO_MAX_HZ,
  streamReady: true,
};

const FRAME: AudioSpectrumPayload = {
  output: 'bands',
  spectrum: [],
  bands: AUDIO_BANDS,
  fftSize: AUDIO_FFT_SIZE,
  scale: 'weighted',
  sampleRate: 44100,
  minFrequency: AUDIO_MIN_HZ,
  maxFrequency: AUDIO_MAX_HZ,
  state: 'playing',
  streamTime: 0,
  hostTime: 0,
};

/** 宿主面的 `subscribeSpectrum` 有按输出种类区分的重载，替身的回调参数写成 unknown 才都接得住 */
function isFrameHandler(value: unknown): value is (frame: AudioSpectrumPayload) => void {
  return typeof value === 'function';
}

function fakeHost(options: FakeOptions = {}) {
  const subscriptions: FakeSubscription[] = [];
  const subscribeSpectrum = (
    callback: unknown,
    params?: AudioSubscribeSpectrumParams,
  ): SpectrumSubscription => {
    if (options.throws) throw new Error('bridge');
    let settle: (outcome: SpectrumSubscribeOutcome) => void = () => {};
    const ready = new Promise<SpectrumSubscribeOutcome>((resolve) => (settle = resolve));
    const record: FakeSubscription = {
      params,
      closes: 0,
      push: (frame) => {
        if (isFrameHandler(callback)) callback({ ...FRAME, ...frame });
      },
      settle,
    };
    subscriptions.push(record);
    if (options.outcome !== 'later') settle(options.outcome ?? GRANTED);
    return Object.assign(() => void (record.closes += 1), { ready });
  };
  const host: LowFreqHost = { subscribeSpectrum };
  return { host, subscriptions };
}

function setup(options: FakeOptions = {}, gain?: () => number) {
  const timing = manualClock();
  const fake = fakeHost(options);
  const volumes: number[] = [];
  const drive = createLowFreqDrive({
    host: fake.host,
    clock: timing.clock,
    restVolume: REST,
    onVolume: (volume) => void volumes.push(volume),
    now: timing.now,
    gain,
  });
  const set = (mode: LowFreqMode) => drive.set(mode);
  return { drive, set, timing, volumes, ...fake, last: () => volumes.at(-1) };
}

/** 让 `ready` 的 then 回调跑完 */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('cleanBands', () => {
  it('留下有限数，其余的条不计', () => {
    expect(cleanBands([0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
    expect(cleanBands([0.2, Number.NaN, 'x', Infinity, 0.6])).toEqual([0.2, 0.6]);
  });

  it('不是数组按静音：一条都没有', () => {
    expect(cleanBands(undefined)).toEqual([]);
    expect(cleanBands({ length: 2 })).toEqual([]);
  });
});

describe('createLevelFollower', () => {
  const FRAME = 33;
  /** 把一串每帧的各条依次喂进去，返回最后一帧的结果 */
  function feed(follower: ReturnType<typeof createLevelFollower>, series: number[][], from = 0) {
    let level = 0;
    series.forEach((bands, index) => (level = follower.push(bands, from + index * FRAME)));
    return level;
  }

  it('第一帧没有参照，得 0；一条都没有按静音得 0', () => {
    const follower = createLevelFollower();
    expect(follower.push([0.5, 0.5], 0)).toBe(0);
    expect(follower.push([], FRAME)).toBe(0);
  });

  it('近乎恒定的信号不放大：起伏小于最小跨度时按最小跨度折算', () => {
    const follower = createLevelFollower();
    const steady = Array.from({ length: 60 }, () => [0.5]);
    feed(follower, steady);
    expect(follower.push([0.5 + MIN_SPAN / 2], 60 * FRAME)).toBeCloseTo(0.5, 1);
  });

  it('比平时高得多的帧得 1，比平时低的帧得 0', () => {
    const follower = createLevelFollower();
    feed(
      follower,
      Array.from({ length: 60 }, (_, i) => [i % 2 === 0 ? 0.6 : 0.7]),
    );
    expect(follower.push([0.95], 60 * FRAME)).toBe(1);
    expect(follower.push([0.1], 61 * FRAME)).toBe(0);
  });

  it('一次罕见的低谷不会把参照拖偏：之后正常起伏仍分得出高低', () => {
    const follower = createLevelFollower();
    const wobble = (i: number) => [i % 2 === 0 ? 0.62 : 0.7];
    feed(
      follower,
      Array.from({ length: 80 }, (_, i) => wobble(i)),
    );
    follower.push([0.05], 80 * FRAME);
    const low = follower.push([0.62], 81 * FRAME);
    const high = follower.push([0.7], 82 * FRAME);
    expect(low).toBeLessThan(0.1);
    expect(high).toBeGreaterThan(low + 0.4);
  });

  it('多条各自归一再平均：每条自己的高低都算数', () => {
    const follower = createLevelFollower();
    // 第一条在 0.2…0.4 间摆、第二条在 0.7…0.9 间摆：各自摆到顶才满格
    const series = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? [0.2, 0.7] : [0.4, 0.9]));
    feed(follower, series);
    const both = follower.push([0.4, 0.9], 60 * FRAME);
    const one = follower.push([0.4, 0.7], 61 * FRAME);
    expect(both).toBe(1);
    expect(one).toBeCloseTo(0.5, 1);
  });

  it('停了很久再来：旧的样本出了时间窗，从头攒', () => {
    const follower = createLevelFollower();
    feed(
      follower,
      Array.from({ length: 60 }, (_, i) => [i % 2 === 0 ? 0.1 : 0.9]),
    );
    const later = 60 * FRAME + WINDOW_MS * 2;
    const levels = [0, 1, 2].map((i) => follower.push([0.5], later + i * FRAME));
    expect(levels.every((level) => level < 0.05)).toBe(true);
  });

  it('结果总在 0 到 1 之间', () => {
    const follower = createLevelFollower();
    for (const [index, value] of [0, 1, 0.3, 0, 0.9, 0.2, 1].entries()) {
      const level = follower.push([value, 1 - value], index * FRAME);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe('createLowFreqDrive：订阅', () => {
  it('建起来不订阅、不排帧；跟随时订一份低频段的频段输出，重复要求不重订', () => {
    const { set, subscriptions, timing } = setup();
    expect(subscriptions).toHaveLength(0);
    expect(timing.pending()).toBe(0);
    set('follow');
    set('follow');
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.params).toEqual({
      output: 'bands',
      bands: AUDIO_BANDS,
      fftSize: AUDIO_FFT_SIZE,
      fps: AUDIO_FPS,
      minFrequency: AUDIO_MIN_HZ,
      maxFrequency: AUDIO_MAX_HZ,
      event: AUDIO_EVENT,
    });
  });

  it('不走默认事件名：不顶图纸场景那几份订阅的监听', () => {
    expect(AUDIO_EVENT).not.toBe('audio:spectrum');
  });

  it('暂停、恒定、静态都退订，只退一次', () => {
    for (const mode of ['pause', 'constant', 'hold'] as const) {
      const { set, subscriptions } = setup();
      set('follow');
      set(mode);
      set(mode);
      expect(subscriptions[0]!.closes).toBe(1);
    }
  });

  it('退订后再跟随是新的一份订阅', () => {
    const { set, subscriptions } = setup();
    set('follow');
    set('pause');
    set('follow');
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.map((subscription) => subscription.closes)).toEqual([1, 0]);
  });
});

describe('createLowFreqDrive：音量', () => {
  it('跟着低频走：先落低点，鼓点来了往上冲，帧回到低点又往下回', () => {
    const { set, subscriptions, timing, volumes } = setup();
    set('follow');
    const push = (value: number) => subscriptions[0]!.push({ spectrum: [value, value] });
    push(0.4);
    timing.run(600);
    expect(volumes.at(-1)!).toBeLessThan(0.15);
    timing.skip(33);
    push(0.9);
    timing.run(400);
    expect(volumes.at(-1)!).toBeGreaterThan(0.9);
    timing.skip(33);
    push(0.4);
    timing.run(1500);
    expect(volumes.at(-1)!).toBeLessThan(0.1);
  });

  it('倍数乘在跟随的目标上，每帧取最新的；暂停与恒定不受它影响', () => {
    let gain = 2;
    const { set, subscriptions, timing, last } = setup({}, () => gain);
    set('follow');
    const push = (value: number) => subscriptions[0]!.push({ spectrum: [value, value] });
    push(0.4);
    timing.skip(33);
    push(0.9);
    timing.run(400);
    expect(last()!).toBeCloseTo(2, 1);
    gain = 0.5;
    timing.skip(33);
    push(0.9);
    timing.run(1500);
    expect(last()!).toBeCloseTo(0.5, 1);
    set('pause');
    timing.run(3000);
    expect(last()).toBe(0);
    set('constant');
    timing.run(3000);
    expect(last()).toBe(REST);
  });

  it('上升比回落快：同样的 80 ms，往上走的一段比往下走的一段挪得多', () => {
    const falling = setup();
    falling.set('follow');
    falling.subscriptions[0]!.push({ spectrum: [0.5] });
    falling.timing.run(80);
    const dropped = REST - falling.last()!;

    const rising = setup();
    rising.set('pause');
    rising.timing.run(3000);
    rising.set('follow');
    rising.subscriptions[0]!.push({ spectrum: [0.2] });
    rising.timing.skip(33);
    rising.subscriptions[0]!.push({ spectrum: [0.9] });
    rising.timing.run(80);
    expect(rising.last()!).toBeGreaterThan(dropped * 2);
  });

  it('宿主给的静音帧（暂停、停止）按 0 算', () => {
    const { set, subscriptions, timing, volumes } = setup();
    set('follow');
    subscriptions[0]!.push({ spectrum: [0.2] });
    timing.run(600);
    timing.skip(33);
    subscriptions[0]!.push({ spectrum: [0.9] });
    timing.run(400);
    expect(volumes.at(-1)!).toBeGreaterThan(0.9);
    timing.skip(33);
    subscriptions[0]!.push({ spectrum: [0.9], state: 'paused' });
    timing.run(2000);
    expect(volumes.at(-1)!).toBeLessThan(0.05);
  });

  it('暂停：退订后缓动回 0，写准 0 就结束逐拍的追赶', () => {
    const { set, timing, volumes } = setup();
    set('follow');
    timing.run(100);
    set('pause');
    timing.run(3000);
    expect(volumes.at(-1)).toBe(0);
    expect(volumes.every((volume) => volume >= 0 && volume <= REST)).toBe(true);
    expect(timing.pending()).toBe(0);
  });

  it('恒定：从 0 缓动回固定值，写准固定值就结束', () => {
    const { set, timing, volumes } = setup();
    set('pause');
    timing.run(3000);
    expect(volumes.at(-1)).toBe(0);
    set('constant');
    timing.run(3000);
    expect(volumes.at(-1)).toBe(REST);
    expect(timing.pending()).toBe(0);
  });

  it('缓动单调、中间没有跳变', () => {
    const { set, timing, volumes } = setup();
    set('pause');
    timing.run(1200);
    for (let i = 1; i < volumes.length; i++) {
      expect(volumes[i]!).toBeLessThanOrEqual(volumes[i - 1]!);
      expect(volumes[i - 1]! - volumes[i]!).toBeLessThan(0.2);
    }
  });

  it('静态：停在原地，之后不再写，也不排帧', () => {
    const { set, timing, volumes } = setup();
    set('pause');
    timing.run(100);
    set('hold');
    const frozen = volumes.length;
    timing.run(1000);
    expect(volumes).toHaveLength(frozen);
    expect(timing.pending()).toBe(0);
  });

  it('不在跟随时晚到的帧不起作用', () => {
    const { set, subscriptions, timing, volumes } = setup();
    set('follow');
    set('pause');
    subscriptions[0]!.push({ spectrum: [0.2] });
    timing.skip(33);
    subscriptions[0]!.push({ spectrum: [0.9] });
    timing.run(3000);
    expect(volumes.at(-1)).toBe(0);
  });

  it('跟着音频时一直逐拍追，音量没变化的拍不写', () => {
    const { set, timing, volumes } = setup();
    set('follow');
    timing.run(500);
    expect(timing.pending()).toBe(1);
    const before = volumes.length;
    timing.run(500);
    expect(volumes).toHaveLength(before);
  });
});

describe('createLowFreqDrive：被拒与异常', () => {
  it('宿主拒绝：退回固定值，不再重订，暂停也不再归零', async () => {
    const { set, subscriptions, timing, volumes } = setup({
      outcome: { ok: false, code: 'INVALID_PARAMS' },
    });
    set('pause');
    timing.run(3000);
    expect(volumes.at(-1)).toBe(0);
    set('follow');
    await settled();
    timing.run(3000);
    expect(volumes.at(-1)).toBe(REST);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.closes).toBe(1);
    set('pause');
    set('follow');
    timing.run(3000);
    expect(subscriptions).toHaveLength(1);
    expect(volumes.at(-1)).toBe(REST);
    expect(timing.pending()).toBe(0);
  });

  it('旧宿主把它登记成了频点订阅：也按被拒处理', async () => {
    const { set, timing, volumes } = setup({ outcome: { ...GRANTED, output: 'bins' } });
    set('follow');
    await settled();
    timing.run(3000);
    // 音量本来就在固定值上，没有要写的
    expect(volumes).toEqual([]);
    expect(timing.pending()).toBe(0);
  });

  it('订阅调用本身抛错：当场退回固定值', () => {
    const { set, timing, volumes } = setup({ throws: true });
    set('pause');
    timing.run(3000);
    set('follow');
    timing.run(3000);
    expect(volumes.at(-1)).toBe(REST);
    expect(timing.pending()).toBe(0);
  });

  it('退订之后才到的拒绝结局不算：之后还能再订', async () => {
    const { set, subscriptions } = setup({ outcome: 'later' });
    set('follow');
    set('pause');
    subscriptions[0]!.settle({ ok: false, code: 'INVALID_PARAMS' });
    await settled();
    set('follow');
    expect(subscriptions).toHaveLength(2);
  });

  it('成功的结局不动模式', async () => {
    const { set, subscriptions, timing } = setup({ outcome: 'later' });
    set('follow');
    subscriptions[0]!.settle(GRANTED);
    await settled();
    expect(subscriptions[0]!.closes).toBe(0);
    expect(timing.pending()).toBe(1);
  });
});

describe('createLowFreqDrive：释放', () => {
  it('释放：退订、撤掉排着的那一拍，之后不再写，再要求也无效', () => {
    const { drive, set, subscriptions, timing, volumes } = setup();
    set('follow');
    timing.run(100);
    drive.dispose();
    const frozen = volumes.length;
    expect(subscriptions[0]!.closes).toBe(1);
    expect(timing.pending()).toBe(0);
    set('pause');
    set('follow');
    timing.run(1000);
    expect(volumes).toHaveLength(frozen);
    expect(subscriptions).toHaveLength(1);
    expect(() => drive.dispose()).not.toThrow();
  });

  it('缓动到一半释放也不再写', () => {
    const { drive, set, timing, volumes } = setup();
    set('pause');
    timing.run(100);
    drive.dispose();
    const frozen = volumes.length;
    timing.run(1000);
    expect(volumes).toHaveLength(frozen);
  });
});
