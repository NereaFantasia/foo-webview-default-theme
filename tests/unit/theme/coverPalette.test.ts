import { argbFromRgb, Hct } from '@material/material-color-utilities';
import { expect, test } from 'vitest';
import { isCoverProfile, profileFromPixels } from '../../../src/theme/coverPalette.ts';

const solid = (r: number, g: number, b: number, count: number, alpha = 255) =>
  Array.from({ length: count }, () => [r, g, b, alpha]).flat();
const pixels = (...parts: number[][]) => new Uint8ClampedArray(parts.flat());

test('灰图保留主色与明度；透明图没有主色和明度', () => {
  const gray = profileFromPixels(pixels(solid(128, 128, 128, 100)));
  expect(gray.accent).toBeNull();
  expect(gray.dominant?.argb).toBe(argbFromRgb(128, 128, 128));
  expect(gray.gray).toBe(true);
  expect(gray.lightness?.mean).toBeCloseTo(Hct.fromInt(argbFromRgb(128, 128, 128)).tone);
  expect(isCoverProfile(gray)).toBe(true);
  const empty = profileFromPixels(pixels(solid(255, 0, 0, 100, 127)));
  expect(empty.pixelCount).toBe(0);
  expect(empty.dominant).toBeNull();
  expect(empty.lightness).toBeNull();
  expect(isCoverProfile(empty)).toBe(true);
});

test('强色面积不足不是灰图，主色仍按面积而非 Score 排名', () => {
  const profile = profileFromPixels(pixels(solid(128, 128, 128, 98), solid(255, 0, 0, 2)));
  expect(profile.accent).toBeNull();
  expect(profile.gray).toBe(false);
  expect(profile.dominant?.argb).toBe(argbFromRgb(128, 128, 128));
  expect(profile.secondary).toEqual([]);
});

test('辅色来自不同色相候选，明度按原像素面积统计', () => {
  const profile = profileFromPixels(
    pixels(solid(255, 0, 0, 40), solid(0, 255, 0, 30), solid(0, 0, 255, 30)),
  );
  expect(profile.accent).not.toBeNull();
  expect(profile.secondary.length).toBeGreaterThan(0);
  const tones = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ].map(([r, g, b]) => Hct.fromInt(argbFromRgb(r, g, b)).tone);
  expect(profile.lightness?.mean).toBeCloseTo(tones[0] * 0.4 + tones[1] * 0.3 + tones[2] * 0.3);
  for (const color of profile.secondary) {
    const delta = Math.abs(color.hue - (profile.accent?.hue ?? 0));
    expect(Math.min(delta, 360 - delta)).toBeGreaterThanOrEqual(15);
  }
  expect(isCoverProfile(profile)).toBe(true);
});

test('不完整、非有限数值和不合法统计不能作为档案', () => {
  const profile = profileFromPixels(pixels(solid(255, 0, 0, 10)));
  expect(isCoverProfile(null)).toBe(false);
  expect(isCoverProfile({ hue: 20, chroma: 40 })).toBe(false);
  expect(isCoverProfile({ ...profile, pixelCount: -1 })).toBe(false);
  expect(isCoverProfile({ ...profile, lightness: { min: 0, max: 100, mean: NaN } })).toBe(false);
  expect(isCoverProfile({ ...profile, accent: { ...profile.accent, chroma: Infinity } })).toBe(
    false,
  );
});
