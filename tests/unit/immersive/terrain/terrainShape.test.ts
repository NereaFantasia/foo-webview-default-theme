import { expect, test } from 'vitest';
import type { BinsFrame } from '../../../../src/immersive/spectrum/spectrumBins.ts';
import { compressionExponent } from '../../../../src/immersive/terrain/terrainFilters.ts';
import { TERRAIN_CHAIN_POINTS } from '../../../../src/immersive/terrain/terrainHistory.ts';
import {
  axisPositionOf,
  levelOf,
  pointHz,
  shapeTerrainFrame,
  TERRAIN_MAX_HZ,
  tiltDb,
} from '../../../../src/immersive/terrain/terrainShape.ts';

/**
 * 山脊图整形链：电平铺满、幂 2.5 频率轴、高频抬升、从频点取点。
 * 逐点的几步另有单测（`terrainFilters.test.ts`），这里照宿主频点帧的形状造帧，看整条链的结果。
 */
const near = (a: number, b: number, epsilon: number) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

/** 整形链每行输出的点数，与山脊图缓冲用的是同一个常量。 */
const CHAIN_POINTS = TERRAIN_CHAIN_POINTS;

/** 山脊图那份订阅的帧形：44.1 kHz、16384 点，频点间隔约 2.69 Hz，频点 8（约 21.5 Hz）起到 Nyquist 以下。 */
const SAMPLE_RATE = 44100;
const FFT_SIZE = 16384;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;
const FIRST_BIN = Math.ceil(20 / BIN_HZ);
const BIN_COUNT = FFT_SIZE / 2 - FIRST_BIN;

/** 一帧频点：`db(k)` 给频点 k 的 dB 功率。 */
const binsFrame = (db: (bin: number) => number): BinsFrame => ({
  values: Array.from({ length: BIN_COUNT }, (_, index) => db(FIRST_BIN + index)),
  firstBin: FIRST_BIN,
  binHz: BIN_HZ,
  nyquist: SAMPLE_RATE / 2,
});
const SILENT = -160;

/** 按「高出多少」找峰：`out` 里最高的那一点。 */
const peakOf = (out: Float32Array): number => {
  let peak = 0;
  out.forEach((value, index) => {
    if (value > (out[peak] ?? 0)) peak = index;
  });
  return peak;
};

test('levelOf：−100 → 0、−10 → 1、−55 → 0.5，越界夹住', () => {
  expect(levelOf(-100)).toBe(0);
  expect(levelOf(-10)).toBe(1);
  near(levelOf(-55), 0.5, 1e-9);
  expect(levelOf(-130)).toBe(0);
  expect(levelOf(3)).toBe(1);
});

test('pointHz：幂 2.5 轴，首点 20 Hz、中点约 2.84 kHz、末点 16 kHz', () => {
  expect(TERRAIN_MAX_HZ).toBe(16000);
  expect(pointHz(0, 256)).toBe(20);
  near(pointHz(127.5, 256), 20 + 15980 * 0.5 ** 2.5, 1e-6);
  expect(pointHz(255, 256)).toBe(TERRAIN_MAX_HZ);
});

test('tiltDb：1 kHz 及以下不抬，往上每倍频程 3 dB，16 kHz 抬 12 dB', () => {
  expect(tiltDb(100)).toBe(0);
  expect(tiltDb(1000)).toBe(0);
  near(tiltDb(2000), 3, 1e-9);
  near(tiltDb(16000), 12, 1e-9);
});

test('axisPositionOf：pointHz 反过来，每个点的频率回到自己的位置；两端夹住', () => {
  const points = 256;
  for (const index of [0, 1, 7, 64, 128, 200, points - 1]) {
    near(axisPositionOf(pointHz(index, points)), index / (points - 1), 1e-9);
  }
  expect(axisPositionOf(10)).toBe(0);
  expect(axisPositionOf(TERRAIN_MAX_HZ * 2)).toBe(1);
});

test('山脊图每行的点：250 Hz 以下（SUB 与 BASS）分到 71 个', () => {
  const below = Array.from({ length: CHAIN_POINTS }, (_, index) =>
    pointHz(index, CHAIN_POINTS),
  ).filter((hz) => hz < 250);
  expect(below.length).toBe(71);
});

