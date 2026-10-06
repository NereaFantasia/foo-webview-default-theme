import { expect, test } from 'vitest';
import {
  autocorrelation,
  estimatePeriod,
  treeScore,
} from '../../../../src/immersive/tempo/tempoCorrelation.ts';

/**
 * 在合成的起音曲线上测：拍点处是尖峰、其余是小噪声。帧率照 22050 Hz / 256 样本一帧。
 * 噪声用固定种子的伪随机，结果可复现。
 */
const FPS = 22050 / 256;

function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 按给定的拍点时刻（秒）造起音曲线；`length` 秒长。 */
function onsetAt(times: readonly number[], length: number, seed = 1): Float32Array {
  const random = noise(seed);
  const out = Float32Array.from({ length: Math.ceil(length * FPS) }, () => random() * 0.2);
  for (const time of times) {
    const frame = Math.round(time * FPS);
    if (frame < out.length) out[frame] = 3 + random();
  }
  return out;
}

const steady = (bpm: number, from: number, to: number): number[] => {
  const times: number[] = [];
  for (let time = from; time < to; time += 60 / bpm) times.push(time);
  return times;
};

test('拍长：120 BPM 估成半秒；60 BPM 不被先验拉到 120；240 BPM 超出上限，隔一拍取成 120', () => {
  const at120 = estimatePeriod(onsetAt(steady(120, 0.3, 30), 30), FPS);
  expect(at120 !== null && Math.abs(at120 - FPS / 2) < 0.6, String(at120)).toBe(true);
  const at60 = estimatePeriod(onsetAt(steady(60, 0.3, 30), 30), FPS);
  expect(at60 !== null && Math.abs(at60 - FPS) < 1.2, String(at60)).toBe(true);
  const at240 = estimatePeriod(onsetAt(steady(240, 0.3, 30), 30), FPS);
  expect(at240 !== null && Math.abs(at240 - FPS / 2) < 0.6, String(at240)).toBe(true);
});

test('拍长：曲线太短或全零时估不出', () => {
  expect(estimatePeriod(new Float32Array(100), FPS)).toBe(null);
  expect(estimatePeriod(new Float32Array(Math.ceil(30 * FPS)), FPS)).toBe(null);
});

// 挑层级的四个候选在稳定的拍子上都对不上真拍长的层级，树分都不到七成（挑层级按七成否决）。
test('层级树：90–175 BPM 的稳定拍子上，3/4、4/3、2/3、3/2 倍拍长的树分都不到真拍长的七成', () => {
  for (const bpm of [90, 120, 140, 175]) {
    const correlation = autocorrelation(onsetAt(steady(bpm, 0.3, 40), 40), FPS, 4);
    if (!correlation) throw new Error(`${bpm} BPM 算不出自相关`);
    const period = (FPS * 60) / bpm;
    const truth = treeScore(correlation, period);
    for (const ratio of [3 / 4, 4 / 3, 2 / 3, 3 / 2]) {
      const score = treeScore(correlation, period * ratio);
      expect(score, `${bpm} BPM ×${ratio}: ${score} / ${truth}`).toBeLessThan(0.7 * truth);
    }
  }
});
