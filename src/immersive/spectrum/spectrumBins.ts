import type { BarAxis } from './barAxis.ts';

/**
 * 宿主频点帧（订阅时 `output: 'bins'`）的读取与并柱，纯函数。
 *
 * 帧里每个值是一个 FFT 频点的 dB 功率：`10 · log10(p) − 2.75`，满幅正弦主瓣所落各频点的功率之和为 0 dB，
 * 下限 −160；第 i 项是频点 `firstBin + i`，中心频率 `(firstBin + i) · sampleRate / fftSize`。宿主不插值、不加权，
 * 点数按请求算、不自动提升，所以低频能分出多少个值只由窗长决定；频谱柱的横轴怎么分见 `barAxis.ts`。
 */
export interface BinsFrame {
  /** 逐频点 dB 功率。 */
  values: readonly number[];
  /** `values[0]` 的频点序号。 */
  firstBin: number;
  /** 相邻频点的间隔（Hz），即 `sampleRate / fftSize`。 */
  binHz: number;
  /** 可视化流采样率的一半（Hz）。 */
  nyquist: number;
}

/** 静音与空带的值：宿主 dB 功率的下限。 */
export const BIN_FLOOR_DB = -160;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * 从宿主应答里取频点帧。只认 `output: 'bins'` 且单路（`spectrum`）的帧；采样率未知时宿主报 0，
 * 这时算不出频点的频率，也当没收到。
 */
export function binsFrameOf(payload: unknown): BinsFrame | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('output' in payload) || payload.output !== 'bins') return null;
  if (!('spectrum' in payload) || !('firstBin' in payload)) return null;
  if (!('fftSize' in payload) || !('sampleRate' in payload)) return null;
  const { spectrum, firstBin, fftSize, sampleRate } = payload;
  if (!Array.isArray(spectrum) || !spectrum.every(isNumber)) return null;
  if (!isNumber(firstBin) || !Number.isInteger(firstBin) || firstBin < 0) return null;
  if (!isNumber(fftSize) || !(fftSize > 0) || !isNumber(sampleRate) || !(sampleRate > 0)) {
    return null;
  }
  return { values: spectrum, firstBin, binHz: sampleRate / fftSize, nyquist: sampleRate / 2 };
}

/**
 * 对数段每根柱再按对数分成这么多份，每份取带内频点功率之和，柱取最大的一份。中频一个半音跨五六份，
 * 谐波的窄峰不会被峰间的谷拉平；份内求和与宿主 `'db'` 档同一口径，纵轴的 dB 标定照用。
 */
export const BAR_PARTS = 5;

/**
 * 频点按 `axis` 并成柱（dB）：线性段一根柱就是它的那个频点，对数段按 `BAR_PARTS` 份取最大。
 * 频点归入中心频率所在的那一份（左闭右开）。柱里一个频点都没有时——帧的点数比轴用的少，
 * 或柱在帧的频点范围以外——取离柱中心最近的频点，不在两个频点之间插值。
 */
export function barsOfBins(frame: BinsFrame, axis: BarAxis, out: Float32Array): void {
  const { values, firstBin, binHz } = frame;
  const count = values.length;
  if (count === 0) {
    out.fill(BIN_FLOOR_DB);
    return;
  }
  const bars = Math.min(out.length, axis.edges.length - 1);
  // 中心频率不低于 hz 的第一个频点的下标。
  const indexFrom = (hz: number): number =>
    Math.min(count, Math.max(0, Math.ceil(hz / binHz) - firstBin));
  for (let bar = 0; bar < bars; bar += 1) {
    const low = axis.edges[bar] ?? 0;
    const high = axis.edges[bar + 1] ?? low;
    const parts = bar < axis.binBars ? 1 : BAR_PARTS;
    const edgeAt = (part: number): number =>
      part === 0 ? low : part === parts ? high : low * (high / low) ** (part / parts);
    let peak = Number.NEGATIVE_INFINITY;
    for (let part = 0; part < parts; part += 1) {
      const from = indexFrom(edgeAt(part));
      const to = indexFrom(edgeAt(part + 1));
      if (from >= to) continue;
      let power = 0;
      for (let index = from; index < to; index += 1) {
        power += 10 ** ((values[index] ?? BIN_FLOOR_DB) / 10);
      }
      peak = Math.max(peak, power > 0 ? 10 * Math.log10(power) : BIN_FLOOR_DB);
    }
    if (peak === Number.NEGATIVE_INFINITY) {
      const nearest = Math.round(Math.sqrt(low * high) / binHz) - firstBin;
      peak = values[Math.min(count - 1, Math.max(0, nearest))] ?? BIN_FLOOR_DB;
    }
    out[bar] = Math.max(BIN_FLOOR_DB, peak);
  }
  out.fill(BIN_FLOOR_DB, bars);
}
