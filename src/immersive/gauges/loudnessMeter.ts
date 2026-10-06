/**
 * ITU-R BS.1770-4 的响度（EBU R128 用的那一套），单位 LUFS：K 加权后每 100 ms 算一块能量，
 * Momentary 取最近 4 块（400 ms），Short-term 取最近 30 块（3 s）；整首的 Integrated 用 400 ms 块、100 ms 步进，
 * 先过绝对门限 −70 LUFS，再过「绝对门限后的均值减 10 LU」的相对门限。
 *
 * 块能量是各声道 K 加权后均方的加权和：1 至 4 路权重都是 1；5 路以上按 fb2k 的声道次序，第 4 路（LFE）不计、
 * 第 5 路起取 1.41。单声道按一路算，不当双单声道补 3 dB。
 */

export const BLOCK_SECONDS = 0.1;
export const MOMENTARY_BLOCKS = 4;
export const SHORT_TERM_BLOCKS = 30;
export const ABSOLUTE_GATE_LUFS = -70;
export const RELATIVE_GATE_LU = -10;

/** 双二阶的系数，`a0` 已归一化为 1。 */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * 按采样率求 K 加权的两级系数：高架（头部的声学效应）与 RLB 高通。f0、增益与 Q 是 BS.1770 附件 1
 * 在 48 kHz 下那两个滤波器的模拟原型，换采样率时做预畸变的双线性变换；48 kHz 下与标准表一致。
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf: Biquad = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
  };
  const passK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const passQ = 0.5003270373238773;
  const passA0 = 1 + passK / passQ + passK * passK;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (passK * passK - 1)) / passA0,
    a2: (1 - passK / passQ + passK * passK) / passA0,
  };
  return [shelf, highPass];
}

export function channelWeights(channels: number): number[] {
  return Array.from({ length: channels }, (_, index) => {
    if (channels < 5) return 1;
    if (index === 3) return 0;
    return index >= 4 ? 1.41 : 1;
  });
}

/** 块能量换成 LUFS；没有能量给 `null`（数学上是 −∞）。 */
export function loudnessOf(energy: number): number | null {
  return energy > 0 ? -0.691 + 10 * Math.log10(energy) : null;
}

const energyAt = (lufs: number): number => 10 ** ((lufs + 0.691) / 10);

export interface BlockMeter {
  /** 喂一段逐声道样本：每路取 `[from, to)`。每凑满一块回调一次该块的能量。 */
  push(planes: readonly Float32Array[], from?: number, to?: number): void;
  /** 清滤波状态与没凑满的那一块：seek、换曲、丢帧之后前后的样本不连续。 */
  reset(): void;
}

export function createBlockMeter(
  sampleRate: number,
  channels: number,
  onBlock: (energy: number) => void,
): BlockMeter {
  const [shelf, pass] = kWeighting(sampleRate);
  const weights = channelWeights(channels);
  const blockFrames = Math.max(1, Math.round(sampleRate * BLOCK_SECONDS));
  // 每路四个状态：两级各两个，转置直接 II 型。
  const state = new Float64Array(channels * 4);
  const sums = new Float64Array(channels);
  let filled = 0;

  function filter(input: Float32Array, channel: number, from: number, to: number): void {
    const at = channel * 4;
    let s1 = state[at] ?? 0;
    let s2 = state[at + 1] ?? 0;
    let p1 = state[at + 2] ?? 0;
    let p2 = state[at + 3] ?? 0;
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      const x = input[index] ?? 0;
      const u = shelf.b0 * x + s1;
      s1 = shelf.b1 * x - shelf.a1 * u + s2;
      s2 = shelf.b2 * x - shelf.a2 * u;
      const y = pass.b0 * u + p1;
      p1 = pass.b1 * u - pass.a1 * y + p2;
      p2 = pass.b2 * u - pass.a2 * y;
      sum += y * y;
    }
    state[at] = s1;
    state[at + 1] = s2;
    state[at + 2] = p1;
    state[at + 3] = p2;
    sums[channel] = (sums[channel] ?? 0) + sum;
  }

  return {
    push(planes, from = 0, to = planes[0]?.length ?? 0) {
      let at = from;
      while (at < to) {
        const take = Math.min(to - at, blockFrames - filled);
        for (let channel = 0; channel < channels; channel += 1) {
          const input = planes[channel];
          if (input && weights[channel] !== 0) filter(input, channel, at, at + take);
        }
        filled += take;
        at += take;
        if (filled < blockFrames) continue;
        let energy = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          energy += (weights[channel] ?? 0) * (sums[channel] ?? 0);
        }
        sums.fill(0);
        filled = 0;
        onBlock(energy / blockFrames);
      }
    },
    reset() {
      state.fill(0);
      sums.fill(0);
      filled = 0;
    },
  };
}

export interface LoudnessWindow {
  push(energy: number): void;
  clear(): void;
  /** 已有的块数，最多 `SHORT_TERM_BLOCKS`。 */
  readonly size: number;
  /** 最近 4 块的响度；不满 4 块按已有的算，一块都没有给 `null`。 */
  momentary(): number | null;
  /** 最近 30 块的响度，不满同上。 */
  shortTerm(): number | null;
}

/** 实时读数的窗：只留最近 30 块。 */
export function createLoudnessWindow(): LoudnessWindow {
  const ring = new Float64Array(SHORT_TERM_BLOCKS);
  let next = 0;
  let size = 0;
  const meanOfLast = (count: number): number | null => {
    const take = Math.min(count, size);
    if (take === 0) return null;
    let sum = 0;
    for (let back = 1; back <= take; back += 1) {
      sum += ring[(next - back + SHORT_TERM_BLOCKS) % SHORT_TERM_BLOCKS] ?? 0;
    }
    return loudnessOf(sum / take);
  };
  return {
    push(energy) {
      ring[next] = energy;
      next = (next + 1) % SHORT_TERM_BLOCKS;
      size = Math.min(size + 1, SHORT_TERM_BLOCKS);
    },
    clear() {
      next = 0;
      size = 0;
    },
    get size() {
      return size;
    },
    momentary: () => meanOfLast(MOMENTARY_BLOCKS),
    shortTerm: () => meanOfLast(SHORT_TERM_BLOCKS),
  };
}

/** 整首的 Integrated：`blocks` 是按时间顺序的 100 ms 块能量；不够一个 400 ms 块或全被门限挡掉给 `null`。 */
export function integratedLoudness(blocks: ArrayLike<number>): number | null {
  const count = blocks.length - MOMENTARY_BLOCKS + 1;
  if (count <= 0) return null;
  const gating = new Float64Array(count);
  let window = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    window += blocks[index] ?? 0;
    if (index >= MOMENTARY_BLOCKS) window -= blocks[index - MOMENTARY_BLOCKS] ?? 0;
    if (index >= MOMENTARY_BLOCKS - 1)
      gating[index - MOMENTARY_BLOCKS + 1] = window / MOMENTARY_BLOCKS;
  }
  const meanAbove = (threshold: number): number | null => {
    let sum = 0;
    let kept = 0;
    for (const energy of gating) {
      if (energy > threshold) {
        sum += energy;
        kept += 1;
      }
    }
    return kept > 0 ? sum / kept : null;
  };
  const absolute = energyAt(ABSOLUTE_GATE_LUFS);
  const gated = meanAbove(absolute);
  if (gated === null) return null;
  const relative = energyAt((loudnessOf(gated) ?? ABSOLUTE_GATE_LUFS) + RELATIVE_GATE_LU);
  const kept = meanAbove(Math.max(absolute, relative));
  return kept === null ? null : loudnessOf(kept);
}
