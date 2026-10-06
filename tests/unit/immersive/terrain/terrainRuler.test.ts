import { expect, test } from 'vitest';
import {
  rulerSegments,
  rulerTicks,
  TERRAIN_NAMED_BANDS,
} from '../../../../src/immersive/terrain/terrainRuler.ts';

/**
 * 山脊图底边的频段标尺：各段按山脊图自己的幂 2.5 轴落位，首段从左缘起、末段到右缘止、首尾相接；
 * 分界刻度只画在段与段之间。60 / 250 / 500 / 2000 / 6000 Hz 在 20 Hz…16 kHz 的幂 2.5 轴上约在
 * 9.1% / 18.3% / 24.6% / 43.4% / 67.5%。
 */
const near = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThanOrEqual(tolerance);

test('rulerSegments：六段 SUB / BASS / LOW-MID / MID / HIGH-MID / HIGH 铺满全宽、首尾相接', () => {
  const segments = rulerSegments();
  expect(segments.map((segment) => segment.label)).toStrictEqual(
    TERRAIN_NAMED_BANDS.map((band) => band.label),
  );
  expect(segments[0]?.left).toBe(0);
  const last = segments.at(-1);
  near((last?.left ?? 0) + (last?.width ?? 0), 1, 1e-9);
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    near(segments[index]?.left ?? -1, (previous?.left ?? 0) + (previous?.width ?? 0), 1e-9);
  }
});

test('rulerTicks：只在段与段之间，五处分界落在 9.1% / 18.3% / 24.6% / 43.4% / 67.5%', () => {
  const ticks = rulerTicks();
  expect(ticks.length).toBe(TERRAIN_NAMED_BANDS.length - 1);
  [0.0911, 0.1833, 0.2461, 0.4337, 0.6749].forEach((expected, index) =>
    near(ticks[index] ?? -1, expected, 1e-3),
  );
});
