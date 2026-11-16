import { atom, type Atom } from 'jotai/vanilla';
import { log } from '../../diagnostics/eventLog.ts';
import { rejectionCode } from '../../diagnostics/hostFailures.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import type { BeatTrack } from '../tempo/beatTracker.ts';
import { WAVEFORM_RESOLUTION } from '../waveform/fullWaveform.ts';
import {
  accumulateEnergies,
  createEnergies,
  framesPerSecond,
  onsetStrength,
} from '../tempo/onsetEnvelope.ts';
import { analyseSegments, type PcmPiece, type SegmentOptions } from '../waveform/segmentedBands.ts';
import { analyseTempo } from '../tempo/tempoSegments.ts';
import {
  ANALYSIS_SAMPLE_RATE,
  renderBands,
  type BandSignals,
  type WaveformBands,
} from '../waveform/waveformBands.ts';

export type WaveformBandsStatus = 'unavailable' | 'idle' | 'loading' | 'ready' | 'failed';

export interface PcmTrack {
  /** foobar2000 记录的路径（`file://`、`file-relative://` 或网址），用于区分本地媒体与网络流 */
  path: string;
  /** 传给宿主的曲目标识，分轨带 `|subsong:N` 后缀 */
  handle: string;
  /** 时长（秒），用于分段与分窗。缺失或不大于 0 时，该曲目视为无法分析 */
  duration?: number;
}

/** 整个页面都无法取得 PCM，如没有宿主或运行时不支持共享缓冲。仅单首无法取得时，来源返回 `null` */
export class PcmUnavailableError extends Error {
  constructor(message = 'PCM is not available in this page') {
    super(message);
    this.name = 'PcmUnavailableError';
  }
}

/** 读取曲目在 `range`（秒）内的 PCM，`signal` 中止时放弃。单首无法取得时（网络流、无法解码）返回 `null` */
export type PcmSource = (
  track: PcmTrack,
  range: { start: number; end: number },
  signal: AbortSignal,
) => Promise<PcmPiece | null>;

export type TrackAnalysisDeps = Pick<SegmentOptions, 'render' | 'segmentSeconds'> & {
  beats?: typeof analyseTempo;
};

export interface TrackAnalysisModel {
  readonly status: WaveformBandsStatus;
  /** 当前曲目的分频结果，尚未得到时为 `null` */
  readonly bands: WaveformBands | null;
  /** 当前曲目的逐拍结果。尚未得到或无法跟踪节拍时为 `null`，节拍显著度是否足够由调用方判断 */
  readonly beats: BeatTrack | null;
}

export interface TrackAnalysisOptions {
  /** 调用方是否需要结果：所选画法使用分频，或画面上有 BPM 格时为真 */
  wanted: Atom<boolean>;
  /** 为 `null` 时状态始终为 `unavailable` */
  source: PcmSource | null;
  deps?: TrackAnalysisDeps;
}

export interface TrackAnalysisService {
  dispose(): void;
}

interface Result {
  key: string;
  bands: WaveformBands | null;
  beats: BeatTrack | null;
}

/**
 * 整轨分析与量表读数（`trackDynamics.ts`）的耗时达到该值（毫秒）时写入运行日志。
 * 计算期间格子显示 `—`，界面上无法区分仍在计算还是已经失败
 */
export const SLOW_ANALYSIS_MS = 30_000;

const stateAtom = atom<TrackAnalysisModel>({ status: 'unavailable', bands: null, beats: null });
// 按 store 记录进行中的离线渲染。离线渲染无法中断，退出视图后重新进入也须等它结束。渲染完成即删除记录，不缓存音频
const renderingByStore = new WeakMap<Store, Promise<BandSignals>>();

export const trackAnalysisAtom: Atom<TrackAnalysisModel> = atom((get) => get(stateAtom));

const modelOf = (status: WaveformBandsStatus, result: Result | null): TrackAnalysisModel => ({
  status,
  bands: result?.bands ?? null,
  beats: result?.beats ?? null,
});

/**
 * 启动整轨分析：按段读取一遍 PCM 并分频，同时得出整轨波形的分频结果与逐拍拍点（变速曲逐段计算，见 `tempoSegments.ts`）
 *
 * 宿主已连接且 `wanted` 为真时，为当前曲目计算结果，编辑标签不触发重算。
 * 换曲、断开连接、`wanted` 变化或释放时，中止进行中的取数并丢弃未完成的结果。
 * 服务只保留最近算完的一首（包括失败的结果），当前曲目与它相同时直接沿用，不重新取数。
 *
 * 没有来源，或来源报告整个页面都无法取得 PCM（`PcmUnavailableError`）时，状态为 `unavailable`，整轨波形据此不打开画法菜单。
 * 出现 `PcmUnavailableError` 后，本实例不再请求 PCM。
 * 取数失败、页面无法取得 PCM 与分析过慢都写入运行日志，字段不含曲目路径与标题
 */
