import {
  fb,
  type PcmRingRead,
  type PcmStreamFormat,
  type PcmStreamOptions,
  type PcmStreamOutcome,
} from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { currentTrackAtom } from '../../playback/playback.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import { createFrameScheduler, type FrameClock } from '../frame/frameScheduler.ts';
import { createBlockMeter, createLoudnessWindow, type BlockMeter } from './loudnessMeter.ts';

/**
 * 量表的实时响度：宿主连上、有曲目时订阅宿主的实时 PCM 流（`audio.subscribeStream`），每拍读一次，
 * 读到的帧过 K 加权、每 100 ms 出一块，更新 Momentary（最近 400 ms）与 Short-term（最近 3 s）。
 * 一拍里出了几块，读数只在这一拍末写一次，值是最后一块算完时的。
 *
 * 流的段表里段号变了（起播、seek、手动或无缝换曲、位置跳变、开始观察）或报了丢帧，就从那一帧起清滤波状态与窗：
 * 前后的样本不连续。采样率或声道数变了时段号不变，按格式另判：从这次读到的帧起换一套 K 加权、清窗。
 * 清空后第一块到手之前读数不动，免得在 seek、换曲时闪成 `—`。暂停时流里不来新帧，读数定格；暂停再继续是同一段，
 * 接着算。流里最新一帧比可听位置晚约 14 ms，读数不另做对齐。
 *
 * 没有曲目（停止）时退订、读数清空。宿主不接受订阅（没有宿主、运行时不支持共享缓冲、本页的流订阅已满）时也退订、
 * 读数清空，并置 `failed`；换曲不重试，停止后再有曲目才再试。
 */
/** 用到的 `PcmStream` 那几项；SDK 的 `PcmStream` 按结构满足它。 */
export interface LiveStream {
  readonly ready: Promise<PcmStreamOutcome>;
  readonly format: PcmStreamFormat | null;
  read(): PcmRingRead | null;
  unsubscribe(): void;
}

export interface LiveLoudnessHost {
  audio: { subscribeStream(options: PcmStreamOptions): LiveStream };
}

/** 向核心要的回调间隔（秒）：块是 100 ms，间隔再短也只是多读几次空。 */
export const STREAM_INTERVAL_SECONDS = 0.05;
/** 环形缓冲的长度（秒）；每拍都读，只要盖得住页面偶尔的卡顿。 */
export const STREAM_BUFFER_SECONDS = 1;
/** 读流的频率上限（fps）。 */
export const READ_FPS = 20;

export interface LiveLoudness {
  /** LUFS；还没有值时为 `null`。 */
  readonly momentary: number | null;
  readonly shortTerm: number | null;
  /** 这次订阅宿主不接受；停止后再有曲目时再试。 */
  readonly failed: boolean;
}

export interface LiveLoudnessService {
  dispose(): void;
}

const INITIAL: LiveLoudness = { momentary: null, shortTerm: null, failed: false };
const stateAtom = atom<LiveLoudness>(INITIAL);
const activeAtom = atom((get) => get(playbackConnectedAtom) && get(currentTrackAtom) !== null);

export const liveLoudnessAtom: Atom<LiveLoudness> = atom((get) => get(stateAtom));

export function startLiveLoudness(
  store: Store,
  options: { host?: LiveLoudnessHost; clock?: FrameClock; active?: Atom<boolean> } = {},
): LiveLoudnessService {
  const host = options.host ?? fb;
  store.set(stateAtom, INITIAL);
  const recent = createLoudnessWindow();
  const scheduler = createFrameScheduler(tick, options.clock, { fixed: READ_FPS });
  let stream: LiveStream | null = null;
  let meter: BlockMeter | null = null;
  let format = '';
  // `undefined` 是这次订阅还没读到过帧；`null` 是读到的帧不在已知的段里。
  let lastSegment: number | null | undefined;
  // 这一拍最后一块算完时的读数；这一拍没出块时为 null。
  let latest: Pick<LiveLoudness, 'momentary' | 'shortTerm'> | null = null;
  let disposed = false;

  const patch = (next: Partial<LiveLoudness>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...next });

  function onBlock(energy: number): void {
    recent.push(energy);
    latest = { momentary: recent.momentary(), shortTerm: recent.shortTerm() };
  }

  function restart(): void {
    meter?.reset();
    recent.clear();
  }

  function consume(read: PcmRingRead, current: LiveStream): void {
    const spec = current.format;
    if (!spec || read.frames === 0) return;
    const key = `${spec.sampleRate}|${read.planes.length}`;
    if (!meter || key !== format) {
      meter = createBlockMeter(spec.sampleRate, read.planes.length, onBlock);
      format = key;
      recent.clear();
    } else if (read.dropped > 0) {
      restart();
    }
    read.segments.forEach((segment, index) => {
      const to = read.segments[index + 1]?.offset ?? read.frames;
      if (segment.segment !== lastSegment) {
        if (lastSegment !== undefined) restart();
        lastSegment = segment.segment;
      }
      meter?.push(read.planes, segment.offset, to);
    });
  }

  function tick(): void {
    const current = stream;
    if (!current) return;
    const read = current.read();
    if (stream !== current) return;
    if (read) consume(read, current);
    if (latest) patch(latest);
    latest = null;
    if (stream === current) scheduler.schedule();
  }

  /** 摘掉订阅、丢掉累加状态；不写读数。 */
  function teardown(): void {
    scheduler.cancel();
    const previous = stream;
    stream = null;
    meter = null;
    format = '';
    lastSegment = undefined;
    latest = null;
    recent.clear();
    previous?.unsubscribe();
  }

  function open(): void {
    const current = host.audio.subscribeStream({
      interval: STREAM_INTERVAL_SECONDS,
      bufferSeconds: STREAM_BUFFER_SECONDS,
    });
    stream = current;
    void current.ready.then((outcome) => {
      if (outcome.ok || stream !== current) return;
      teardown();
      store.set(stateAtom, { momentary: null, shortTerm: null, failed: true });
    });
    scheduler.schedule();
  }

  function follow(): void {
    if (disposed) return;
    const on = store.get(activeAtom);
    if (options.active && !store.get(options.active)) {
      teardown();
      store.set(stateAtom, { ...INITIAL, failed: on && store.get(stateAtom).failed });
      return;
    }
    if (on && !stream && !store.get(stateAtom).failed) open();
    if (on) return;
    if (stream) teardown();
    store.set(stateAtom, INITIAL);
  }

  // 先订阅再初读。
  const offs = [store.sub(activeAtom, follow)];
  if (options.active) offs.push(store.sub(options.active, follow));
  follow();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      teardown();
    },
  };
}
