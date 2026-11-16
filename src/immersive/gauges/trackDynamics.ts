import { atom, type Atom } from 'jotai/vanilla';
import { log } from '../../diagnostics/eventLog.ts';
import { rejectionCode } from '../../diagnostics/hostFailures.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import { DR_BLOCK_SECONDS, createDrMeter } from './drMeter.ts';
import { createBlockMeter, integratedLoudness } from './loudnessMeter.ts';
import { PcmUnavailableError, SLOW_ANALYSIS_MS, type PcmTrack } from '../analysis/trackAnalysis.ts';

export type DynamicsStatus = 'unavailable' | 'idle' | 'loading' | 'ready' | 'failed';

/** 一段 PCM，每个声道一个平面，平面可能是共享缓冲上的视图。读完后须调用 `release()` */
export interface PcmPlanes {
  sampleRate: number;
  frames: number;
  planes: Float32Array[];
  release(): void;
}

/** 读取曲目在 `range`（秒）内原采样率、全部声道的 PCM。单首无法取得时返回 `null` */
export type PlanesSource = (
  track: PcmTrack,
  range: { start: number; end: number },
  signal: AbortSignal,
) => Promise<PcmPlanes | null>;

/** 采样率与声道数只用于确定段长，缺失时按 48 kHz 立体声估算 */
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
  /** 当前曲目的两个读数，尚未算出或无法取得 PCM 时为 `null` */
  readonly result: TrackDynamics | null;
}

export interface TrackDynamicsService {
  dispose(): void;
}

export const MAX_SEGMENT_SECONDS = 30;
export const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;

/**
 * 段长（秒）：3 s 的整数倍，使段界落在 DR 的块界上。段长不超过 30 s，一段的 float32 样本不超过 16 MiB。
 * 采样率或声道数不大于 0（宿主报告未知）时按 1 计算，段长取上限 30 s
 */
export function segmentSeconds(sampleRate = 48000, channels = 2): number {
  const perSecond = Math.max(1, sampleRate) * Math.max(1, channels) * 4;
  const blocks = Math.floor(MAX_SEGMENT_BYTES / perSecond / DR_BLOCK_SECONDS);
  return Math.min(MAX_SEGMENT_SECONDS, Math.max(1, blocks) * DR_BLOCK_SECONDS);
}

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 按段读完一首并送入两个累加器。中途 `signal` 中止或 `isCurrent` 为假时停止，返回 `null` */
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
    // 中止时立即归还共享缓冲：让出主线程期间页面可能进入休眠，下一片不一定会很快执行
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
      // 段与段之间的格式不同时（正常情况下不会发生）返回 null，以免两种采样率的块混在一起
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

/**
 * 启动量表的两个整轨读数：DR（TT DR Meter）与 Integrated（BS.1770）
 *
 * 宿主已连接且 `active` 为真（未传时视为真）时，为当前曲目计算读数，编辑标签不触发重算。
 * 计算时按段向宿主请求原采样率、全部声道的 PCM，段长见 `segmentSeconds`。
 * 每段按 3 s 切片送入两个累加器，片与片之间调用 `pause` 让出主线程，缺省为 `setTimeout(0)`。
 * 一段处理完即释放共享缓冲。
 *
 * 换曲、断开连接、`active` 变化或释放时，中止进行中的解码并丢弃未完成的结果。
 * 服务只保留最近算完的一首，当前曲目与它相同时直接沿用其读数。
 * 来源报告整个页面都无法取得 PCM（`PcmUnavailableError`）后，本实例不再请求。
 * 单首无法取得时（网络流、无法解码），状态为 `failed`。
 * 取数失败、页面无法取得 PCM 与读数过慢都写入运行日志，字段不含曲目路径与标题
 */
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
  // 上一次处理的输入，尚未处理时为 null
  let input: { key: string; want: boolean } | null = null;

  function stop(): void {
    token += 1;
    inflight?.abort();
    inflight = null;
  }

  async function load(target: DynamicsTrack, key: string, id: number, from: PlanesSource) {
    const startedAt = performance.now();
    const rate = target.sampleRate ?? 0;
    const controller = new AbortController();
    inflight = controller;
    let value: TrackDynamics | null;
    try {
      value = await measureTrack(target, from, controller.signal, () => id === token, pause);
    } catch (error) {
      if (id !== token) return;
      inflight = null;
      if (error instanceof PcmUnavailableError) {
        log.warn('host', 'dynamics.unavailable', { rate, reason: error.message });
        unavailable = true;
        store.set(stateAtom, { status: 'unavailable', result: null });
        return;
      }
      log.warn('host', 'dynamics.failed', { code: rejectionCode(error), rate });
      value = null;
    }
    if (id !== token) return;
    inflight = null;
    const ms = Math.round(performance.now() - startedAt);
    if (ms >= SLOW_ANALYSIS_MS) log.warn('host', 'dynamics.slow', { ms, rate });
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

  // 先订阅，再读取初值
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
