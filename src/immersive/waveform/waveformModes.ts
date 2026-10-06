import type { WaveformBands } from './waveformBands.ts';

/**
 * 整轨波形的五种画法与各自要画的层。`rms` 画宿主的全频包络；其余四种吃页面分频的结果（`waveformBands.ts`），
 * 分频结果还没有、或这首拿不到时都按 `rms` 画：
 * - `weighted`：A 计权一条，压低频的单层；
 * - `midHigh`：中高频合成的包络做主体，全频包络作底影；
 * - `layers`：低 / 中 / 高三层以中线对称叠画，前层缩一圈，后层的边才露得出来；
 * - `lanes`：三条分道，高频在上、低频在下，各自从底往上画。
 * 分频的层各按自己的 99.5% 分位归一：分开后高频比低频低十几 dB，按同一个最大值归一，高频只剩一条线。
 */
export type WaveformMode = 'rms' | 'weighted' | 'midHigh' | 'layers' | 'lanes';

export const WAVEFORM_MODES: readonly WaveformMode[] = [
  'rms',
  'weighted',
  'midHigh',
  'layers',
  'lanes',
];

/** 层的色调：`shade` 是数据墨的淡色，`ink` 数据墨，`hot` 热色。 */
export type LayerTone = 'shade' | 'ink' | 'hot';

export interface WaveformLayer {
  /** 每点 0…1。 */
  points: ArrayLike<number>;
  tone: LayerTone;
  /** 分道序号，从上往下数；没有时以中线上下对称画。 */
  lane?: number;
}

const NORMALIZE_QUANTILE = 0.995;
/** 中高频合成时高频的权重：高频能量通常比中频低一截（2.5 倍约合 8 dB），不加权的话合成出来几乎就是中频。 */
const HIGH_WEIGHT = 2.5;
const LAYER_SCALE = { mid: 0.85, high: 0.6 };

export function isWaveformMode(value: unknown): value is WaveformMode {
  return typeof value === 'string' && (WAVEFORM_MODES as readonly string[]).includes(value);
}

export function needsBands(mode: WaveformMode): boolean {
  return mode !== 'rms';
}

/** 按 `quantile` 分位归一到 0…1，分位以上的夹到 1；全零给全零。 */
export function unitLevels(values: ArrayLike<number>, quantile = NORMALIZE_QUANTILE): Float32Array {
  const out = new Float32Array(values.length);
  if (values.length === 0) return out;
  const sorted = Float32Array.from(values).sort();
  const reference = sorted[Math.floor(quantile * (sorted.length - 1))] ?? 0;
  if (!(reference > 0)) return out;
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Math.min((values[index] ?? 0) / reference, 1);
  }
  return out;
}

function scaled(points: Float32Array, factor: number): Float32Array {
  return points.map((value) => value * factor);
}

/** 这一画法要画的层，从后往前排；没有分频结果时一律按 `rms` 画。 */
export function waveformLayers(
  mode: WaveformMode,
  rms: readonly number[],
  bands: WaveformBands | null,
): WaveformLayer[] {
  if (mode === 'rms' || !bands) return [{ points: rms, tone: 'ink' }];
  switch (mode) {
    case 'weighted':
      return [{ points: unitLevels(bands.weighted), tone: 'ink' }];
    case 'midHigh': {
      const mixed = bands.mid.map((mid, index) =>
        Math.hypot(mid, HIGH_WEIGHT * (bands.high[index] ?? 0)),
      );
      return [
        { points: rms, tone: 'shade' },
        { points: unitLevels(mixed), tone: 'ink' },
      ];
    }
    case 'layers':
      return [
        { points: unitLevels(bands.low), tone: 'shade' },
        { points: scaled(unitLevels(bands.mid), LAYER_SCALE.mid), tone: 'ink' },
        { points: scaled(unitLevels(bands.high), LAYER_SCALE.high), tone: 'hot' },
      ];
    case 'lanes':
      return [
        { points: unitLevels(bands.high), tone: 'hot', lane: 0 },
        { points: unitLevels(bands.mid), tone: 'ink', lane: 1 },
        { points: unitLevels(bands.low), tone: 'shade', lane: 2 },
      ];
  }
}
