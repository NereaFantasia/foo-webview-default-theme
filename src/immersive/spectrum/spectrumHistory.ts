import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import type { Store } from '../../kit/store.ts';
import { barAxisFor, type BarAxis } from './barAxis.ts';
import type { FrameClock } from '../frame/frameScheduler.ts';
import { createPageVisibility, type PageVisibility } from '../frame/pageVisibility.ts';
import { HZ_MAX, HZ_MIN } from '../paper/paperScale.ts';
import { levelsOfDb, SPECTRUM_BARS } from './spectrumBars.ts';
import { barsOfBins, binsFrameOf, type BinsFrame } from './spectrumBins.ts';
import {
  BARS_FFT_SIZE,
  openSpectrumFeed,
  type BarsPull,
  type SpectrumFeed,
} from './spectrumFeed.ts';
import { createSpectrumHistory, type SpectrumHistory } from '../terrain/terrain.ts';

export type SpectrumStatus = 'idle' | 'live' | 'silent' | 'unavailable';

/**
 * 可视化流的 Nyquist 为 `nyquist` 时频谱柱的横轴，右端不超过 `HZ_MAX`。
 * 合并柱与绘制刻度共用同一条轴，结果按最近一次的 Nyquist 缓存
 */
export const spectrumBarAxis = (() => {
  let cached: { nyquist: number; axis: BarAxis } | null = null;
  return (nyquist: number): BarAxis => {
    if (cached?.nyquist !== nyquist) {
      cached = {
        nyquist,
        axis: barAxisFor(2 * nyquist, BARS_FFT_SIZE, SPECTRUM_BARS, HZ_MIN, HZ_MAX),
      };
    }
    return cached.axis;
  };
})();
/** 拉取帧率上限，与取数循环的上限 `DATA_FPS` 相同 */
export const SPECTRUM_FPS = 60;
export const SPECTRUM_FPS_REDUCED = 15;
/** 超过该时长（毫秒）没有新帧时，状态转为 `silent` */
export const SILENT_MS = 2000;
/**
 * 逐柱指数平滑：帧距为 60 Hz 一帧时保留上一帧的比例，其他帧距按幂折算。取 0 表示不混合：
 * 沉浸视图展示的是起伏，混入上一帧会填平当前的低谷。FFT 窗本身已使相邻帧很相似，停顿感由柱的峰值点提供
 */
export const SMOOTHING_PER_60HZ = 0;
const SMOOTHING_FRAME_MS = 1000 / 60;
/** 上一帧早于该时长（毫秒）时不混合：这是停止发送后重新到来的帧，混合会把上一首的频谱带入新曲目 */
export const SMOOTHING_STALE_MS = 250;
/** 帧距估计的指数平均权重：足以跟上帧率变化，又不会因一次调度抖动而大幅偏离 */
const INTERVAL_EMA = 0.2;

export function smoothingFor(deltaMs: number): number {
  if (!(deltaMs > 0) || deltaMs > SMOOTHING_STALE_MS) return 0;
  return SMOOTHING_PER_60HZ ** (deltaMs / SMOOTHING_FRAME_MS);
}

/** 服务使用的宿主接口，类型逐项取自 SDK 的 `fb` */
export interface SpectrumHost {
  isAvailable: typeof fb.isAvailable;
  audio: Pick<typeof fb.audio, 'isVisualizationAvailable' | 'subscribeSpectrum' | 'getSpectrum'>;
}

/** 是否为宿主暂停时返回的静音帧 */
export function isPausedFrame(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'state' in payload
    ? payload.state === 'paused'
    : false;
}

/** 帧报告的上限频率（Hz）。没有该项，或采样率未知时宿主报告 0，均返回 `null` */
export function maxFrequencyOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || !('maxFrequency' in payload)) return null;
  const value = payload.maxFrequency;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

const statusAtom = atom<SpectrumStatus>('idle');
const maxFrequencyAtom = atom<number | null>(null);

/** 取数状态，服务未启动或闸关闭时为 `idle` */
export const spectrumStatusAtom: Atom<SpectrumStatus> = atom((get) => get(statusAtom));
/** 帧报告的上限频率（Hz）。尚未收到帧、帧中没有该项或闸关闭时为 `null` */
export const spectrumMaxFrequencyAtom: Atom<number | null> = atom((get) => get(maxFrequencyAtom));

const ALWAYS: Atom<boolean> = atom(() => true);

/** 最后启动且尚未释放的服务。沉浸页的退场过渡中，新旧两页可能各有一个服务 */
let owner: object | null = null;

