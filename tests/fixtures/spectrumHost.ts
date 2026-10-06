import type {
  AudioGetSpectrumResponse,
  AudioGetSpectrumSuccess,
  AudioSubscribeSpectrumParams,
  SpectrumSubscribeOutcome,
  SpectrumSubscription,
} from 'foo-webview-sdk';
import { createStore, type Atom } from 'jotai/vanilla';
import {
  BARS_FFT_SIZE,
  SPECTRUM_FFT_SIZE,
  SPECTRUM_KEEPALIVE_FPS,
} from '../../src/immersive/spectrum/spectrumFeed.ts';
import {
  spectrumMaxFrequencyAtom,
  spectrumStatusAtom,
  startSpectrumHistory,
  type SpectrumHost,
} from '../../src/immersive/spectrum/spectrumHistory.ts';
import { watchReducedMotion } from '../../src/motion/reducedMotion.ts';
import { fakeFrames, FRAME_MS } from './fakeFrames.ts';
import { fakeMedia } from './fakeMedia.ts';
import { spectrumAnswer, spectrumFailure } from './audioAnswers.ts';

/**
 * 频谱取数（`startSpectrumHistory`）单测用的宿主替身与起服务的助手：替身类型是 `SpectrumHost`，成员签名逐项取自
 * SDK 的 `fb`。宿主的 `getSpectrum` 答替身此刻的「当前帧」，用例用 `play` 换帧，再用帧时钟 `frames.step()`
 * 走一拍触发拉取；页面可见性与山脊图开关走注入，减弱动效经 `matchMedia` 替身给，不装 DOM。
 */
export type Answer = AudioGetSpectrumResponse;
export interface Subscription {
  options: AudioSubscribeSpectrumParams | undefined;
  closed: boolean;
  /** 退订函数被调了几次：SDK 每调一次就给宿主发一次退订。 */
  closes: number;
  settle: (outcome: SpectrumSubscribeOutcome) => void;
}

/**
 * 替身帧用小窗：64 点、6.4 kHz，频点间隔 100 Hz，频点 1…31。20 Hz 起的最低几带都是空带，
 * 取离它最近的频点 1，所以柱缓冲第 0 带的柱高就是频点值换成的柱高。
 */
export const FAKE_FFT_SIZE = 64;
export const FAKE_SAMPLE_RATE = 6400;

/** 一帧频点应答：每个频点都是 `db`。 */
export function binsAnswer(
  db: number,
  extra: Partial<AudioGetSpectrumSuccess> = {},
): AudioGetSpectrumSuccess {
  return spectrumAnswer({
    channels: 'mix',
    channelCount: 2,
    firstBin: 1,
    fftSize: FAKE_FFT_SIZE,
    sampleRate: FAKE_SAMPLE_RATE,
    maxFrequency: FAKE_SAMPLE_RATE / 2,
    spectrum: Array.from({ length: FAKE_FFT_SIZE / 2 - 1 }, () => db),
    ...extra,
  });
}

export function okOutcome(
  index: number,
  output: 'bins' | 'bands' = 'bins',
): SpectrumSubscribeOutcome {
  return {
    ok: true,
    subscriptionId: `spectrum-${index}`,
    fftSize: SPECTRUM_FFT_SIZE,
    bands: 48,
    fps: SPECTRUM_KEEPALIVE_FPS,
    scale: output === 'bins' ? 'db' : 'weighted',
    output,
    channels: 'mix',
    backgroundThrottle: true,
    minFrequency: 20,
    maxFrequency: null,
    streamReady: true,
  };
}

export interface FakeSpectrumOptions {
  available?: boolean;
  visualization?: boolean;
  /** 可用性询问 reject（框架级失败）。 */
  askFails?: boolean;
  refuse?: boolean;
  refuseBars?: boolean;
  deferReady?: boolean;
  legacyOutput?: boolean;
}

/**
 * `refuse` 让宿主拒绝所有订阅，`refuseBars` 只拒频谱柱那份；`deferReady` 让结局悬着，由用例调订阅上的
 * `settle` 放出来。缺省立即给一个成功结局，订阅号按序 `spectrum-1`、`spectrum-2`……（每次开闸先订山脊图那份）；
 * 结局照宿主报 `output: 'bins'`，`legacyOutput` 照不认 `output` 的旧宿主报 `'bands'`。
 * `getSpectrum` 对两份订阅答同一帧，`playBars` 之后柱那份另答自己的帧，`failBars` 让柱那份这一拍答失败。
 * `holdPulls` 之后的拉取悬着，`releasePulls` 按放行那一刻的当前帧作答。
 */
