import { atom, type Atom } from 'jotai/vanilla';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import { DR_BLOCK_SECONDS, createDrMeter } from './drMeter.ts';
import { createBlockMeter, integratedLoudness } from './loudnessMeter.ts';
import { PcmUnavailableError, type PcmTrack } from '../analysis/trackAnalysis.ts';

/**
 * 量表的两个整轨读数：DR（TT DR Meter）与 Integrated（BS.1770）。宿主连上、有曲目时，换曲后按段向宿主要
 * 原采样率、全部声道的 PCM，每段按 3 s 切片喂给两个累加器，片与片之间让出主线程，读完立刻释放共享缓冲。
 * 段长是 3 s 的整数倍（段界落在 DR 的块界上）、不超过 30 s，且一段的样本不超过 16 MiB。
 *
 * 换曲或释放时中止在途的解码、丢掉算到一半的结果；按曲目记最近一份，来回切同一首不重算。
 * 来源报整个页面取不了 PCM（`PcmUnavailableError`）后本实例不再试；只是这一首取不了（网络流、解不了）给 `null`。
 */
export type DynamicsStatus = 'unavailable' | 'idle' | 'loading' | 'ready' | 'failed';

/** 一段 PCM：每路一个平面（可能是共享缓冲上的视图），读完要 `release()`。 */
export interface PcmPlanes {
  sampleRate: number;
  frames: number;
  planes: Float32Array[];
  release(): void;
}

/** 取一首歌 `range`（秒）这一段原采样率、全部声道的 PCM；这首取不了给 `null`。 */
export type PlanesSource = (
  track: PcmTrack,
  range: { start: number; end: number },
  signal: AbortSignal,
) => Promise<PcmPlanes | null>;

/** 曲目的采样率与声道数只用来定段长；缺省按 48 kHz 立体声估。 */
export interface DynamicsTrack extends PcmTrack {
  sampleRate?: number;
  channels?: number;
}

export interface TrackDynamics {
  dynamicRange: number | null;
  integrated: number | null;
}

export interface DynamicsModel {
  readonly status: DynamicsStatus;
  /** 当前曲目的两个读数；还没算出、这首取不了时为 `null`。 */
  readonly result: TrackDynamics | null;
}

export interface TrackDynamicsService {
  dispose(): void;
}

export const MAX_SEGMENT_SECONDS = 30;
export const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;

/**
 * 段长（秒）：3 s 的整数倍，不超过 30 s，样本（float32）不超过 16 MiB。采样率、声道数不大于 0（宿主报未知）
 * 时按 1 算，段长落在上限 30 s。
 */
export function segmentSeconds(sampleRate = 48000, channels = 2): number {
  const perSecond = Math.max(1, sampleRate) * Math.max(1, channels) * 4;
  const blocks = Math.floor(MAX_SEGMENT_BYTES / perSecond / DR_BLOCK_SECONDS);
  return Math.min(MAX_SEGMENT_SECONDS, Math.max(1, blocks) * DR_BLOCK_SECONDS);
}

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 按段读完一首、喂两个累加器；中途 `isCurrent` 为假就停，给 `null`。 */
export async function measureTrack(
  track: DynamicsTrack,
  source: PlanesSource,
  signal: AbortSignal,
  isCurrent: () => boolean,
  pause: () => Promise<void> = yieldToMain,
): Promise<TrackDynamics | null> {
  const duration = track.duration ?? 0;
  if (duration <= 0) return null;
  const step = segmentSeconds(track.sampleRate, track.channels);
  let meters: {
    rate: number;
    channels: number;
    dr: ReturnType<typeof createDrMeter>;
    blocks: number[];
    loudness: ReturnType<typeof createBlockMeter>;
  } | null = null;
  for (let start = 0; start < duration; start += step) {
    if (signal.aborted || !isCurrent()) return null;
    let piece = await source(track, { start, end: Math.min(duration, start + step) }, signal);
    if (signal.aborted || !isCurrent() || !piece) {
      piece?.release();
      return null;
    }
    const release = () => {
      const previous = piece;
      piece = null;
      previous?.release();
    };
    // 让出主线程期间也可能进入休眠，不能等下一片调度才归还共享缓冲。
    const abort = () => {
      meters = null;
      release();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const channels = piece.planes.length;
      if (!meters) {
        const blocks: number[] = [];
        meters = {
          rate: piece.sampleRate,
          channels,
          dr: createDrMeter(piece.sampleRate, channels),
          blocks,
          loudness: createBlockMeter(piece.sampleRate, channels, (energy) => blocks.push(energy)),
        };
      }
      // 段与段之间格式变了（不该发生）就不给值，免得两种采样率的块混在一起。
      if (meters.rate !== piece.sampleRate || meters.channels !== channels) return null;
      const slice = Math.max(1, Math.round(piece.sampleRate * DR_BLOCK_SECONDS));
      for (let at = 0; at < piece.frames; at += slice) {
        const to = Math.min(piece.frames, at + slice);
        meters.dr.push(piece.planes, at, to);
        meters.loudness.push(piece.planes, at, to);
        await pause();
        if (signal.aborted || !isCurrent()) return null;
      }
    } finally {
      signal.removeEventListener('abort', abort);
      release();
    }
  }
  if (!meters) return null;
  return { dynamicRange: meters.dr.finish(), integrated: integratedLoudness(meters.blocks) };
}