export interface SpectrumHistoryOptions {
  /** 是否需要山脊图的长窗订阅，缺省为需要 */
  terrain?: Atom<boolean>;
  host?: SpectrumHost;
  /** 缺省读取 `document` */
  visibility?: PageVisibility;
  /** 单调时钟（毫秒），帧距与平滑都使用它，缺省为 `performance.now` */
  now?: () => number;
  /** 拉取循环的帧时钟，缺省为 `requestAnimationFrame` */
  frameClock?: FrameClock;
}

export interface SpectrumHistoryService {
  /** 频谱柱的环形缓冲，每行 `SPECTRUM_BARS` 个柱高。闸关闭时释放底层缓冲 */
  readonly history: SpectrumHistory;
  /** 宿主最新一帧的频点，是山脊图整形链的输入。尚未收到帧或山脊图关闭时为 `null` */
  frame(): BinsFrame | null;
  /** 已收到的帧数，每收到一帧加一 */
  version(): number;
  /** 实测帧距（毫秒），开始拉取时以拉取帧率为初值。画面据此在两帧之间插值 */
  interval(): number;
  /** 收到帧或清空缓冲时通知，清空不增加版本号。返回退订函数 */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/**
 * 启动频谱取数与历史缓冲。服务启动即订阅，`dispose` 时退订
 *
 * 订阅与逐拍拉取帧由 `spectrumFeed.ts` 负责，订阅分为两份：
 * - 山脊图的长窗订阅：最新一帧经 `frame()` 原样提供给山脊图的整形链
 * - 频谱柱的短窗订阅：按柱的横轴（`barAxis.ts`）合并为柱，换算成柱高后写入环形缓冲
 *
 * 柱的订阅被拒绝或尚未建立时，柱使用山脊图订阅的帧，按同一种横轴换算。
 *
 * 取数受闸控制：页面隐藏时退订并停止拉取，回到前台后重新订阅。
 * 宿主不可用（`isAvailable()` 为假）或报告没有可视化时，状态为 `unavailable`，闸重开之前不再查询。
 * 减弱动效时不整体关闭（数据可视化是内容而非装饰），只把拉取降到 15 fps，该设置在开闸时读取一次。
 * `terrain` 为假时不订阅长窗，只订阅柱的短窗，`frame()` 始终为 `null`。
 * `terrain` 变化时闸重开一次，退掉旧订阅并按新的份数重新订阅。
 *
 * 每帧按 `smoothingFor` 与上一帧逐带做指数混合后写入环形缓冲，混合比例按实际帧距折算。
 * 缓冲原地改写，使用方通过 `version()` 或 `subscribe` 得知有新帧。
 * 暂停时宿主返回一帧静音（`state: 'paused'`）。柱缓冲不写入这一帧，柱停在暂停前的最后一帧，恢复播放后从那里继续。
 * 这一帧仍经 `frame()` 提供并推进版本号，是否使用由山脊图按播放状态决定。
 * 2 s 没有新帧时状态转为 `silent`。拉取停止（订阅被其他地方退订）时同样转为 `silent`，须等闸重开一次才重新订阅。
 * 宿主拒绝主订阅时状态转为 `unavailable`，与宿主报告没有可视化相同：不会再有帧，不等待 2 s。
 *
 * 帧报告的上限频率（`spectrumMaxFrequencyAtom`）是可视化流采样率的一半，横轴右端取它与 `HZ_MAX` 中较小者。
 * 输出链中有重采样时，该值与曲目的标称采样率不同。帧中没有该值时由使用方自行回退
 */
export function startSpectrumHistory(
  store: Store,
  options: SpectrumHistoryOptions = {},
): SpectrumHistoryService {
  const host = options.host ?? fb;
  const visibility = options.visibility ?? createPageVisibility();
  const terrainAtom = options.terrain ?? ALWAYS;
  const now = options.now ?? (() => performance.now());
  const history = createSpectrumHistory(undefined, SPECTRUM_BARS);
  const bars = new Float32Array(SPECTRUM_BARS);
  const listeners = new Set<() => void>();
  let latest: BinsFrame | null = null;
  let version = 0;
  let interval = 1000 / SPECTRUM_FPS;
  let feed: SpectrumFeed | undefined;
  let silentTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFrameAt = Number.NaN;
  let gate: { open: boolean; terrain: boolean } | null = null;
  let disposed = false;
  // 代次：查询可用性是一次请求与应答，闸关闭后才到的应答须丢弃。订阅结果与拉取的应答由 `feed.close()` 拦截
  let generation = 0;
  const self = {};
  owner = self;

  // 两个 atom 只由最后启动的服务写入。旧服务晚于新服务释放时，不会把新服务的状态改回 idle
  function setStatus(status: SpectrumStatus): void {
    if (owner === self) store.set(statusAtom, status);
  }

  function setMaxFrequency(value: number | null): void {
    if (owner === self) store.set(maxFrequencyAtom, value);
  }

  function clearSilent(): void {
    if (silentTimer) clearTimeout(silentTimer);
    silentTimer = undefined;
  }

  function armSilent(): void {
    clearSilent();
    silentTimer = setTimeout(() => {
      silentTimer = undefined;
      setStatus('silent');
    }, SILENT_MS);
  }

  /**
   * `payload` 是主订阅的应答，山脊图开启时是长窗订阅，关闭时是柱的订阅。
   * `barsSource` 是柱的订阅在同一拍拉取到的帧。柱没有单独订阅或订阅未建立时为 `null`，此时柱使用主订阅的帧。
   * 柱的订阅已建立但这一拍没有拉到帧（`frame` 为 `null`）时不改动缓冲，以免混入另一种窗长的帧。
   * `terrain` 为假时 `frame()` 返回 `null`，因为主订阅的帧不是山脊图需要的长窗
   */
  function onFrame(payload: unknown, barsSource: BarsPull | null, terrain: boolean): void {
    if (disposed || visibility.hidden()) return;
    const mine = generation;
    const frame = binsFrameOf(payload);
    if (!frame) return;
    const at = now();
    const delta = at - lastFrameAt;
    lastFrameAt = at;
    const source = barsSource ? barsSource.frame : frame;
    if (source && !isPausedFrame(payload)) {
      barsOfBins(source, spectrumBarAxis(source.nyquist), bars);
      history.push(levelsOfDb(bars), smoothingFor(delta));
    }
    latest = terrain ? frame : null;
    // 采样率未知时宿主报告 0。此时保留上一次的上限频率，横轴不会在两种来源之间来回切换
    setMaxFrequency(maxFrequencyOf(payload) ?? store.get(maxFrequencyAtom));
    if (mine !== generation) return;
    if (delta > 0 && delta < 1000) interval += (delta - interval) * INTERVAL_EMA;
    version += 1;
    setStatus('live');
    if (mine !== generation) return;
    armSilent();
    for (const listener of [...listeners]) listener();
  }

  function stop(): void {
    generation += 1;
    const previous = feed;
    feed = undefined;
    clearSilent();
    lastFrameAt = Number.NaN;
    latest = null;
    history.release();
    bars.fill(0);
    setMaxFrequency(null);
    setStatus('idle');
    try {
      previous?.close();
    } finally {
      for (const listener of [...listeners]) listener();
    }
  }

  async function start(terrain: boolean): Promise<void> {
    const mine = ++generation;
    if (!host.isAvailable()) {
      setStatus('unavailable');
      return;
    }
    // 查询失败时按没有可视化处理，与宿主明确回答否相同
    const answer = await settle(() => host.audio.isVisualizationAvailable());
    if (mine !== generation || disposed || visibility.hidden()) return;
    if (answer === null || answer.success !== true || !answer.available) {
      setStatus('unavailable');
      return;
    }
    const pullMs = 1000 / (store.get(reducedMotionAtom) ? SPECTRUM_FPS_REDUCED : SPECTRUM_FPS);
    interval = pullMs;
    feed = openSpectrumFeed({
      host: host.audio,
      terrain,
      intervalMs: pullMs,
      clock: options.frameClock,
      onFrame: (main, barsSource) => onFrame(main, barsSource, terrain),
      onRefused: () => {
        clearSilent();
        setStatus('unavailable');
      },
    });
    // 订阅后尚未收到帧时也开始计时：2 s 内收到帧转为 live，否则转为 silent
    armSilent();
  }

  /** 闸的两项条件（页面是否可见、是否需要山脊图）任一变化时，整体重开一次 */
  function sync(): void {
    if (disposed) return;
    const open = !visibility.hidden();
    const terrain = store.get(terrainAtom);
    if (gate?.open === open && gate.terrain === terrain) return;
    gate = { open, terrain };
    stop();
    if (open && !disposed && !visibility.hidden()) void start(terrain);
  }

  const offVisibility = visibility.subscribe(sync);
  const offTerrain = store.sub(terrainAtom, sync);
  sync();

  return {
    history,
    frame: () => latest,
    version: () => version,
    interval: () => interval,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offVisibility();
      offTerrain();
      listeners.clear();
      stop();
      if (owner === self) owner = null;
    },
  };
}
