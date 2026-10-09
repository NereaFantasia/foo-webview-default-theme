import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import type { Store } from '../../kit/store.ts';
import { barAxisFor, type BarAxis } from './barAxis.ts';
import type { FrameClock } from '../frame/frameScheduler.ts';
import { createPageVisibility, type PageVisibility } from '../frame/pageVisibility.ts';
import { HZ_MIN } from '../paper/paperScale.ts';
import { levelsOfDb, SPECTRUM_BARS } from './spectrumBars.ts';
import { barsOfBins, binsFrameOf, type BinsFrame } from './spectrumBins.ts';
import {
  BARS_FFT_SIZE,
  openSpectrumFeed,
  type BarsPull,
  type SpectrumFeed,
} from './spectrumFeed.ts';
import { createSpectrumHistory, type SpectrumHistory } from '../terrain/terrain.ts';

/**
 * 频谱取数与历史缓冲：服务起来就订，`dispose` 即退订。订阅与逐拍拉帧在 `spectrumFeed.ts`：山脊图那份长窗的
 * 最新一帧经 `frame()` 原样放给它的整形链；频谱柱那份短窗按柱的横轴（`barAxis.ts`）并成柱、换成柱高写进环形缓冲。
 * 柱那份被拒或还没成立时，柱吃山脊图那份帧，按同一把尺换算。
 *
 * 闸：页面隐藏就退订停拉，回到前台重订。宿主不在（`isAvailable()` 为假）或答没有可视化时报 `unavailable`，
 * 之后不再问，直到闸重开。减弱动效下不整关（数据可视化是内容不是装饰），只把拉取降到 15 fps，开闸时读一次。
 * 山脊图关着（`terrain` 为假）时不订长窗那份，只订柱那份，`frame()` 一直是 `null`；开关变了按闸重开一次，
 * 退掉旧订阅、按新的份数重订。
 *
 * 每帧按 `smoothingFor` 与上一帧做逐带指数混合再写进环形缓冲，比例按实际帧距折算。缓冲原地改写，
 * 消费者看 `version()` 或经 `subscribe` 得知有新帧。暂停时宿主回一帧静音（`state: 'paused'`）：柱缓冲不收它，
 * 柱停在暂停前的最后一帧，恢复播放后第一帧接着它；这一帧照样放给 `frame()` 并推进版本号，山脊图那边自己
 * 按播放状态决定收不收。2 s 没有新帧转 `silent`；拉取停了（订阅被别处退订）也这样转 `silent`，要等闸重开一次
 * 才重订。宿主拒绝主订阅转 `unavailable`，与宿主说没有可视化同一态：不会有帧来，不等 2 s。
 *
 * 横轴上沿（`spectrumMaxFrequencyAtom`）取帧自报的上沿，即可视化流采样率的一半：输出链里有重采样时它和
 * 曲目标称采样率不一样。帧里没有这一项时消费方自己回退。
 */
export type SpectrumStatus = 'idle' | 'live' | 'silent' | 'unavailable';

/** 可视化流 Nyquist 为 `nyquist` 时频谱柱的横轴；并柱与画刻度共用这一条，按上一次的 Nyquist 记住。 */
export const spectrumBarAxis = (() => {
  let cached: { nyquist: number; axis: BarAxis } | null = null;
  return (nyquist: number): BarAxis => {
    if (cached?.nyquist !== nyquist) {
      cached = { nyquist, axis: barAxisFor(2 * nyquist, BARS_FFT_SIZE, SPECTRUM_BARS, HZ_MIN) };
    }
    return cached.axis;
  };
})();
/** 拉取帧率上限，与取数循环的上限 `DATA_FPS` 相同。 */
export const SPECTRUM_FPS = 60;
export const SPECTRUM_FPS_REDUCED = 15;
/** 这么久（毫秒）没有新帧就算安静了。 */
export const SILENT_MS = 2000;
/**
 * 逐柱指数平滑：60 Hz 一帧留这么多上一帧，别的帧距按幂折算。取 0 即不混：沉浸视图看的是起伏，
 * 混进上一帧会把这一刻的谷填平；FFT 窗本身已让相邻帧很像，停顿感交给柱的峰值点。
 */
