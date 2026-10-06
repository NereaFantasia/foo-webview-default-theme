/**
 * 频谱柱的横轴：低频一个频点一根柱，往上按对数等分。纯函数。
 *
 * 纯对数轴上一根柱只占所在频率的百分之几宽（200 根铺 20 Hz 到 22 kHz 时约 3.6%），8192 点、44.1 kHz 下
 * 约 150 Hz 以下就窄过一个频点（5.4 Hz），几根相邻的柱只能读同一个频点，画出来是一级级平台。
 * 这里从最低的频点起一个频点给一根柱，直到剩下的柱按对数分时第一根也不窄于一个频点，交界往上照对数分：
 * 每根柱都有自己的频点，低频不插值、也不重复。轴只由采样率、点数与柱数决定。
 */
export interface BarAxis {
  /** 各柱的频率边界（Hz）：第 i 根柱是 `[edges[i], edges[i + 1])`，长度为柱数 + 1。 */
  edges: Float64Array;
  /** 前多少根柱一根一个频点（线性段），其后是对数段。 */
  binBars: number;
  /** 相邻频点的间隔（Hz）。 */
  binHz: number;
}

/**
 * `sampleRate` 采样、`fftSize` 点的频点铺 `bars` 根柱，从 `minHz` 到 Nyquist。线性段每根柱以一个频点为中心、
 * 宽一个频点间隔，只有第一根从 `minHz` 起、到第一个频点往上半个间隔；整条轴都不窄于一个频点时（点数够大）
 * 没有线性段，从 `minHz` 起按对数分。
 */
export function barAxisFor(
  sampleRate: number,
  fftSize: number,
  bars: number,
  minHz: number,
): BarAxis {
  const binHz = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const firstBin = Math.max(1, Math.ceil(minHz / binHz));
  // 线性段前 count 根柱的右缘，也是对数段的起点。
  const splitAt = (count: number): number =>
    count === 0 ? minHz : (firstBin + count - 0.5) * binHz;
  let binBars = 0;
  while (binBars < bars - 1 && splitAt(binBars + 1) < nyquist) {
    const split = splitAt(binBars);
    if (split * ((nyquist / split) ** (1 / (bars - binBars)) - 1) >= binHz) break;
    binBars += 1;
  }
  const edges = new Float64Array(bars + 1);
  for (let bar = 0; bar <= binBars; bar += 1) edges[bar] = splitAt(bar);
  const split = splitAt(binBars);
  const logBars = bars - binBars;
  for (let step = 1; step < logBars; step += 1) {
    edges[binBars + step] = split * (nyquist / split) ** (step / logBars);
  }
  edges[bars] = nyquist;
  return { edges, binBars, binHz };
}

/**
 * 频率 `hz` 在轴上的位置：0 是第一根柱的左缘、1 是最后一根的右缘，超出两端夹住。
 * 柱内按柱的分法插：线性段按频率、对数段按对数。
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
