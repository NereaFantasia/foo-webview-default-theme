import { expect, test } from 'vitest';
import {
  ONSET_HOP,
  accumulateEnergies,
  createEnergies,
  onsetStrength,
} from '../../../../src/immersive/tempo/onsetEnvelope.ts';
import type { BandSignals } from '../../../../src/immersive/waveform/waveformBands.ts';

/** 起音曲线：帧按曲目时间对齐、各段只写自己的帧，能量跳升处出尖峰，按均方根归一。 */
const RATE = 1024;
const signalsOf = (low: Float32Array, mid = low, high = low): BandSignals => ({
  low,
  mid,
  high,
  weighted: low,
});

test('帧数按时长与帧长向上取整；时长不可用时不建', () => {
  expect(createEnergies(1, RATE)?.low.length).toBe(RATE / ONSET_HOP);
  expect(createEnergies(1.1, RATE)?.low.length).toBe(Math.ceil((1.1 * RATE) / ONSET_HOP));
  expect(createEnergies(0, RATE)).toBe(null);
});

test('按曲目时间落帧：这段只写起点在它范围里的帧，样本起点有偏移、采样率不同也对得上', () => {
  const energies = createEnergies(4, RATE);
  if (!energies) throw new Error('没建出能量表');
  energies.low.fill(-1);
  // 这段样本从 0.75 s 起、采样率是帧用的两倍，负责 1–2 s：只写第 4…7 帧（每帧 0.25 s）。
  const samples = new Float32Array(2 * RATE * 2).fill(0.5);
  accumulateEnergies(signalsOf(samples), 2 * RATE, 0.75, 1, 2, energies);
  expect(Array.from(energies.low.subarray(3, 9))).toStrictEqual([-1, 0.25, 0.25, 0.25, 0.25, -1]);
});

test('起音强度：能量跳升的那一帧出尖峰，平稳处为 0，按均方根归一', () => {
  const energies = createEnergies(8, RATE);
  if (!energies) throw new Error('没建出能量表');
  const frames = energies.low.length;
  for (const key of ['low', 'mid', 'high'] as const) {
    energies[key].fill(1e-6);
    for (let frame = 16; frame < frames; frame += 1) energies[key][frame] = 1e-2;
  }
  const onset = onsetStrength(energies);
  const peak = onset.indexOf(Math.max(...onset));
  expect(peak).toBe(16);
  expect(onset[2]).toBe(0);
  expect(onset[frames - 3]).toBe(0);
  const rms = Math.sqrt(onset.reduce((sum, value) => sum + value * value, 0) / frames);
  expect(Math.abs(rms - 1), String(rms)).toBeLessThan(1e-6);
});