test('shapeTerrainFrame：恒 −20 dB 的帧铺成 0.889、高频按倍频程抬升后再按位置压缩、头部被压低；能量只在 16 kHz 以上的帧整行为零；空帧为零', () => {
  const points = CHAIN_POINTS;
  const last = points - 1;
  const out = new Float32Array(points);
  const scratch = new Float32Array(points);
  shapeTerrainFrame(
    binsFrame(() => -20),
    out,
    scratch,
  );
  // 电平是 (−20 + 抬升 + 100) / 90，封顶 1：中点约 2.86 kHz、抬 4.6 dB；10 kHz 以上抬满 10 dB，顶到 1。
  const levelAt = (index: number) => Math.min(1, (80 + tiltDb(pointHz(index, points))) / 90);
  const low = Math.round(last * 0.16);
  const middle = Math.round(last / 2);
  expect(out[0] ?? 1, '头部衰减').toBeLessThan((out[low] ?? 0) * 0.8);
  near(out[low] ?? -1, levelAt(low) ** compressionExponent(low, points), 0.02);
  near(out[middle] ?? -1, levelAt(middle) ** compressionExponent(middle, points), 0.02);
  near(out[last] ?? -1, 1, 1e-6);
  // 宿主频点不截底：16 kHz 以下全是下限时一个点都抬不起来，没有底垫。
  shapeTerrainFrame(
    binsFrame((bin) => (bin * BIN_HZ > TERRAIN_MAX_HZ ? -20 : SILENT)),
    out,
    scratch,
  );
  expect(out.every((value) => value === 0)).toBe(true);
  shapeTerrainFrame(
    { values: [], firstBin: 0, binHz: BIN_HZ, nyquist: SAMPLE_RATE / 2 },
    out,
    scratch,
  );
  expect(out.every((value) => value === 0)).toBe(true);
});

test('shapeTerrainFrame：点比频点稀的中频取点内频点的最大值，100 Hz 三个频点的窄峰落在 100 Hz 的位置', () => {
  const points = CHAIN_POINTS;
  const last = points - 1;
  const out = new Float32Array(points);
  const center = Math.round(100 / BIN_HZ);
  shapeTerrainFrame(
    binsFrame((bin) => (Math.abs(bin - center) <= 1 ? -20 : SILENT)),
    out,
    new Float32Array(points),
  );
  const peak = peakOf(out);
  near(peak / last, axisPositionOf(center * BIN_HZ), 1.5 / last);
  // 低频按 6 次幂压缩，峰只剩约 0.02；离峰五点以外全是零。
  expect(out[peak] ?? 0, `峰高 ${out[peak]}`).toBeGreaterThan(0.01);
  out.forEach((value, index) => {
    if (Math.abs(index - peak) > 5) expect(value, `第 ${index} 点`).toBe(0);
  });
});

test('shapeTerrainFrame：点比频点密的低频在相邻频点之间插值，单个频点在几个点上连成一个坡', () => {
  const points = CHAIN_POINTS;
  const last = points - 1;
  const out = new Float32Array(points);
  const bin = 12;
  const hz = bin * BIN_HZ;
  // 约 32 Hz：这里相邻两点隔不到一个频点。
  const near32 = Math.round(axisPositionOf(hz) * last);
  expect(pointHz(near32 + 1, points) - pointHz(near32, points)).toBeLessThan(BIN_HZ);
  shapeTerrainFrame(
    binsFrame((index) => (index === bin ? -20 : SILENT)),
    out,
    new Float32Array(points),
  );
  const peak = peakOf(out);
  near(peak / last, axisPositionOf(hz), 1.5 / last);
  expect(out[peak - 1] ?? 0, '峰左侧有坡').toBeGreaterThan(0);
  expect(out[peak + 1] ?? 0, '峰右侧有坡').toBeGreaterThan(0);
  // 离开夹着它的两个频点（约 29.6 与 35 Hz）以外就没有了。
  const beyond = Math.ceil(axisPositionOf((bin + 1) * BIN_HZ) * last) + 3;
  expect(out[beyond]).toBe(0);
});
