import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import type { PlaybackState } from '../../playback/playbackContract.ts';
import type { Store } from '../../kit/store.ts';
import { DATA_FPS, createFrameScheduler, type FrameClock } from '../frame/frameScheduler.ts';
import type { SpectrumStatus } from '../spectrum/spectrumHistory.ts';
import {
  EMPTY_READINGS,
  accumulate,
  readingsOf,
  retainFor,
  rotate45,
  sumsOf,
  type StereoPoint,
  type StereoReadings,
  type StereoSums,
} from './stereoField.ts';

/**
 * 立体声声场的取数：闸开着时跟着帧调度每拍问一次 `audio.getWaveform`（按取数上限 `DATA_FPS` 封顶），要可视化流
 * 截至「现在」的最近 30 ms 的左右两路（有符号），减弱动效下降到 15 fps；前一次还没回就跳过这一拍。起播、seek、
 * 手动换曲后的头 30 ms 里，宿主把窗口前段补零。声场图把每窗的样本按播到的时刻晚一个取数间隔逐帧放出来
 * （`stereoTrail.ts` 的 `REVEAL_LAG_MS`）：问得越密，这个晚量越小；两窗隔得不超过窗长就不缺样本。
 *
 * 闸：宿主只在有频谱订阅时才有这段流，所以要频谱在出帧（`spectrumStatus` 为 `live`）且正在播放才开。
 * 闸合上就停问、点与读数清空，闸合之后才到的应答丢掉。暂停时只停问，点与读数定在那一刻，恢复播放后接着问，
 * 读数的积分把暂停的时长跳过去、不当成这段时间里没有声音。暂停超过频谱的 `SILENT_MS` 时频谱已转 `silent`，
 * 恢复播放后要等它回到 `live` 才接着问，这之前点与读数照旧定着；等的这段也算进暂停的时长。
 * 减弱动效下暂停照旧清空。减弱动效不单独监听，播放状态或频谱状态一变、闸重算时现读。
 *
 * 问的时刻按截止时刻推进，不按「上次问的时刻 + 间隔」：帧距在 165 Hz 屏上是 12 / 18 ms 交替，后者每次都把
 * 落到帧上的零头累积进去，订 30 fps 实得约 23。
 *
 * 宿主认不认左右两路只探一次：应答带 `left` / `right` 就是认；答成功却没有这两路（只给混合声道 `waveform`），
 * 或者参数被拒（`INVALID_PARAMS`），是不认 `channels` 的旧宿主，判 `unsupported` 并停问，
 * 同一个服务里闸再打开也不再问。答失败而没有错误码（这一刻流里还没有数据）不下结论，下一拍照问。
 *
 * 声场图只画最近一窗的点；三个读数按 `READOUT_TAU_MS` 把各窗的能量和做指数加权后再算。
 */
export type StereoFieldStatus = 'unknown' | 'supported' | 'unsupported';

export const STEREO_POLL_FPS = 60;
export const STEREO_POLL_FPS_REDUCED = 15;
/**
 * 每次要的窗长（秒）：比取数间隔（实测到手间隔 p95 约 20 ms、最长约 21 ms）长一截，两窗之间不缺样本；
 * 再长只是两窗重叠的部分多，重叠的样本白占桥上的传输。
 */
export const STEREO_WINDOW_SECONDS = 0.03;
/**
 * 每路最多要的点数（宿主等距抽取、不求均值）：30 ms 在 48 kHz 下是 1440 个样本，所以 48 kHz 及以下整窗每个样本都要。
 * 抽点会把 5 kHz 以上混叠成满框的长尖刺，两窗交接时抽到的样本又不同，交接处跟着抖；更高的采样率照 48 kHz 的密度抽。
 */
export const STEREO_POINTS = 1440;
/** rAF 时间戳本身有抖动：按间隔限频时留 1 ms 余量，免得反而隔一拍才问。 */
const POLL_JITTER_MS = 1;

/** 用到的宿主面，类型取自 SDK 的 `fb`。 */
export interface StereoFieldHost {
  audio: Pick<typeof fb.audio, 'getWaveform'>;
}

const statusAtom = atom<StereoFieldStatus>('unknown');

/** 宿主认不认左右两路；服务每起一次从 `unknown` 重新探。 */
export const stereoFieldStatusAtom: Atom<StereoFieldStatus> = atom((get) => get(statusAtom));

/** 闸只看播放状态，不随每 100 ms 一次的进度更新重算。 */
const playbackStateAtom: Atom<PlaybackState['state']> = atom((get) => get(playbackAtom).state);

export interface StereoSamplesOptions {
  /** 频谱取数的状态；沉浸页传 `spectrumHistory.ts` 的 `spectrumStatusAtom`。 */
  spectrumStatus: Atom<SpectrumStatus>;
  host?: StereoFieldHost;
  /** 轮询循环的帧时钟；缺省 `requestAnimationFrame`。 */
  frameClock?: FrameClock;
  /** 单调时钟（毫秒），与帧时钟同一时基，暂停的时长按它量；缺省 `performance.now`。 */
  now?: () => number;
}

