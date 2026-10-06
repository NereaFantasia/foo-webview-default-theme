import { expect, test } from 'vitest';
import { axisFraction, barAxisFor } from '../../../../src/immersive/spectrum/barAxis.ts';

const near = (a: number, b: number, epsilon: number) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

const RATE = 44100;
const FFT = 8192;
const BIN_HZ = RATE / FFT;

test('barAxisFor：8192 点、44.1 kHz 铺 200 根，约 190 Hz 以下一个频点一根柱，其后按对数；两端是 20 Hz 与 Nyquist', () => {
  const axis = barAxisFor(RATE, FFT, 200, 20);
  const { edges, binBars } = axis;
  expect(edges.length).toBe(201);
  expect(edges[0]).toBe(20);
  expect(edges[200]).toBe(RATE / 2);
  expect(binBars).toBe(32);
  near(edges[binBars] ?? 0, 191, 1);
  for (let bar = 0; bar < 200; bar += 1) {
    expect(edges[bar + 1] ?? 0).toBeGreaterThan(edges[bar] ?? 0);
  }
  // 线性段：第 0 根从 20 Hz 起，其余每根宽一个频点间隔，每根柱里恰好一个频点。
  for (let bar = 0; bar < binBars; bar += 1) {
    const low = edges[bar] ?? 0;
    const high = edges[bar + 1] ?? 0;
    if (bar > 0) near(high - low, BIN_HZ, 1e-9);
    expect(Math.ceil(high / BIN_HZ) - Math.ceil(low / BIN_HZ), `第 ${bar} 根`).toBe(1);
  }
  // 对数段：相邻边界之比处处相同，第一根也不窄于一个频点。
  const ratio = (edges[binBars + 1] ?? 0) / (edges[binBars] ?? 1);
  for (let bar = binBars; bar < 200; bar += 1) {
    near((edges[bar + 1] ?? 0) / (edges[bar] ?? 1), ratio, 1e-9);
  }
  expect((edges[binBars + 1] ?? 0) - (edges[binBars] ?? 0)).toBeGreaterThanOrEqual(BIN_HZ);
});

test('barAxisFor：线性段取最短的那种——少一根线性柱，对数段的第一根就窄过一个频点', () => {
  const { edges, binBars } = barAxisFor(RATE, FFT, 200, 20);
  const split = edges[binBars - 1] ?? 0;
  const width = split * ((RATE / 2 / split) ** (1 / (200 - binBars + 1)) - 1);
  expect(width, `${width}`).toBeLessThan(BIN_HZ);
});

test('barAxisFor：点数够大、20 Hz 处一根柱已不窄于一个频点时没有线性段，整条轴按对数', () => {
  const axis = barAxisFor(RATE, 65536, 200, 20);
  expect(axis.binBars).toBe(0);
  const ratio = (RATE / 2 / 20) ** (1 / 200);
  near(axis.edges[1] ?? 0, 20 * ratio, 1e-9);
});

test('axisFraction：边界落在 i / 柱数，线性段按频率插、对数段按对数插；两端夹住', () => {
  const axis = barAxisFor(RATE, FFT, 200, 20);
  const { edges, binBars } = axis;
  for (const bar of [0, 5, binBars, 150, 200])
    near(axisFraction(axis, edges[bar] ?? 0), bar / 200, 1e-9);
  const low = edges[5] ?? 0;
  const high = edges[6] ?? 0;
  near(axisFraction(axis, (low + high) / 2), 5.5 / 200, 1e-9);
  const logLow = edges[150] ?? 0;
  const logHigh = edges[151] ?? 0;
  near(axisFraction(axis, Math.sqrt(logLow * logHigh)), 150.5 / 200, 1e-9);
  expect(axisFraction(axis, 10)).toBe(0);
  expect(axisFraction(axis, RATE)).toBe(1);
  expect(axisFraction(axis, Number.NaN)).toBe(0);
});
