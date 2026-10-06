import { expect, test } from 'vitest';
import { GRAIN_ALPHA, grainPixels } from '../../../../src/immersive/wash/ditherGrain.ts';

test('grainPixels：灰度像素、透明度统一；同一种子生成同一张，换种子不同', () => {
  const pixels = grainPixels(64);
  expect(pixels.length).toBe(64 * 64 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    expect(pixels[offset + 1]).toBe(pixels[offset]);
    expect(pixels[offset + 2]).toBe(pixels[offset]);
    expect(pixels[offset + 3]).toBe(GRAIN_ALPHA);
  }
  expect(grainPixels(64)).toStrictEqual(pixels);
  expect(grainPixels(64, GRAIN_ALPHA, 2)).not.toStrictEqual(pixels);
});

test('grainPixels：灰度大致均匀铺满 0–255，没有偏向一端', () => {
  const pixels = grainPixels(256);
  let sum = 0;
  let min = 255;
  let max = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const gray = pixels[offset] ?? 0;
    sum += gray;
    min = Math.min(min, gray);
    max = Math.max(max, gray);
  }
  const mean = sum / (pixels.length / 4);
  expect(Math.abs(mean - 127.5), `mean ${mean}`).toBeLessThan(2);
  expect(min).toBe(0);
  expect(max).toBe(255);
});