export interface StereoSamplesService {
  /** 最近一窗转 45° 后的点；没有数据时为空。只整份替换，不原地改。 */
  points(): readonly StereoPoint[];
  readings(): StereoReadings;
  /** 点与读数每换一次叫一次 `listener`；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

type WaveformAnswer = Awaited<ReturnType<typeof fb.audio.getWaveform>>;
type Gate = 'open' | 'held' | 'closed';

export function startStereoSamples(
  store: Store,
  options: StereoSamplesOptions,
): StereoSamplesService {
  const host = options.host ?? fb;
  const now = options.now ?? (() => performance.now());
  const listeners = new Set<() => void>();
  let points: readonly StereoPoint[] = [];
  let readings: StereoReadings = EMPTY_READINGS;
  // 代次：闸合上之后才到的应答要丢掉。
  let generation = 0;
  let inFlight = false;
  let nextPollAt = Number.NEGATIVE_INFINITY;
  let intervalMs = 1000 / STEREO_POLL_FPS;
  let sums: StereoSums | null = null;
  let lastWindowAt = 0;
  let heldAt: number | null = null;
  let gate: Gate | undefined;
  let disposed = false;
  const scheduler = createFrameScheduler(tick, options.frameClock, { fixed: DATA_FPS });
  store.set(statusAtom, 'unknown');

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function stop(): void {
    generation += 1;
    scheduler.cancel();
    inFlight = false;
    nextPollAt = Number.NEGATIVE_INFINITY;
  }

  function close(): void {
    stop();
    heldAt = null;
    sums = null;
    const changed = points.length > 0 || readings !== EMPTY_READINGS;
    points = [];
    readings = EMPTY_READINGS;
    if (changed) notify();
  }

  function unsupported(): void {
    store.set(statusAtom, 'unsupported');
    close();
    sync();
  }

  function onAnswer(answer: WaveformAnswer, at: number): void {
    if (answer.success !== true) {
      if (answer.code === 'INVALID_PARAMS') unsupported();
      return;
    }
    const { left, right } = answer;
    if (!left || !right) {
      unsupported();
      return;
    }
    if (left.length === 0 || right.length === 0) return;
    store.set(statusAtom, 'supported');
    sums = accumulate(sums, sumsOf(left, right), retainFor(at - lastWindowAt));
    lastWindowAt = at;
    points = rotate45(left, right);
    readings = readingsOf(sums);
    notify();
  }

  function tick(at: number): void {
    scheduler.schedule();
    if (inFlight || at < nextPollAt - POLL_JITTER_MS) return;
    inFlight = true;
    // 停问过一阵（截止时刻早已过去）就从现在重新数，不补问欠下的拍子。
    nextPollAt = at - nextPollAt > intervalMs ? at + intervalMs : nextPollAt + intervalMs;
    const mine = generation;
    void settle(() =>
      host.audio.getWaveform({
        duration: STEREO_WINDOW_SECONDS,
        signed: true,
        channels: 'stereo',
        points: STEREO_POINTS,
      }),
    ).then((answer) => {
      if (mine !== generation) return;
      inFlight = false;
      if (answer) onAnswer(answer, at);
    });
  }

  function gateOf(): Gate {
    const state = store.get(playbackStateAtom);
    const spectrum = store.get(options.spectrumStatus);
    if (spectrum === 'live' && state === 'playing' && store.get(statusAtom) !== 'unsupported') {
      return 'open';
    }
    if (store.get(reducedMotionAtom)) return 'closed';
    // 暂停得久，频谱已转 silent：恢复播放后先定着，等它回到 live。
    const resuming = gate === 'held' && state === 'playing' && spectrum === 'silent';
    return state === 'paused' || resuming ? 'held' : 'closed';
  }

  function sync(): void {
    if (disposed) return;
    const next = gateOf();
    if (next === gate) return;
    const previous = gate;
    gate = next;
    if (next === 'held') {
      stop();
      heldAt = now();
      return;
    }
    if (next === 'open' && previous === 'held' && heldAt !== null) {
      lastWindowAt += now() - heldAt;
      heldAt = null;
    } else close();
    if (next === 'closed') return;
    intervalMs = 1000 / (store.get(reducedMotionAtom) ? STEREO_POLL_FPS_REDUCED : STEREO_POLL_FPS);
    scheduler.schedule();
  }

  const offState = store.sub(playbackStateAtom, sync);
  const offSpectrum = store.sub(options.spectrumStatus, sync);
  sync();

  return {
    points: () => points,
    readings: () => readings,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offState();
      offSpectrum();
      listeners.clear();
      close();
    },
  };
}
