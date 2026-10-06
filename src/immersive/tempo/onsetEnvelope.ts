import type { BandSignals } from '../waveform/waveformBands.ts';

/**
 * 节拍跟踪用的起音强度曲线：低 / 中 / 高三段各按帧求能量、换成分贝，逐帧的正向增量加权相加。
 * 分频复用整轨分频的四条链（`renderBands`）里的前三条；A 计权那条是全频的另一种加权，与三段重复。
 * 分三段再加，是为了让鼓的起音不被持续的低频淹掉：同一帧里贝斯持续、军鼓一响，全频能量几乎不变，
 * 中频那一段却跳得很明显。
 *
 * 帧长 `ONSET_HOP` 个样本（按 `energies.sampleRate` 算），帧按曲目时间对齐：第 n 帧从曲目的
 * n · ONSET_HOP / sampleRate 秒起。整首分段送进来，各段只写自己负责的那几帧。
 */
export const ONSET_HOP = 256;
/** 能量的下限，−80 dB：静音里的数值噪声不产生起音。 */
const ENERGY_FLOOR = 1e-8;
/** 高频段的起音多是镲片与齿音，节拍感弱，权重减半。 */
const BAND_WEIGHTS = { low: 1, mid: 1, high: 0.5 } as const;
/** 减去的滑动均值取约半秒：去掉慢变的整体响度，只留起音的尖峰。 */
const MEAN_WINDOW_SECONDS = 0.5;

const BANDS = ['low', 'mid', 'high'] as const;

export interface BandEnergies {
  sampleRate: number;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

export function framesPerSecond(sampleRate: number): number {
  return sampleRate / ONSET_HOP;
}

export function createEnergies(duration: number, sampleRate: number): BandEnergies | null {
  const frames = Math.ceil((duration * sampleRate) / ONSET_HOP);
  if (!(frames > 0)) return null;
  return {
    sampleRate,
    low: new Float32Array(frames),
    mid: new Float32Array(frames),
    high: new Float32Array(frames),
  };
}

/**
 * 把一段分频输出里、起点落在 [`fromSeconds`, `toSeconds`) 的那些帧的均方写进 `energies`。
 * `signals` 第一个样本在曲目的 `sampleStart` 秒、每秒 `signalRate` 个；帧尾超出这段样本的按有的算。
 */
export function accumulateEnergies(
  signals: BandSignals,
  signalRate: number,
  sampleStart: number,
  fromSeconds: number,
  toSeconds: number,
  energies: BandEnergies,
): void {
  const rate = energies.sampleRate;
  const first = Math.max(0, Math.ceil((fromSeconds * rate) / ONSET_HOP));
  const end = Math.min(energies.low.length, Math.ceil((toSeconds * rate) / ONSET_HOP));
  const frameSamples = Math.max(1, Math.round((ONSET_HOP * signalRate) / rate));
  for (const key of BANDS) {
    const samples = signals[key];
    const out = energies[key];
    for (let frame = first; frame < end; frame += 1) {
      const from = Math.round(((frame * ONSET_HOP) / rate - sampleStart) * signalRate);
      const to = Math.min(samples.length, from + frameSamples);
      if (from < 0 || from >= to) continue;
      let sum = 0;
      for (let index = from; index < to; index += 1) {
        const sample = samples[index] ?? 0;
        sum += sample * sample;
      }
      out[frame] = sum / (to - from);
    }
  }
}

/** 起音强度：三段逐帧的分贝增量（只取正的）加权相加，减去滑动均值、负值截成 0，再按均方根归一。 */
export function onsetStrength(energies: BandEnergies): Float32Array {
  const frames = energies.low.length;
  const raw = new Float64Array(frames);
  for (const key of BANDS) {
    const values = energies[key];
    const weight = BAND_WEIGHTS[key];
    let previous = 10 * Math.log10(Math.max(values[0] ?? 0, ENERGY_FLOOR));
    for (let frame = 1; frame < frames; frame += 1) {
      const current = 10 * Math.log10(Math.max(values[frame] ?? 0, ENERGY_FLOOR));
      if (current > previous) raw[frame] = (raw[frame] ?? 0) + weight * (current - previous);
      previous = current;
    }
  }
  const half = Math.max(
    1,
    Math.round((MEAN_WINDOW_SECONDS * framesPerSecond(energies.sampleRate)) / 2),
  );
  const prefix = new Float64Array(frames + 1);
  for (let frame = 0; frame < frames; frame += 1)
    prefix[frame + 1] = (prefix[frame] ?? 0) + (raw[frame] ?? 0);
  const out = new Float32Array(frames);
  let sumSquares = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const from = Math.max(0, frame - half);
    const to = Math.min(frames, frame + half + 1);
    const mean = ((prefix[to] ?? 0) - (prefix[from] ?? 0)) / (to - from);
    const value = Math.max(0, (raw[frame] ?? 0) - mean);
    out[frame] = value;
    sumSquares += value * value;
  }
  const deviation = Math.sqrt(sumSquares / Math.max(1, frames));
  if (deviation > 0)
    for (let frame = 0; frame < frames; frame += 1) out[frame] = (out[frame] ?? 0) / deviation;
  return out;
}
