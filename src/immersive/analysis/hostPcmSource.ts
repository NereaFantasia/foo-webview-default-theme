import { PcmDecodeError, fb, type DecodePcmOptions } from 'foo-webview-sdk/bridge';
import { isLocalMedia } from './localMedia.ts';
import { PcmUnavailableError, type PcmSource, type PcmTrack } from './trackAnalysis.ts';
import type { PlanesSource } from '../gauges/trackDynamics.ts';
import { ANALYSIS_SAMPLE_RATE } from '../waveform/waveformBands.ts';

/**
 * 宿主 `audio.decodePcm` 的两种用法，都经共享缓冲交过来。整轨分频（`hostPcmSource`）把一段解成
 * `ANALYSIS_SAMPLE_RATE` 的单声道，拷进 `AudioBuffer` 后立刻释放共享缓冲，免得几段的内存同时占着；
 * 量表（`hostFullRatePcm`）要原采样率、全部声道。解码在宿主的后台线程里跑，不停 fb2k 的主线程。
 *
 * 路径交 `track.handle`：分轨自带 `|subsong:N`，宿主按后缀取那一轨；不另传 `cueIndex`，曲目的 `subsong`
 * 是解码器给的标识，不一定是序号。网络流不取。`signal` 原样交给 SDK，中止时由它取消宿主那边的任务。
 * 宿主答 `NOT_SUPPORTED`（没有宿主、运行时不支持共享缓冲、缺重采样器，都是整个页面的事）时抛
 * `PcmUnavailableError`；其余失败原样抛出，只算这一首取不了。
 */

/** 用到的 `PcmBuffer` 那几项；SDK 的 `PcmBuffer` 按结构满足它。 */
export interface DecodedPcm {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  /** 第一帧在曲目里的时刻（秒），宿主按实际生效的起点报。 */
  readonly start: number;
  getChannelView(channel: number): Float32Array;
  toAudioBuffer(): AudioBuffer;
  release(): void;
}

export interface PcmHost {
  audio: { decodePcm(path: string, options?: DecodePcmOptions): Promise<DecodedPcm> };
}

function decodeTrack(
  host: PcmHost,
  track: PcmTrack,
  range: { start: number; end: number },
  signal: AbortSignal,
  format: { sampleRate?: number; mono?: boolean },
): Promise<DecodedPcm> {
  return host.audio
    .decodePcm(track.handle, { start: range.start, end: range.end, ...format, signal })
    .catch((error: unknown) => {
      if (error instanceof PcmDecodeError && error.code === 'NOT_SUPPORTED') {
        throw new PcmUnavailableError(error.message);
      }
      throw error;
    });
}

/** 整轨分频的来源：每段拷成 `AudioBuffer`，拷完就释放共享缓冲，拷贝出错也释放。 */
export function createHostPcmSource(host: PcmHost = fb): PcmSource {
  return async (track, range, signal) => {
    if (!isLocalMedia(track.path)) return null;
    const pcm = await decodeTrack(host, track, range, signal, {
      sampleRate: ANALYSIS_SAMPLE_RATE,
      mono: true,
    });
    try {
      return { audio: pcm.toAudioBuffer(), start: pcm.start };
    } finally {
      pcm.release();
    }
  };
}

/**
 * 量表的来源：原采样率、全部声道，按声道给共享缓冲上的视图，不拷贝；调用方读完调 `release()`，
 * 释放之后视图不能再读。
 */
export function createHostFullRatePcm(host: PcmHost = fb): PlanesSource {
  return async (track, range, signal) => {
    if (!isLocalMedia(track.path)) return null;
    const pcm = await decodeTrack(host, track, range, signal, {});
    return {
      sampleRate: pcm.sampleRate,
      frames: pcm.frames,
      planes: Array.from({ length: pcm.channels }, (_, channel) => pcm.getChannelView(channel)),
      release: () => pcm.release(),
    };
  };
}

export const hostPcmSource: PcmSource = createHostPcmSource();

export const hostFullRatePcm: PlanesSource = createHostFullRatePcm();