export const SMOOTHING_PER_60HZ = 0;
const SMOOTHING_FRAME_MS = 1000 / 60;
/** 上一帧比这更早就不混了：那是停发后再来的帧，混进去只会把旧曲拖进新曲。 */
export const SMOOTHING_STALE_MS = 250;
/** 帧距估计的指数平均权重：够跟上帧率变化，又不被一次调度抖动带跑。 */
const INTERVAL_EMA = 0.2;

export function smoothingFor(deltaMs: number): number {
  if (!(deltaMs > 0) || deltaMs > SMOOTHING_STALE_MS) return 0;
  return SMOOTHING_PER_60HZ ** (deltaMs / SMOOTHING_FRAME_MS);
}

/** 用到的宿主面，类型逐项取自 SDK 的 `fb`。 */
export interface SpectrumHost {
  isAvailable: typeof fb.isAvailable;
  audio: Pick<typeof fb.audio, 'isVisualizationAvailable' | 'subscribeSpectrum' | 'getSpectrum'>;
}

/** 宿主暂停时回的那一帧静音。 */
export function isPausedFrame(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'state' in payload
    ? payload.state === 'paused'
    : false;
}

/** 帧自报的上沿（Hz）；没有这一项，或采样率未知时宿主报的 0，都给 `null`。 */
export function maxFrequencyOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || !('maxFrequency' in payload)) return null;
  const value = payload.maxFrequency;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

const statusAtom = atom<SpectrumStatus>('idle');
const maxFrequencyAtom = atom<number | null>(null);

/** 取数状态；服务没起来或闸关着时是 `idle`。 */
export const spectrumStatusAtom: Atom<SpectrumStatus> = atom((get) => get(statusAtom));
/** 帧自报的上沿（Hz）；还没来帧、帧里不带或闸关着时为 `null`。 */
export const spectrumMaxFrequencyAtom: Atom<number | null> = atom((get) => get(maxFrequencyAtom));

const ALWAYS: Atom<boolean> = atom(() => true);

/** 最后启动、还没释放的那个服务；沉浸页退场过渡里新旧两页可能各有一个。 */
let owner: object | null = null;

export interface SpectrumHistoryOptions {
  /** 要不要山脊图那份长窗订阅；缺省要。 */
  terrain?: Atom<boolean>;
  host?: SpectrumHost;
  /** 缺省读 `document`。 */
  visibility?: PageVisibility;
  /** 单调时钟（毫秒），帧距与平滑都读它；缺省 `performance.now`。 */
  now?: () => number;
  /** 拉取循环的帧时钟；缺省 `requestAnimationFrame`。 */
  frameClock?: FrameClock;
}

export interface SpectrumHistoryService {
  /** 频谱柱的环形缓冲，每行 `SPECTRUM_BARS` 个柱高；闸关上即撤销底层缓冲引用。 */
  readonly history: SpectrumHistory;
  /** 最新一帧宿主频点，山脊图整形链的输入；没收过帧或山脊图关着时是 `null`。 */
  frame(): BinsFrame | null;
  /** 收到的帧数，每收一帧加一。 */
  version(): number;
  /** 实测帧距（毫秒），开拉时按拉取帧率起步；画面据它在两帧之间插值。 */
  interval(): number;
  /** 收帧或清空缓冲时通知；清空不增加版本号。返回退订函数。 */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

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
  // 代次：可用性是一问一答，闸合上之后才到的应答要丢掉。订阅结局与拉取的应答由 `feed.close()` 挡掉。
  let generation = 0;
  const self = {};
  owner = self;

  // 两个 atom 只归最后启动的那个服务写：旧服务晚于新服务释放时，不把新服务的状态盖回 idle。
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
   * `payload` 是主订阅的应答（山脊图开着时是长窗那份，关着时是柱那份）；`barsSource` 是同一拍柱那份拉到的帧，
   * 柱那份没另订或没成立时为 `null`，柱吃主订阅的帧。柱那份成立了却没拉到这一拍（`frame` 为 `null`）就不动缓冲，
   * 免得混进另一个窗长的帧。`terrain` 为假时不放 `frame`：那不是山脊图要的长窗。
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
    // 采样率未知时宿主报 0：留着上一次的上沿，不让横轴在两种来源之间来回跳。
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
    // 问不到就当没有：与宿主明确答否同一条路。
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
    // 订上了还没来帧也先算安静着数：2 s 内来帧就转 live，否则报 silent。
    armSilent();
  }

  /** 闸的两项（页面可见、要不要山脊图）任一变了就整个重开一次。 */
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