export function startTrackAnalysis(
  store: Store,
  options: TrackAnalysisOptions,
): TrackAnalysisService {
  const { source, wanted } = options;
  const {
    beats: findBeats = analyseTempo,
    render = renderBands,
    ...segmentDeps
  } = options.deps ?? {};
  store.set(stateAtom, modelOf(source ? 'idle' : 'unavailable', null));
  let token = 0;
  let inflight: AbortController | null = null;
  let unavailable = source === null;
  let disposed = false;
  let last: Result | null = null;
  // 上一次处理的输入，尚未处理时为 null
  let input: { key: string; want: boolean } | null = null;

  function stop(): void {
    token += 1;
    inflight?.abort();
    inflight = null;
  }

  async function load(
    target: PcmTrack & { sampleRate?: number },
    key: string,
    id: number,
    from: PcmSource,
  ): Promise<void> {
    const startedAt = performance.now();
    const rate = target.sampleRate ?? 0;
    const controller = new AbortController();
    inflight = controller;
    const duration = target.duration ?? 0;
    const energies = createEnergies(duration, ANALYSIS_SAMPLE_RATE);
    let result: WaveformBands | null;
    try {
      result = await analyseSegments(
        (range) => from(target, range, controller.signal),
        duration,
        WAVEFORM_RESOLUTION,
        {
          ...segmentDeps,
          isCurrent: () => id === token,
          render: async (audio) => {
            const rendering = render(audio);
            renderingByStore.set(store, rendering);
            try {
              return await rendering;
            } finally {
              renderingByStore.delete(store);
            }
          },
          onSegment: (signals, piece, start, end) => {
            if (!energies) return;
            accumulateEnergies(signals, piece.audio.sampleRate, piece.start, start, end, energies);
          },
        },
      );
    } catch (error) {
      if (id !== token) return;
      if (error instanceof PcmUnavailableError) {
        log.warn('host', 'analysis.unavailable', { rate, reason: error.message });
        unavailable = true;
        inflight = null;
        store.set(stateAtom, modelOf('unavailable', null));
        return;
      }
      log.warn('host', 'analysis.failed', { code: rejectionCode(error), rate });
      result = null;
    }
    if (id !== token) return;
    inflight = null;
    // 找拍分多次执行，其间让出主线程。换曲后停止并丢弃结果
    const beatTrack =
      result && energies
        ? await findBeats(onsetStrength(energies), framesPerSecond(energies.sampleRate), {
            isCurrent: () => id === token,
          })
        : null;
    if (id !== token) return;
    const ms = Math.round(performance.now() - startedAt);
    if (ms >= SLOW_ANALYSIS_MS) log.warn('host', 'analysis.slow', { ms, rate });
    last = { key, bands: result, beats: beatTrack };
    store.set(stateAtom, modelOf(result ? 'ready' : 'failed', last));
  }

  function follow(): void {
    if (disposed) return;
    const track = store.get(currentTrackAtom);
    const key = track?.path ? trackKeyOf(track) : '';
    const want = store.get(playbackConnectedAtom) && store.get(wanted);
    if (input && input.key === key && input.want === want) return;
    input = { key, want };
    if (!source || unavailable) return;
    stop();
    if (last?.key === key) {
      store.set(stateAtom, modelOf(last.bands ? 'ready' : 'failed', last));
      return;
    }
    if (!want || !key || !track) {
      store.set(stateAtom, modelOf('idle', null));
      return;
    }
    store.set(stateAtom, modelOf('loading', null));
    const rendering = renderingByStore.get(store);
    if (rendering) {
      // 离线渲染无法中断。当前段渲染结束前不开始新的解码，结束后只为届时仍需要的曲目重新计算
      const id = token;
      const resume = () => {
        if (disposed || id !== token) return;
        input = null;
        follow();
      };
      void rendering.then(resume, resume);
      return;
    }
    void load(track, key, token, source);
  }

  // 先订阅，再读取初值
  const offs = [
    store.sub(currentTrackAtom, follow),
    store.sub(playbackConnectedAtom, follow),
    store.sub(wanted, follow),
  ];
  follow();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      for (const off of offs.splice(0)) off();
      last = null;
      store.set(stateAtom, modelOf(unavailable ? 'unavailable' : 'idle', null));
    },
  };
}
