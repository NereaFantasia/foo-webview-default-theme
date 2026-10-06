import { argbFromHex, Hct } from '@material/material-color-utilities';
import { expect, test } from 'vitest';
import { tealBrand } from '../../../src/theme/brand.ts';
import { rampFrom } from '../../../src/theme/brandRamp.ts';

const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
const parse = (value: string) => Hct.fromInt(argbFromHex(value));

test.each([29, 110, 190, 264, 320])('色相 %s 的 16 档保持青绿明度阶梯且落在 sRGB 内', (hue) => {
  const ramp = rampFrom({ hue, chroma: 48 });
  expect(Object.keys(ramp)).toEqual(Object.keys(tealBrand));
  let previous = -1;
  for (const step of STEPS) {
    expect(ramp[step]).toMatch(/^#[\da-f]{6}$/);
    const tone = parse(ramp[step]).tone;
    expect(Math.abs(tone - parse(tealBrand[step]).tone)).toBeLessThan(0.3);
    expect(tone).toBeGreaterThan(previous);
    previous = tone;
  }
});

test('低彩度不被强行提升', () => {
  const vivid = rampFrom({ hue: 264, chroma: 48 });
  const dull = rampFrom({ hue: 264, chroma: 8 });
  expect(parse(vivid[100]).chroma).toBeGreaterThan(parse(dull[100]).chroma * 2);
  expect(parse(dull[100]).chroma).toBeLessThan(9);
});

test('输出稳定且不改变固定青绿', () => {
  const before = { ...tealBrand };
  const seed = { hue: 30, chroma: 40 };
  expect(rampFrom(seed)).not.toBe(tealBrand);
  expect(rampFrom(seed)).toEqual(rampFrom(seed));
  expect(tealBrand).toEqual(before);
});
