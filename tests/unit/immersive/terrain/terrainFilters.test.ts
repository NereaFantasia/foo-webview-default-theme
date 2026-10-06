import { expect, test } from 'vitest';
import {
  boxSmooth,
  compressionExponent,
  headTaper,
  peakAverage,
  TERRAIN_EXPONENT_HIGH,
  TERRAIN_EXPONENT_LOW,
} from '../../../../src/immersive/terrain/terrainFilters.ts';

const near = (a: number, b: number, epsilon: number) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

test('boxSmooth：脉冲摊成 9 点，内部一遍总量不变，三遍更宽；边上用端点补，常数不变', () => {
  const values = new Float32Array(32);
  const scratch = new Float32Array(32);
  values[16] = 9;
  boxSmooth(values, 9, 1, scratch);
  for (let index = 12; index <= 20; index += 1) near(values[index] ?? -1, 1, 1e-6);
  expect(values[11]).toBe(0);
  expect(values[21]).toBe(0);
  near(
    values.reduce((sum, value) => sum + value, 0),
    9,
    1e-5,
  );
  boxSmooth(values, 9, 2, scratch);
  // 再两遍：中间降、更远的点起来。
  expect(values[16] ?? 0).toBeLessThan(1);
  expect(values[24] ?? 0).toBeGreaterThan(0);
  const flat = new Float32Array(16).fill(0.4);
  boxSmooth(flat, 9, 3, scratch);
  for (const value of flat) near(value, 0.4, 1e-6);
  const untouched = new Float32Array([1, 2, 3]);
  boxSmooth(untouched, 1, 3, scratch);
  expect([...untouched]).toStrictEqual([1, 2, 3]);
});

test('peakAverage：孤峰原样留、两侧邻点抬到 7/12、末点与前一点平均；恒定行不变', () => {
  const values = new Float32Array([0, 0, 1, 0, 0]);
  const scratch = new Float32Array(5);
  peakAverage(values, scratch);
  near(values[0] ?? -1, 0, 1e-6);
  near(values[1] ?? -1, 7 / 12, 1e-6);
  near(values[2] ?? -1, 1, 1e-6);
  near(values[3] ?? -1, 7 / 12, 1e-6);
  near(values[4] ?? -1, 0.25, 1e-6);
  const flat = new Float32Array(8).fill(0.3);
  peakAverage(flat, new Float32Array(8));
  for (const value of flat) near(value, 0.3, 1e-6);
});

test('headTaper：首点乘 0.713，第 7 点恰回到 1，之后不动', () => {
  const values = new Float32Array(10).fill(1);
  headTaper(values);
  near(values[0] ?? -1, 0.7133, 1e-3);
  expect(values[3] ?? 0).toBeGreaterThan(values[0] ?? 1);
  expect(values[3] ?? 1).toBeLessThan(1);
  near(values[6] ?? -1, 1, 1e-3);
  expect(values[7]).toBe(1);
  expect(values[9]).toBe(1);
});

test('compressionExponent：起点 6、中点 5.25、末点趴近 3', () => {
  expect(compressionExponent(0, 256)).toBe(TERRAIN_EXPONENT_LOW);
  near(compressionExponent(128, 256), 5.25, 1e-9);
  near(compressionExponent(255, 256), TERRAIN_EXPONENT_HIGH, 0.03);
});
