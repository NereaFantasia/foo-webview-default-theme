/**
 * 起音曲线的自相关：估拍长，并给挑拍层级的候选打节拍层级树分（`beatTracker.ts` 的 `chooseBeats` 用）。
 * 滞后 τ 的拍长得分是 r(τ) + r(2τ) / 2（真拍长在两倍处也有相关峰，偏了几个百分点的候选在两倍处偏得更远），
 * 在 50–220 BPM 对应的滞后里按「离 120 BPM 越远越不像」的先验加权后取最大。单位：帧（`ONSET_HOP` 个样本）。
 */
export const MIN_BPM = 50;
export const MAX_BPM = 220;
/**
 * 速度先验的中心与宽度（倍频程）。估值落在 70–180 BPM 里，摆锤才不会慢得发呆、快得发抖；
 * 宽度取 0.7 时，60 首曲目里落在这个范围的有 59 首，取 1 时只有 56 首。
 */
export const PRIOR_BPM = 120;
export const PRIOR_OCTAVES = 0.7;
/**
 * 节拍层级树（O. Lartillot 的做法）：二分树取拍长的 1/4、1/2、1、2、4 倍，三分树取 1/6、1/3、1、2、4 倍。
 * 真拍长的细分、两拍与小节都落在起音的周期上，附点节奏型的周期换算过去对不上这么多层。
 */
const METER_TREES = [
  [1 / 4, 1 / 2, 1, 2, 4],
  [1 / 6, 1 / 3, 1, 2, 4],
] as const;

/** 拍长（帧，带小数）；曲线太短估不出时给 `null`。 */
export function estimatePeriod(onset: ArrayLike<number>, framesPerSecond: number): number | null {
  const correlation = autocorrelation(onset, framesPerSecond, 2);
  return correlation === null ? null : periodFrom(correlation, framesPerSecond);
}

/**
 * 去均值的自相关，按重叠的帧数取平均；滞后算到最长拍长的 `reach` 倍再多两帧（两倍谐波与插值要用）。
 * 估拍长取 2，层级树要看到四倍拍长处，取 4。曲线不到最长拍长的四倍时给 `null`。
 */
export function autocorrelation(
  onset: ArrayLike<number>,
  framesPerSecond: number,
  reach: number,
): Float64Array | null {
  const maxLag = Math.ceil((framesPerSecond * 60) / MIN_BPM);
  const frames = onset.length;
  if (frames < maxLag * 4) return null;
  // 先减去均值：起音曲线恒为非负，直接自相关会带一个与滞后无关的直流底，乘上先验就在 120 BPM 附近凭空鼓起一个包，
  // 把估值往那里拉（真实曲目上实测普遍偏向 110–130）。
  let mean = 0;
  for (let frame = 0; frame < frames; frame += 1) mean += onset[frame] ?? 0;
  mean /= frames;
  const centered = Float64Array.from({ length: frames }, (_, frame) => (onset[frame] ?? 0) - mean);
  const correlation = new Float64Array(reach * maxLag + 3);
  for (let lag = 1; lag < correlation.length && lag < frames; lag += 1) {
    let sum = 0;
    for (let frame = 0; frame + lag < frames; frame += 1) {
      sum += (centered[frame] ?? 0) * (centered[frame + lag] ?? 0);
    }
    correlation[lag] = sum / (frames - lag);
  }
  return correlation;
}

/** 按两倍谐波与速度先验在自相关上挑拍长（帧，带小数）；没有正的得分时给 `null`。 */
export function periodFrom(correlation: Float64Array, framesPerSecond: number): number | null {
  const minLag = Math.max(1, Math.floor((framesPerSecond * 60) / MAX_BPM));
  const maxLag = Math.ceil((framesPerSecond * 60) / MIN_BPM);
  const scores = new Float64Array(maxLag + 2);
  for (let lag = Math.max(1, minLag - 1); lag <= maxLag + 1; lag += 1) {
    const octaves = Math.log2((framesPerSecond * 60) / lag / PRIOR_BPM) / PRIOR_OCTAVES;
    const harmonic = (correlation[lag] ?? 0) + (correlation[2 * lag] ?? 0) / 2;
    scores[lag] = harmonic * Math.exp(-0.5 * octaves * octaves);
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag += 1)
    if ((scores[lag] ?? 0) > (scores[best] ?? 0)) best = lag;
  if (!((scores[best] ?? 0) > 0)) return null;
  // 抛物线插值把整数滞后细化成小数，拍长的误差会沿整首累积。
  const left = scores[best - 1] ?? 0;
  const center = scores[best] ?? 0;
  const right = scores[best + 1] ?? 0;
  const curvature = left - 2 * center + right;
  const shift = curvature < 0 ? (0.5 * (left - right)) / curvature : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

/**
 * 拍长 `period`（帧，带小数）的节拍层级树分：二分树与三分树各把几层上的自相关加起来，取高的。
 * 小数滞后处按相邻两帧线性插值；自相关要按 `reach` 为 4 算。
 */
export function treeScore(correlation: Float64Array, period: number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const levels of METER_TREES) {
    let score = 0;
    for (const level of levels) {
      const lag = period * level;
      const low = Math.floor(lag);
      const t = lag - low;
      score += (correlation[low] ?? 0) * (1 - t) + (correlation[low + 1] ?? 0) * t;
    }
    best = Math.max(best, score);
  }
  return best;
}
