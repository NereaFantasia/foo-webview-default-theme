import { renderBands, type BandSignals, type WaveformBands } from './waveformBands.ts';

/**
 * 整轨分频按段做：一段一段向来源要 PCM、分频、按窗求 RMS，拼成整首的结果。整首一次解完再分析，20 分钟的曲子
 * 单是四条链的输出就要四百多 MB，一小时的混音连宿主单块缓冲的上限（x64 256 MiB）都超；按段做，占用只跟段长有关。
 *
 * 窗按时间划：整首 `duration` 秒等分成 `windows` 个窗，每段负责整数个窗。滤波器从静止起步，段首的输出要过一阵
 * 才可信，所以每段往前多要 `PREROLL_SECONDS`，这部分只让滤波器进入稳态、不计入任何窗。
 */
export const SEGMENT_SECONDS = 120;
/** 最低的一节是 A 计权 20.6 Hz 的双极点高通，时间常数约 8 ms；半秒远超它的稳定时间。 */
export const PREROLL_SECONDS = 0.5;

const BAND_KEYS = ['low', 'mid', 'high', 'weighted'] as const;

export interface BandSegment {
  firstWindow: number;
  windowCount: number;
  /** 向来源要的区间（秒）：起点含预滚，终点是最后一个窗的右沿。 */
  start: number;
  end: number;
}

export interface PcmPiece {
  audio: AudioBuffer;
  /** `audio` 第一个样本在曲目里的时刻（秒）；宿主按实际生效的起点报。 */
  start: number;
}

/** 取曲目 `range` 这一段；取不了给 `null`，整首就此作废。 */
export type SegmentSource = (range: { start: number; end: number }) => Promise<PcmPiece | null>;

export interface SegmentOptions {
  segmentSeconds?: number;
  prerollSeconds?: number;
  /** 每段取回、分频之后各问一次；假就停下、给 `null`（换曲、销毁）。 */
  isCurrent?: () => boolean;
  render?: (audio: AudioBuffer) => Promise<BandSignals>;
  /**
   * 每段分频之后、按窗求 RMS 之前交给调用方一次：节拍跟踪在同一份分频输出上取能量，不必再解一遍。
   * `from` / `to` 是这一段负责的区间（秒，不含预滚）。
   */
  onSegment?: (signals: BandSignals, piece: PcmPiece, from: number, to: number) => void;
}

export function planSegments(
  duration: number,
  windows: number,
  segmentSeconds = SEGMENT_SECONDS,
  prerollSeconds = PREROLL_SECONDS,
): BandSegment[] {
  if (!(duration > 0) || !(windows > 0)) return [];
  const windowSeconds = duration / windows;
  // 先按段长上限定段数，再把窗平均分：只按上限塞满的话，尾巴可能剩一两个窗，为它单独开一次解码器。
  const perSegmentMax = Math.max(1, Math.floor(segmentSeconds / windowSeconds));
  const perSegment = Math.ceil(windows / Math.ceil(windows / perSegmentMax));
  const segments: BandSegment[] = [];
  for (let first = 0; first < windows; first += perSegment) {
    const count = Math.min(perSegment, windows - first);
    segments.push({
      firstWindow: first,
      windowCount: count,
      start: Math.max(0, first * windowSeconds - prerollSeconds),
      end: (first + count) * windowSeconds,
    });
  }
  return segments;
}

/**
 * 把第 `first` 起 `count` 个窗的 RMS 写进 `out`。`samples` 从曲目的 `sampleStart` 秒起、每秒 `sampleRate` 个；
 * 窗的边界按四舍五入落到样本上。样本没盖满的窗按有的那部分算，一个样本都没有的写 0（解出来比标称时长短）。
 */
export function windowRmsAt(
  samples: ArrayLike<number>,
  sampleRate: number,
  sampleStart: number,
  windowSeconds: number,
  first: number,
  count: number,
  out: Float32Array,
): void {
  const frameAt = (seconds: number): number =>
    Math.min(samples.length, Math.max(0, Math.round((seconds - sampleStart) * sampleRate)));
  for (let window = first; window < first + count; window += 1) {
    const from = frameAt(window * windowSeconds);
    const to = frameAt((window + 1) * windowSeconds);
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      const sample = samples[index] ?? 0;
      sum += sample * sample;
    }
    out[window] = to > from ? Math.sqrt(sum / (to - from)) : 0;
  }
}

/** 整首的分频结果；时长不可用、任何一段取不了或中途不再需要时给 `null`。 */
export async function analyseSegments(
  source: SegmentSource,
  duration: number,
  windows: number,
  options: SegmentOptions = {},
): Promise<WaveformBands | null> {
  const segments = planSegments(duration, windows, options.segmentSeconds, options.prerollSeconds);
  if (segments.length === 0) return null;
  const render = options.render ?? renderBands;
  const stale = (): boolean => options.isCurrent?.() === false;
  const windowSeconds = duration / windows;
  const out: WaveformBands = {
    low: new Float32Array(windows),
    mid: new Float32Array(windows),
    high: new Float32Array(windows),
    weighted: new Float32Array(windows),
  };
  for (const segment of segments) {
    const piece = await source({ start: segment.start, end: segment.end });
    if (stale() || !piece) return null;
    const signals = await render(piece.audio);
    if (stale()) return null;
    options.onSegment?.(signals, piece, segment.firstWindow * windowSeconds, segment.end);
    for (const key of BAND_KEYS) {
      windowRmsAt(
        signals[key],
        piece.audio.sampleRate,
        piece.start,
        windowSeconds,
        segment.firstWindow,
        segment.windowCount,
        out[key],
      );
    }
  }
  return out;
}
