/**
 * 频谱柱的横轴：低频段一个频点一根柱，往上按对数等分。均为纯函数
 *
 * 纯对数轴上一根柱只占所在频率的百分之几（200 根柱铺满 20 Hz 到 22 kHz 时约 3.6%）。8192 点、44.1 kHz 时，
 * 约 150 Hz 以下的柱已窄于一个频点（5.4 Hz），相邻几根柱只能读取同一个频点，画出来是一级级台阶。
 * 因此从最低的频点起每个频点分配一根柱，直到剩余的柱按对数分时第一根也不窄于一个频点，交界以上按对数分。
 * 每根柱都有自己的频点，低频段不插值，也不重复。轴只由采样率、点数、柱数与右端上限决定
 */
export interface BarAxis {
  /** 各柱的频率边界（Hz）：第 i 根柱是 `[edges[i], edges[i + 1])`，长度为柱数 + 1 */
  edges: Float64Array;
  /** 线性段的柱数：前 `binBars` 根柱每根对应一个频点，其后是对数段 */
  binBars: number;
  /** 相邻频点的间隔（Hz） */
  binHz: number;
}

/**
 * 用 `sampleRate` 采样、`fftSize` 点的频点铺 `bars` 根柱，范围从 `minHz` 到 `maxHz` 与 Nyquist 中较小者。
 * 线性段每根柱以一个频点为中心，宽一个频点间隔。只有第一根从 `minHz` 开始，到第一个频点之上半个间隔为止。
 * 整条轴都不窄于一个频点时（点数足够大）没有线性段，从 `minHz` 起按对数分
 */
export function barAxisFor(
  sampleRate: number,
  fftSize: number,
  bars: number,
  minHz: number,
  maxHz = Number.POSITIVE_INFINITY,
): BarAxis {
  const binHz = sampleRate / fftSize;
  const top = Math.min(maxHz, sampleRate / 2);
  const firstBin = Math.max(1, Math.ceil(minHz / binHz));
  // 线性段前 count 根柱的右缘，也是对数段的起点
  const splitAt = (count: number): number =>
    count === 0 ? minHz : (firstBin + count - 0.5) * binHz;
  let binBars = 0;
  while (binBars < bars - 1 && splitAt(binBars + 1) < top) {
    const split = splitAt(binBars);
    if (split * ((top / split) ** (1 / (bars - binBars)) - 1) >= binHz) break;
    binBars += 1;
  }
  const edges = new Float64Array(bars + 1);
  for (let bar = 0; bar <= binBars; bar += 1) edges[bar] = splitAt(bar);
  const split = splitAt(binBars);
  const logBars = bars - binBars;
  for (let step = 1; step < logBars; step += 1) {
    edges[binBars + step] = split * (top / split) ** (step / logBars);
  }
  edges[bars] = top;
  return { edges, binBars, binHz };
}

/**
 * 频率 `hz` 在轴上的位置：0 是第一根柱的左缘，1 是最后一根柱的右缘，超出两端时取端值。
 * 柱内按该柱的分法插值：线性段按频率，对数段按对数
 */
export function axisFraction(axis: BarAxis, hz: number): number {
  const { edges, binBars } = axis;
  const bars = edges.length - 1;
  if (!(bars > 0) || !(hz > (edges[0] ?? 0))) return 0;
  if (hz >= (edges[bars] ?? 0)) return 1;
  let bar = 0;
  while (bar < bars - 1 && hz >= (edges[bar + 1] ?? 0)) bar += 1;
  const low = edges[bar] ?? 0;
  const high = edges[bar + 1] ?? low;
  const within =
    bar < binBars ? (hz - low) / (high - low) : Math.log(hz / low) / Math.log(high / low);
  return (bar + within) / bars;
}
