/**
 * TT DR Meter 的动态范围（`DR14` 那种整数）：每声道按 3 s 分块，块 RMS 取 `sqrt(2 · mean(x²))`（满幅正弦为 0 dB），
 * 块峰值取最大绝对值；取 RMS 最大的 20% 块（至少一块）的均方根，与所有块峰值里第二大的那个比，换成 dB，
 * 各声道平均后四舍五入。末块不满 3 s 照算，按它自己的长度求均方；不满三块的曲目不给值。
 */

export const DR_BLOCK_SECONDS = 3;
const TOP_SHARE = 0.2;
const MIN_BLOCKS = 3;

export interface DrMeter {
  /** 喂一段逐声道样本：每路取 `[from, to)`，按时间顺序接着上一段。 */
  push(planes: readonly Float32Array[], from?: number, to?: number): void;
  /** 结算整首；之后不能再喂。 */
  finish(): number | null;
}

/** 一路的 DR（dB）：`rms` 与 `peaks` 是各块的值，至少三块。 */
export function channelDr(rms: readonly number[], peaks: readonly number[]): number {
  const loud = [...rms].sort((a, b) => b - a);
  const top = loud.slice(0, Math.max(1, Math.floor(loud.length * TOP_SHARE)));
  const rmsTop = Math.sqrt(top.reduce((sum, value) => sum + value * value, 0) / top.length);
  const second = [...peaks].sort((a, b) => b - a)[1] ?? 0;
  // 整路静音时没有比值，按 0 计，与参考实现一致。
  return rmsTop > 0 && second > 0 ? 20 * Math.log10(second / rmsTop) : 0;
}

export function createDrMeter(sampleRate: number, channels: number): DrMeter {
  const blockFrames = Math.max(1, Math.round(sampleRate * DR_BLOCK_SECONDS));
  const sums = new Float64Array(channels);
  const peaks = new Float64Array(channels);
  const blockRms: number[][] = Array.from({ length: channels }, () => []);
  const blockPeaks: number[][] = Array.from({ length: channels }, () => []);
  let filled = 0;

  function closeBlock(): void {
    for (let channel = 0; channel < channels; channel += 1) {
      blockRms[channel]?.push(Math.sqrt((2 * (sums[channel] ?? 0)) / filled));
      blockPeaks[channel]?.push(peaks[channel] ?? 0);
    }
    sums.fill(0);
    peaks.fill(0);
    filled = 0;
  }

  function scan(input: Float32Array, channel: number, from: number, to: number): void {
    let sum = 0;
    let peak = peaks[channel] ?? 0;
    for (let index = from; index < to; index += 1) {
      const x = input[index] ?? 0;
      sum += x * x;
      const size = x < 0 ? -x : x;
      if (size > peak) peak = size;
    }
    sums[channel] = (sums[channel] ?? 0) + sum;
    peaks[channel] = peak;
  }

  return {
    push(planes, from = 0, to = planes[0]?.length ?? 0) {
      let at = from;
      while (at < to) {
        const take = Math.min(to - at, blockFrames - filled);
        for (let channel = 0; channel < channels; channel += 1) {
          const input = planes[channel];
          if (input) scan(input, channel, at, at + take);
        }
        filled += take;
        at += take;
        if (filled === blockFrames) closeBlock();
      }
    },
    finish() {
      if (filled > 0) closeBlock();
      if ((blockRms[0]?.length ?? 0) < MIN_BLOCKS) return null;
      let total = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        total += channelDr(blockRms[channel] ?? [], blockPeaks[channel] ?? []);
      }
      // 正弦这类 DR 恰为 0 的信号，均值会是极小的负数，舍入出 -0；按 0 给。
      return Math.round(total / channels) || 0;
    },
  };
}
