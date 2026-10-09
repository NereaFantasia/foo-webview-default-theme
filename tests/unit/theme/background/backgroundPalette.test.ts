import { expect, test } from 'vitest';
import { argbFromRgb, Hct } from '@material/material-color-utilities';
import {
  backgroundPalette,
  paintBackgroundPalette,
} from '../../../../src/theme/background/backgroundPalette.ts';
import { profileFromPixels } from '../../../../src/theme/coverPalette.ts';

const base = { argb: 0xff285ac8, hue: 260, chroma: 50, tone: 45 };
test('调色板绘制是确定的全不透明连续场，随时间变化', () => {
  const colors = backgroundPalette(null, base, 'dark');
  const first = new Uint8ClampedArray(64 * 40 * 4);
  const second = new Uint8ClampedArray(first.length);
  paintBackgroundPalette(first, 64, 40, colors, 0);
  paintBackgroundPalette(second, 64, 40, colors, 0);
  expect(second).toEqual(first);
  expect(first.filter((_, index) => index % 4 === 3).every((value) => value === 255)).toBe(true);
  const distinct = new Set(
    Array.from({ length: first.length / 4 }, (_, index) =>
      first.slice(index * 4, index * 4 + 3).join(','),
    ),
  );
  expect(distinct.size).toBeGreaterThan(4);
  paintBackgroundPalette(second, 64, 40, colors, 1);
  expect(second).not.toEqual(first);
});

test('灰图使用自己的主色而不是基础强调色', () => {
  const gray = profileFromPixels(new Uint8ClampedArray([128, 128, 128, 255]));
  const colors = backgroundPalette(gray, base, 'dark');
  for (let index = 0; index < colors.length; index += 3) {
    expect(Math.abs((colors[index] ?? 0) - (colors[index + 1] ?? 0))).toBeLessThan(5);
    expect(Math.abs((colors[index] ?? 0) - (colors[index + 2] ?? 0))).toBeLessThan(5);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} 亮、暗与高彩度封面的背景保持在同一明度范围`, () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]) {
      const profile = profileFromPixels(new Uint8ClampedArray([...rgb, 255]));
      const colors = backgroundPalette(profile, base, scheme);
      const pixels = new Uint8ClampedArray(64 * 40 * 4);
      paintBackgroundPalette(pixels, 64, 40, colors, 2.4);
      for (let at = 0; at < pixels.length; at += 4) {
        const color = Hct.fromInt(argbFromRgb(pixels[at], pixels[at + 1], pixels[at + 2]));
        expect(color.tone).toBeGreaterThanOrEqual(scheme === 'dark' ? 7.5 : 92.5);
        expect(color.tone).toBeLessThanOrEqual(scheme === 'dark' ? 16.5 : 97.5);
      }
    }
  });

  test(`${scheme} 小面积鲜艳色不会占满一个角，旧档案不借用强调色辅色`, () => {
    const makeProfile = (red: number) =>
      profileFromPixels(
        Uint8ClampedArray.from(
          Array.from({ length: 100 }, (_, index) =>
            index < red ? [255, 0, 0, 255] : [128, 128, 128, 255],
          ).flat(),
        ),
      );
    const small = makeProfile(5);
    const large = makeProfile(40);
    const chroma = (colors: readonly number[]) =>
      Hct.fromInt(argbFromRgb(Math.round(colors[3]), Math.round(colors[4]), Math.round(colors[5])))
        .chroma;
    expect(chroma(backgroundPalette(small, base, scheme))).toBeLessThan(
      chroma(backgroundPalette(large, base, scheme)) / 2,
    );
    const { palette, ...legacy } = small;
    expect(palette?.[1].population).toBe(5);
    const colors = backgroundPalette(legacy, base, scheme);
    for (let at = 0; at < colors.length; at += 3) {
      expect(
        Math.max(...colors.slice(at, at + 3)) - Math.min(...colors.slice(at, at + 3)),
      ).toBeLessThan(5);
    }
  });
}
