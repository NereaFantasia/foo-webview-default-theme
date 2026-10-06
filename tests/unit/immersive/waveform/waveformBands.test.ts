import { expect, test } from 'vitest';
import {
  LOW_MID_HZ,
  MID_HIGH_HZ,
  bandStages,
  qToDb,
  type FilterStage,
} from '../../../../src/immersive/waveform/waveformBands.ts';

/**
 * 分频里不依赖 Web Audio 的部分：Q 的分贝换算、四条链的滤波节。按段、按窗求 RMS 在 `segmentedBands.test.ts`；
 * `renderBands` 本身要 OfflineAudioContext，Node 里没有，这里不测。
 */
const near = (actual: number, expected: number, tolerance = 1e-6) =>
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThan(tolerance);

/** 模拟域二阶高通在角频率 ω 处的幅度。 */
function highpassMagnitude(stage: FilterStage, hz: number): number {
  const w = 2 * Math.PI * hz;
  const w0 = 2 * Math.PI * stage.frequency;
  return (w * w) / Math.hypot(w0 * w0 - w * w, (w * w0) / stage.q);
}

test('Q 换成 Web Audio 读的分贝：Butterworth 0.707 是 −3.01 dB', () => {
  near(qToDb(Math.SQRT1_2), -3.0103, 1e-4);
  near(qToDb(1), 0);
  near(qToDb(0.5), -6.0206, 1e-4);
});

test('三段分频：两节 Butterworth 串成四阶，分界 250 Hz 与 4 kHz', () => {
  const stages = bandStages(22050);
  const butterworth = (type: FilterStage['type'], frequency: number): FilterStage => ({
    type,
    frequency,
    q: Math.SQRT1_2,
  });
  expect(stages.low).toStrictEqual([
    butterworth('lowpass', LOW_MID_HZ),
    butterworth('lowpass', LOW_MID_HZ),
  ]);
  expect(stages.mid).toStrictEqual([
    butterworth('highpass', LOW_MID_HZ),
    butterworth('highpass', LOW_MID_HZ),
    butterworth('lowpass', MID_HIGH_HZ),
    butterworth('lowpass', MID_HIGH_HZ),
  ]);
  expect(stages.high).toStrictEqual([
    butterworth('highpass', MID_HIGH_HZ),
    butterworth('highpass', MID_HIGH_HZ),
  ]);
});

test('A 计权：合成的一节二阶高通与两个一阶高通相乘在模拟域逐点相等', () => {
  const [low, combined] = bandStages(22050).weighted;
  if (!(low && combined)) throw new Error('A 计权不到两节');
  expect(low.q).toBe(0.5);
  near(low.frequency, 20.598997);
  for (const hz of [30, 100, 300, 1000, 5000]) {
    const w = 2 * Math.PI * hz;
    const product =
      (w / Math.hypot(w, 2 * Math.PI * 107.65265)) * (w / Math.hypot(w, 2 * Math.PI * 737.86223));
    near(highpassMagnitude(combined, hz), product, 1e-9);
  }
});

test('A 计权的 12.2 kHz 低通只在奈奎斯特够高时加', () => {
  expect(bandStages(22050).weighted.length).toBe(2);
  const at44 = bandStages(44100).weighted;
  expect(at44.length).toBe(3);
  expect(at44[2]).toStrictEqual({ type: 'lowpass', frequency: 12194.217, q: 0.5 });
});