export function fakeHost(options: FakeSpectrumOptions = {}) {
  let asked = 0;
  let release: (() => void) | undefined;
  let answer: Answer = spectrumFailure('No spectrum data available');
  let barsAnswer: Answer | undefined;
  let barsFails = false;
  let streamTime = 0;
  let pullsHeld = false;
  const heldPulls: (() => void)[] = [];
  const subscriptions: Subscription[] = [];
  const barsIds = new Set<string>();
  const pulls: unknown[] = [];
  const subscribeSpectrum = (
    _callback: unknown,
    params?: AudioSubscribeSpectrumParams,
  ): SpectrumSubscription => {
    let settle: (outcome: SpectrumSubscribeOutcome) => void = () => {};
    const ready = new Promise<SpectrumSubscribeOutcome>((resolve) => (settle = resolve));
    const subscription: Subscription = { options: params, closed: false, closes: 0, settle };
    subscriptions.push(subscription);
    const forBars = params?.fftSize === BARS_FFT_SIZE;
    if (forBars) barsIds.add(`spectrum-${subscriptions.length}`);
    if (options.refuse || (forBars && options.refuseBars)) {
      settle({ ok: false, code: 'INVALID_PARAMS', error: 'refused by the fake host' });
    } else if (!options.deferReady) {
      settle(okOutcome(subscriptions.length, options.legacyOutput ? 'bands' : 'bins'));
    }
    const close = () => {
      subscription.closed = true;
      subscription.closes += 1;
    };
    return Object.assign(close, { ready });
  };
  const host: SpectrumHost = {
    isAvailable: () => options.available ?? true,
    audio: {
      isVisualizationAvailable: async () => {
        asked += 1;
        if (release) await new Promise<void>((resolve) => (release = resolve));
        if (options.askFails) throw new Error('bridge failed');
        return { success: true, available: options.visualization ?? true };
      },
      subscribeSpectrum,
      getSpectrum: async (params) => {
        pulls.push(params);
        if (pullsHeld) await new Promise<void>((resolve) => heldPulls.push(resolve));
        const id = params?.subscriptionId;
        const forBars = id !== undefined && barsIds.has(id);
        if (forBars && barsFails) return spectrumFailure('No spectrum data available');
        return barsAnswer && forBars ? barsAnswer : answer;
      },
    },
  };
  return {
    host,
    subscriptions,
    pulls,
    asked: () => asked,
    open: () => subscriptions.filter((entry) => !entry.closed),
    /** 宿主出一帧新的播放帧（`streamTime` 前进），每个频点都是 `db`。 */
    play(db: number, extra: Partial<AudioGetSpectrumSuccess> = {}) {
      streamTime += FRAME_MS / 1000;
      answer = binsAnswer(db, { streamTime, ...extra });
    },
    answerWith(next: Answer) {
      answer = next;
    },
    /** 柱那份订阅此后答这一帧。 */
    playBars(db: number) {
      barsAnswer = binsAnswer(db, { streamTime });
    },
    /** 柱那份此后答失败（`true`）或照常（`false`）。 */
    failBars(fail: boolean) {
      barsFails = fail;
    },
    /** 某个订阅号一共被拉了几次。 */
    pullsOf: (id: string) =>
      pulls.filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'subscriptionId' in entry &&
          entry.subscriptionId === id,
      ).length,
    /** 让下一次可用性询问悬着，直到 `answer()` 才放行。 */
    hold: () => {
      release = () => {};
    },
    answer: () => {
      release?.();
      release = undefined;
    },
    holdPulls: () => {
      pullsHeld = true;
    },
    releasePulls: () => {
      pullsHeld = false;
      for (const resolve of heldPulls.splice(0)) resolve();
    },
  };
}

export type FakeSpectrumHost = ReturnType<typeof fakeHost>;

/** 起一个频谱服务：`reduced` 让系统要求减弱动效，`hidden` 让页面起步时隐藏，`terrain` 是山脊图开关。 */
export function startSpectrum(
  fake: FakeSpectrumHost = fakeHost(),
  options: { reduced?: boolean; hidden?: boolean; terrain?: Atom<boolean> } = {},
) {
  const store = createStore();
  const media = fakeMedia({ '(prefers-reduced-motion: reduce)': options.reduced ?? false });
  watchReducedMotion(store, media.matchMedia);
  let hidden = options.hidden ?? false;
  const listeners = new Set<() => void>();
  const frames = fakeFrames();
  const spectrum = startSpectrumHistory(store, {
    host: fake.host,
    visibility: {
      hidden: () => hidden,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    now: frames.now,
    frameClock: frames.clock,
    terrain: options.terrain,
  });
  const setHidden = (value: boolean) => {
    hidden = value;
    for (const listener of [...listeners]) listener();
  };
  return {
    store,
    spectrum,
    frames,
    listeners,
    setHidden,
    status: () => store.get(spectrumStatusAtom),
    maxFrequency: () => store.get(spectrumMaxFrequencyAtom),
  };
}
