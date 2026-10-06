import { expect, test } from 'vitest';
import {
  audibleLufs,
  dynamicRangeFraction,
  loudnessFraction,
} from '../../../../src/immersive/gauges/loudness.ts';

test('值条：DR 满刻 20，响度从 −40 到 0 LUFS，越界夹住', () => {
  expect(dynamicRangeFraction(10)).toBe(0.5);
  expect(dynamicRangeFraction(25)).toBe(1);
  expect(dynamicRangeFraction(-1)).toBe(0);
  expect(loudnessFraction(-20)).toBe(0.5);
  expect(loudnessFraction(3)).toBe(1);
  expect(loudnessFraction(-50)).toBe(0);
});

test('不高于 −70 LUFS 的响度与静音都按没有值写', () => {
  expect(audibleLufs(-9.5)).toBe(-9.5);
  expect(audibleLufs(-69.9)).toBe(-69.9);
  expect(audibleLufs(-70)).toBe(null);
  expect(audibleLufs(null)).toBe(null);
});
