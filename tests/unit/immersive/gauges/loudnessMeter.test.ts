import { expect, test } from 'vitest';
import {
  channelWeights,
  createBlockMeter,
  createLoudnessWindow,
  integratedLoudness,
  kWeighting,
  loudnessOf,
} from '../../../../src/immersive/gauges/loudnessMeter.ts';

/** 立体声两路同一个 1 kHz 正弦，峰值 `dbfs`，长 `seconds`。EBU Tech 3341 的静态用例都用这种信号。 */
function sine(sampleRate: number, seconds: number, dbfs: number, phase = 0): Float32Array {
  const amplitude = 10 ** (dbfs / 20);
  const frames = Math.round(sampleRate * seconds);
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * 1000 * (index + phase)) / sampleRate);
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** 把一路信号当两路喂进去，收下所有块能量。 */
function blocksOf(signal: Float32Array, sampleRate: number, channels = 2): number[] {
  const blocks: number[] = [];
  const meter = createBlockMeter(sampleRate, channels, (energy) => blocks.push(energy));
  meter.push(Array.from({ length: channels }, () => signal));
  return blocks;
}

const near = (actual: number | null, expected: number, tolerance: number, label: string) => {
  expect(actual, `${label}：没有值`).not.toBe(null);
  expect(
    Math.abs((actual ?? Number.NaN) - expected),
    `${label}：${actual} 不在 ${expected} ± ${tolerance}`,
  ).toBeLessThanOrEqual(tolerance);
};

test('48 kHz 的系数与 BS.1770 附件 1 的表一致', () => {
  const [shelf, pass] = kWeighting(48000);
  near(shelf.b0, 1.53512485958697, 1e-9, 'b0');
  near(shelf.b1, -2.69169618940638, 1e-9, 'b1');
  near(shelf.b2, 1.19839281085285, 1e-9, 'b2');
  near(shelf.a1, -1.69065929318241, 1e-9, 'a1');
  near(shelf.a2, 0.73248077421585, 1e-9, 'a2');
  expect([pass.b0, pass.b1, pass.b2]).toStrictEqual([1, -2, 1]);
  near(pass.a1, -1.99004745483398, 1e-9, '高通 a1');
  near(pass.a2, 0.99007225036621, 1e-9, '高通 a2');
});

for (const sampleRate of [48000, 44100]) {
  test(`${sampleRate} Hz：立体声 1 kHz −23 dBFS 是 −23.0 LUFS，−33 dBFS 是 −33.0（EBU Tech 3341 用例 1、2）`, () => {
    for (const level of [-23, -33]) {
      const blocks = blocksOf(sine(sampleRate, 20, level), sampleRate);
      near(integratedLoudness(blocks), level, 0.1, `${level} 的 Integrated`);
      const window = createLoudnessWindow();
      for (const energy of blocks) window.push(energy);
      near(window.momentary(), level, 0.1, `${level} 的 Momentary`);
      near(window.shortTerm(), level, 0.1, `${level} 的 Short-term`);
    }
  });
}

test('门限：−36 / −23 / −36 dBFS 各 10 / 60 / 10 s，Integrated 是 −23.0（EBU Tech 3341 用例 3）', () => {
  const rate = 48000;
  const signal = concat([
    sine(rate, 10, -36),
    sine(rate, 60, -23, 480000),
    sine(rate, 10, -36, 3360000),
  ]);
  near(integratedLoudness(blocksOf(signal, rate)), -23, 0.1, 'Integrated');
});

test('单声道按一路算，比同电平的立体声低 3 dB', () => {
  const rate = 48000;
  const signal = sine(rate, 5, -23);
  near(integratedLoudness(blocksOf(signal, rate, 1)), -26.01, 0.1, '单声道');
});

test('声道权重：四路以内都是 1；5.1 的 LFE 不计、环绕取 1.41', () => {
  expect(channelWeights(1)).toStrictEqual([1]);
  expect(channelWeights(4)).toStrictEqual([1, 1, 1, 1]);
  expect(channelWeights(6)).toStrictEqual([1, 1, 1, 0, 1.41, 1.41]);
});

test('静音没有值；不够一个 400 ms 块没有 Integrated', () => {
  expect(loudnessOf(0)).toBe(null);
  expect(integratedLoudness(blocksOf(new Float32Array(48000 * 3), 48000))).toBe(null);
  expect(integratedLoudness([1, 1, 1])).toBe(null);
});

test('窗不满按已有的块算；清空后没有值；分段喂与一次喂出同样的块', () => {
  const rate = 44100;
  const signal = sine(rate, 1, -20);
  const window = createLoudnessWindow();
  const blocks = blocksOf(signal, rate);
  window.push(blocks[0] ?? 0);
  near(window.shortTerm(), -20, 0.3, '一块时的 Short-term');
  expect(window.size).toBe(1);
  window.clear();
  expect(window.shortTerm()).toBe(null);

  const pieces: number[] = [];
  const meter = createBlockMeter(rate, 2, (energy) => pieces.push(energy));
  for (let at = 0; at < signal.length; at += 1000) {
    meter.push([signal, signal], at, Math.min(signal.length, at + 1000));
  }
  expect(pieces.length).toBe(blocks.length);
  pieces.forEach((energy, index) => near(energy, blocks[index] ?? 0, 1e-12, `第 ${index} 块`));
});

test('reset 清掉没凑满的块与滤波状态', () => {
  const rate = 48000;
  const blocks: number[] = [];
  const meter = createBlockMeter(rate, 1, (energy) => blocks.push(energy));
  meter.push([sine(rate, 0.05, 0)]);
  meter.reset();
  meter.push([new Float32Array(rate / 10)]);
  expect(blocks).toStrictEqual([0]);
});
