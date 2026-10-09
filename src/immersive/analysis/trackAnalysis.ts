import { atom, type Atom } from 'jotai/vanilla';
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

/**
 * 整轨分析：按段取一遍 PCM、分一遍频，同时得出整轨波形的分频结果与逐拍拍点（`tempoSegments.ts`，变速曲逐段）。
 * 宿主连上、且调用方要的时候（选的画法吃分频，或 BPM 格在画面上）才取；换曲、不再要或释放时中止在途的取数、
 * 丢掉算到一半的结果。
 * 没有来源、或来源报整个页面都取不了 PCM（`PcmUnavailableError`）时状态为 `unavailable`，画法菜单据此不提供
 * 分频的几种；后者在本实例里不再尝试。
 * 结果与失败都按曲目记最近一份：在画法之间来回切、关了再开，同一首不重取。
 */
export type WaveformBandsStatus = 'unavailable' | 'idle' | 'loading' | 'ready' | 'failed';

export interface PcmTrack {
  /** fb2k 存的路径（`file://`、`file-relative://` 或网址），用来分辨本地媒体与网络流。 */
  path: string;
  /** 交给宿主的曲目路径：分轨自带 `|subsong:N`。 */
  handle: string;
  /** 秒；按它分段、分窗，没有或不大于 0 时这首判取不了。 */
  duration?: number;
}

/** 整个页面都取不了 PCM（没有宿主、运行时不支持共享缓冲）；只是这一首取不了的，来源给 `null`。 */
export class PcmUnavailableError extends Error {
  constructor(message = 'PCM is not available in this page') {
    super(message);
    this.name = 'PcmUnavailableError';
  }
}

/** 取一首歌 `range`（秒）这一段的 PCM；`signal` 中止时放弃。这首取不了（网络流、解不了）给 `null`。 */
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
  /** 当前曲目的分频结果；还没有时为 `null`。 */
  readonly bands: WaveformBands | null;
  /** 当前曲目的逐拍结果；还没有、或跟不出节拍时为 `null`。显著度够不够用由调用方判。 */
  readonly beats: BeatTrack | null;
}

export interface TrackAnalysisOptions {
  /** 调用方要不要结果：选的画法吃分频，或 BPM 格在画面上。 */
  wanted: Atom<boolean>;
  /** `null` 时状态恒为 `unavailable`。 */
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

const stateAtom = atom<TrackAnalysisModel>({ status: 'unavailable', bands: null, beats: null });
// 退出后重新进入也须等上一段离线渲染结束；完成即撤掉引用，不缓存音频。
const renderingByStore = new WeakMap<Store, Promise<BandSignals>>();

export const trackAnalysisAtom: Atom<TrackAnalysisModel> = atom((get) => get(stateAtom));

const modelOf = (status: WaveformBandsStatus, result: Result | null): TrackAnalysisModel => ({
  status,
  bands: result?.bands ?? null,
  beats: result?.beats ?? null,
});

/** 跟着 `currentTrackAtom` 与 `wanted` 取数；编辑标签不重取。 */
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
  // 上一次看到的输入；还没看过时为 null。
  let input: { key: string; want: boolean } | null = null;

  function stop(): void {
    token += 1;
    inflight?.abort();
    inflight = null;
  }

  async function load(target: PcmTrack, key: string, id: number, from: PcmSource): Promise<void> {
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
        unavailable = true;
        inflight = null;
        store.set(stateAtom, modelOf('unavailable', null));
        return;
      }
      result = null;
    }
    if (id !== token) return;
    inflight = null;
    // 逐段找拍分几次跑完、中间让出主线程；换曲后停下，结果丢掉。
    const beatTrack =
      result && energies
        ? await findBeats(onsetStrength(energies), framesPerSecond(energies.sampleRate), {
            isCurrent: () => id === token,
          })
        : null;
    if (id !== token) return;
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
      // 离线渲染不能中断；当前段结束前不再解码，恢复只重算最新仍需要的曲目。
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

  // 先订阅再初读。
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
