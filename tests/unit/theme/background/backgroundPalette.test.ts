import { expect, test } from 'vitest';
import {
  backgroundPalette,
  paintBackgroundPalette,
} from '../../../../src/theme/background/backgroundPalette.ts';
import { profileFromPixels } from '../../../../src/theme/coverPalette.ts';

const base = { argb: 0xff285ac8, hue: 260, chroma: 50, tone: 45 };
test('调色板绘制是确定的全不透明连续场，随时间变化', () => {
  const colors = backgroundPalette(null, base);
  const first = new Uint8ClampedArray(64 * 40 * 4);
  const second = new Uint8ClampedArray(first.length);
  paintBackgroundPalette(first, 64, 40, colors, 0);
  paintBackgroundPalette(second, 64, 40, colors, 0);
  expect(second).toEqual(first);
  expect(first.filter((_, index) => index % 4 === 3).every((value) => value === 255)).toBe(true);
  expect(new Set(first).size).toBeGreaterThan(20);
  paintBackgroundPalette(second, 64, 40, colors, 1);
  expect(second).not.toEqual(first);
});

test('灰图使用自己的主色而不是基础强调色', () => {
  const gray = profileFromPixels(new Uint8ClampedArray([128, 128, 128, 255]));
  const colors = backgroundPalette(gray, base);
  for (let index = 0; index < colors.length; index += 3) {
    expect(Math.abs((colors[index] ?? 0) - (colors[index + 1] ?? 0))).toBeLessThan(5);
    expect(Math.abs((colors[index] ?? 0) - (colors[index + 2] ?? 0))).toBeLessThan(5);
  }
});
