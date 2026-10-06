import { expect, test } from 'vitest';
import {
  BARS_DB_CEIL,
  BARS_DB_FLOOR,
  BAR_GAP,
  PEAK_FALL_PER_S,
  PEAK_HOLD_MS,
  RELEASE_PER_30HZ,
  SPECTRUM_BARS,
  attackFor,
  barWidth,
  groupBands,
  levelOfDb,
  levelsOfDb,
  releaseFor,
  settleBars,
  settlePeaks,
} from '../../../../src/immersive/spectrum/spectrumBars.ts';

/** 图纸频谱柱的数值部分：dB 换柱高、并带、下落平滑、柱宽。 */
const close = (actual: number, expected: number, tolerance = 1e-6) =>
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThanOrEqual(tolerance);

test('dB 换柱高：下限到上限线性铺满，之外夹到 0 与 1；整帧逐带换', () => {
  expect(levelOfDb(BARS_DB_FLOOR)).toBe(0);
  expect(levelOfDb(BARS_DB_CEIL)).toBe(1);
  close(levelOfDb((BARS_DB_FLOOR + BARS_DB_CEIL) / 2), 0.5);
  expect(levelOfDb(BARS_DB_FLOOR - 30)).toBe(0);
  expect(levelOfDb(0)).toBe(1);
  expect(levelOfDb(Number.NEGATIVE_INFINITY)).toBe(0);
  expect([...levelsOfDb([BARS_DB_FLOOR, BARS_DB_CEIL])]).toStrictEqual([0, 1]);
});

test('并带：1024 带并成 200 根，每根取所含带的最大值；五到六个带一根，首尾都覆盖到', () => {
  const frame = Array.from({ length: 1024 }, (_, index) => index);
  const out = new Float32Array(SPECTRUM_BARS);
  groupBands(frame, out);
  // 第 0 根取带 0…4（floor(1024/200) = 5），最大 4；最后一根取带 1018…1023，最大 1023。
  close(out[0] ?? Number.NaN, 4);
  close(out[SPECTRUM_BARS - 1] ?? Number.NaN, 1023);
  for (let bar = 1; bar < SPECTRUM_BARS; bar += 1) {
    expect(out[bar] ?? 0, `第 ${bar} 根没有单调上升`).toBeGreaterThan(out[bar - 1] ?? 0);
  }
});

test('并带取最大值：一带的窄峰在它那根柱里原样留下，不被同一根里的谷拉低', () => {
  const frame = new Array(1024).fill(0.2);
  frame[512] = 0.9;
  const out = new Float32Array(SPECTRUM_BARS);
  groupBands(frame, out);
  // 带 512 落在第 100 根（覆盖带 512…516）。
  close(out[100] ?? Number.NaN, 0.9);
  close(out[99] ?? Number.NaN, 0.2);
  close(out[101] ?? Number.NaN, 0.2);
});

test('并带：恒定帧并出来仍恒定；带比柱少时每根至少取一个带；空帧全零', () => {
  const out = new Float32Array(SPECTRUM_BARS);
  groupBands(new Array(1024).fill(0.4), out);
  for (const value of out) close(value, 0.4);
  const few = new Float32Array(8);
  groupBands([0.1, 0.9], few);
  expect([...few].map((value) => Math.round(value * 10))).toStrictEqual([1, 1, 1, 1, 9, 9, 9, 9]);
  out.fill(0.7);
  groupBands([], out);
  expect(out.every((value) => value === 0)).toBe(true);
});

test('下落平滑按时间折算：1/30 s 留一个系数，两倍时长留平方；非正时长不衰减', () => {
  close(releaseFor(1000 / 30), RELEASE_PER_30HZ);
  close(releaseFor(2000 / 30), RELEASE_PER_30HZ ** 2);
  expect(releaseFor(0)).toBe(1);
  expect(releaseFor(-5)).toBe(1);
});

test('起音瞬到、回落按比例衰减且不低于目标；到了目标报停', () => {
  const levels = new Float32Array([0.2, 0.8, 0.5]);
  const target = new Float32Array([0.6, 0.1, 0.5]);
  const moving = settleBars(levels, target, 0.5);
  close(levels[0] ?? Number.NaN, 0.6);
  close(levels[1] ?? Number.NaN, 0.4);
  close(levels[2] ?? Number.NaN, 0.5);
  expect(moving).toBe(true);
  settleBars(levels, target, 0.5);
  settleBars(levels, target, 0.5);
  close(levels[1] ?? Number.NaN, 0.1);
  expect(settleBars(levels, target, 0.5)).toBe(false);
});

test('断点后起音缓着：每一刻补上差距的一部分，回落照旧；缓的时长末约补上 95%', () => {
  const levels = new Float32Array([0.2, 0.8]);
  const target = new Float32Array([1, 0.4]);
  expect(settleBars(levels, target, 0.5, 0.25)).toBe(true);
  close(levels[0] ?? Number.NaN, 0.4);
  close(levels[1] ?? Number.NaN, 0.4);
  close(attackFor(200, 200), 1 - Math.exp(-3));
  expect(attackFor(0, 200)).toBe(0);
  expect(attackFor(16, 0)).toBe(1);
  const steps = new Float32Array([0]);
  for (let step = 0; step < 12; step += 1) {
    settleBars(steps, new Float32Array([1]), 0.5, attackFor(1000 / 60, 200));
  }
  close(steps[0] ?? Number.NaN, 1 - Math.exp(-3), 1e-3);
});

test('减弱动效（留 0）直接跟随：连续两帧柱高就是帧值', () => {
  const levels = new Float32Array([0.9, 0.9]);
  expect(settleBars(levels, new Float32Array([0.3, 0.1]), 0)).toBe(false);
  expect([...levels].map((value) => Math.round(value * 10))).toStrictEqual([3, 1]);
});

test('峰值点：柱冲上来即跟上并重新计时，停够保持时长才按匀速落，落到柱高为止；报还有没有点高于柱', () => {
  const peaks = new Float32Array(2);
  const held = new Float64Array(2);
  const levels = new Float32Array([0.8, 0.4]);
  expect(settlePeaks(peaks, held, levels, 0, 16)).toBe(false);
  expect([...peaks].map((value) => Math.round(value * 10))).toStrictEqual([8, 4]);
  levels.set([0.2, 0.6]);
  // 第 0 根柱落下去了，点还在保持；第 1 根柱更高，点跟上。
  expect(settlePeaks(peaks, held, levels, PEAK_HOLD_MS - 1, 16)).toBe(true);
  close(peaks[0] ?? Number.NaN, 0.8);
  close(peaks[1] ?? Number.NaN, 0.6);
  // 保持期满后每 100 ms 落 PEAK_FALL_PER_S / 10。
  settlePeaks(peaks, held, levels, PEAK_HOLD_MS + 100, 100);
  close(peaks[0] ?? Number.NaN, 0.8 - PEAK_FALL_PER_S / 10, 1e-5);
  // 落到柱高为止，不再动。
  settlePeaks(peaks, held, levels, PEAK_HOLD_MS + 10_000, 10_000);
  close(peaks[0] ?? Number.NaN, 0.2, 1e-6);
  expect(settlePeaks(peaks, held, levels, PEAK_HOLD_MS + 20_000, 16)).toBe(false);
});

test('柱宽：600 宽 200 根空 1 px 约 2 px；200 根加 199 条空隙正好铺满', () => {
  const bar = barWidth(600);
  close(bar, (600 - 199) / 200);
  close(bar * SPECTRUM_BARS + BAR_GAP * (SPECTRUM_BARS - 1), 600);
  expect(barWidth(150)).toBe(0);
});
