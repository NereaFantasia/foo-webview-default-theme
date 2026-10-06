import { expect, test } from 'vitest';
import {
  blurSource,
  CONTROL_MOTION,
  controlOffsets,
  coverUv,
  GRID,
  keys,
  rotationAt,
  ROTATION_PERIOD,
  sampleCover,
  shade,
  warp,
  ZOOM,
} from '../../../../src/immersive/wash/coverWarp.ts';

const near = (a: number, b: number, epsilon = 1e-9) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

/** 旋转放大之后正好落在网格坐标 `g` 上的纹理坐标（不旋转时）。 */
const onGrid = (g: number) => 0.5 + (g / (GRID - 1) - 0.5) / ZOOM;

test('keys：整数点上为 1 / 0，支撑宽 2，左右对称', () => {
  near(keys(0), 1);
  near(keys(1), 0);
  near(keys(-1), 0);
  near(keys(2), 0);
  near(keys(2.5), 0);
  near(keys(0.3), keys(-0.3));
});

test('warp：位移全部相同时整幅平移同样的量，边角也一样（夹边后权重和为 1）', () => {
  const offsets = new Float32Array(GRID * GRID * 2);
  for (let index = 0; index < GRID * GRID; index += 1) offsets.set([0.05, -0.02], index * 2);
  for (const [u, v] of [
    [0.5, 0.5],
    [onGrid(0), onGrid(0)],
    [onGrid(0.4), onGrid(2.7)],
    [onGrid(3), onGrid(1.5)],
  ] as const) {
    const [wu, wv] = warp(u, v, offsets, 0);
    near(wu, 0.5 + (u - 0.5) * ZOOM + 0.05, 1e-6);
    near(wv, 0.5 + (v - 0.5) * ZOOM - 0.02, 1e-6);
  }
});

test('warp：插值穿过控制点——只有一个点有位移时，正落在该点上位移等于它、落在别的点上为 0', () => {
  const offsets = new Float32Array(GRID * GRID * 2);
  const node = 1 * GRID + 2;
  offsets.set([0.1, 0.07], node * 2);
  const [atU, atV] = warp(onGrid(2), onGrid(1), offsets, 0);
  near(atU - 2 / 3, 0.1, 1e-6);
  near(atV - 1 / 3, 0.07, 1e-6);
  const [otherU, otherV] = warp(onGrid(1), onGrid(1), offsets, 0);
  near(otherU, 1 / 3, 1e-6);
  near(otherV, 1 / 3, 1e-6);
});

test('warp：绕中心旋转并放大；rotationAt 按周期转满一圈', () => {
  const still = new Float32Array(GRID * GRID * 2);
  const [u, v] = warp(0.7, 0.5, still, Math.PI / 2);
  near(u, 0.5, 1e-9);
  near(v, 0.5 + 0.2 * ZOOM, 1e-9);
  near(rotationAt(0), 0);
  near(rotationAt(ROTATION_PERIOD), 2 * Math.PI);
});

test('controlOffsets：同一时刻结果相同；幅度不超出设定上限；单个点按自己的周期回到原位', () => {
  expect(CONTROL_MOTION.length).toBe(GRID * GRID);
  expect(controlOffsets(12.5)).toStrictEqual(controlOffsets(12.5));
  for (const value of controlOffsets(7.3)) expect(Math.abs(value)).toBeLessThanOrEqual(0.24 + 1e-9);
  const [point] = CONTROL_MOTION;
  if (!point) throw new Error('CONTROL_MOTION 为空');
  const start = controlOffsets(3, [point]);
  near(controlOffsets(3 + point.px, [point])[0] ?? NaN, start[0] ?? NaN, 1e-6);
  near(controlOffsets(3 + point.py, [point])[1] ?? NaN, start[1] ?? NaN, 1e-6);
});

test('coverUv：长边对满封面、短边居中', () => {
  expect(coverUv(0, 50, 200, 100)).toStrictEqual([0, 0.5]);
  expect(coverUv(200, 50, 200, 100)).toStrictEqual([1, 0.5]);
  expect(coverUv(100, 0, 200, 100)).toStrictEqual([0.5, 0.25]);
});

function image(size: number, fill: (x: number, y: number) => number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const value = fill(x, y);
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  return pixels;
}

test('sampleCover：像素中心取原值、两中心之间取平均、越界按镜像取', () => {
  const pixels = image(4, (x) => x * 40);
  near(sampleCover(pixels, 4, 0.375, 0.5)[0], 40);
  near(sampleCover(pixels, 4, 0.5, 0.5)[0], 60);
  expect(sampleCover(pixels, 4, -0.125, 0.5)).toStrictEqual(sampleCover(pixels, 4, 0.125, 0.5));
  expect(sampleCover(pixels, 4, 1.125, 0.5)).toStrictEqual(sampleCover(pixels, 4, 0.875, 0.5));
});

test('blurSource：纯色不变；中间一个亮点被摊开、总量基本守恒', () => {
  const flat = blurSource(
    image(16, () => 90),
    16,
    2,
  );
  for (let at = 0; at < flat.length; at += 4) expect(flat[at]).toBe(90);
  const spot = blurSource(
    image(32, (x, y) => (x === 16 && y === 16 ? 255 : 0)),
    32,
    1,
  );
  let total = 0;
  for (let at = 0; at < spot.length; at += 4) total += spot[at] ?? 0;
  expect(spot[(16 * 32 + 16) * 4] ?? 0).toBeLessThan(255);
  expect(Math.abs(total - 255), `total ${total}`).toBeLessThan(40);
});

test('shade：比例 0 是纸面色，比例 1 且饱和度 1 是原色，饱和度 0 变灰', () => {
  const paper = [0.2, 0.2, 0.2] as const;
  const encoded = (linear: number) => 1.055 * linear ** (1 / 2.4) - 0.055;
  shade([200, 40, 90], paper, 0).forEach((channel) => near(channel, encoded(0.2), 1e-9));
  const original = shade([200, 40, 90], paper, 1, 1);
  near(original[0], 200 / 255, 1e-9);
  near(original[1], 40 / 255, 1e-9);
  near(original[2], 90 / 255, 1e-9);
  const gray = shade([200, 40, 90], paper, 1, 0);
  near(gray[0], gray[1], 1e-9);
  near(gray[1], gray[2], 1e-9);
});