const stateAtom = atom<DynamicsModel>({ status: 'unavailable', result: null });

export const trackDynamicsAtom: Atom<DynamicsModel> = atom((get) => get(stateAtom));

/** 跟着 `currentTrackAtom` 算读数；编辑标签不重算。`pause` 是片与片之间的让出，缺省等一个 `setTimeout(0)`。 */
export function startTrackDynamics(
  store: Store,
  options: { source: PlanesSource | null; pause?: () => Promise<void>; active?: Atom<boolean> },
): TrackDynamicsService {
  const { source, pause } = options;
  store.set(stateAtom, { status: source ? 'idle' : 'unavailable', result: null });
  let token = 0;
  let inflight: AbortController | null = null;
  let unavailable = source === null;
  let disposed = false;
  let last: { key: string; value: TrackDynamics | null } | null = null;
  // 上一次看到的输入；还没看过时为 null。
  let input: { key: string; want: boolean } | null = null;

  function stop(): void {
    token += 1;
    inflight?.abort();
    inflight = null;
  }

  async function load(target: DynamicsTrack, key: string, id: number, from: PlanesSource) {
    const controller = new AbortController();
    inflight = controller;
    let value: TrackDynamics | null;
    try {
      value = await measureTrack(target, from, controller.signal, () => id === token, pause);
    } catch (error) {
      if (id !== token) return;
      inflight = null;
      if (error instanceof PcmUnavailableError) {
        unavailable = true;
        store.set(stateAtom, { status: 'unavailable', result: null });
        return;
      }
      value = null;
    }
    if (id !== token) return;
    inflight = null;
    last = { key, value };
    store.set(stateAtom, { status: value ? 'ready' : 'failed', result: value });
  }

  function follow(): void {
    if (disposed) return;
    const track = store.get(currentTrackAtom);
    const key = track?.path ? trackKeyOf(track) : '';
    const want = store.get(playbackConnectedAtom) && (!options.active || store.get(options.active));
    if (input && input.key === key && input.want === want) return;
    input = { key, want };
    if (!source || unavailable) return;
    stop();
    if (last?.key === key) {
      store.set(stateAtom, { status: last.value ? 'ready' : 'failed', result: last.value });
      return;
    }
    if (!want || !key || !track) {
      store.set(stateAtom, { status: 'idle', result: null });
      return;
    }
    store.set(stateAtom, { status: 'loading', result: null });
    void load(track, key, token, source);
  }

  // 先订阅再初读。
  const offs = [store.sub(currentTrackAtom, follow), store.sub(playbackConnectedAtom, follow)];
  if (options.active) offs.push(store.sub(options.active, follow));
  follow();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      for (const off of offs.splice(0)) off();
      last = null;
      store.set(stateAtom, { status: unavailable ? 'unavailable' : 'idle', result: null });
    },
  };
}
