import { expect, test } from 'vitest';
import type { WaveformBands } from '../../../../src/immersive/waveform/waveformBands.ts';
import {
  WAVEFORM_MODES,
  isWaveformMode,
  needsBands,
  unitLevels,
  waveformLayers,
} from '../../../../src/immersive/waveform/waveformModes.ts';

const max = (points: ArrayLike<number>) => Math.max(...Array.from(points));

function bands(): WaveformBands {
  const ramp = (scale: number) =>
    Float32Array.from({ length: 200 }, (_, index) => (index + 1) * scale);
  return { low: ramp(0.01), mid: ramp(0.004), high: ramp(0.001), weighted: ramp(0.002) };
}

test('画法名：表里的五种认，其余不认', () => {
  for (const mode of WAVEFORM_MODES) expect(isWaveformMode(mode)).toBe(true);
  for (const value of ['', 'RMS', 'bars', null, 3]) expect(isWaveformMode(value)).toBe(false);
  expect(WAVEFORM_MODES.filter((mode) => !needsBands(mode))).toStrictEqual(['rms']);
});

test('按分位归一：分位以上夹到 1，全零给全零', () => {
  const values = Array.from({ length: 1000 }, (_, index) => index);
  const levels = unitLevels(values);
  // 0.995 × 999 取整是第 994 个，值 994。
  expect(levels[994]).toBe(1);
  expect(levels[999]).toBe(1);
  expect(Math.abs((levels[497] ?? 0) - 0.5)).toBeLessThan(1e-6);
  expect(Array.from(unitLevels([0, 0, 0]))).toStrictEqual([0, 0, 0]);
  expect(unitLevels([]).length).toBe(0);
});

test('全频画法与缺分频结果：只画宿主的 rms 一层', () => {
  const rms = [0.2, 1, 0.5];
  expect(waveformLayers('rms', rms, bands())).toStrictEqual([{ points: rms, tone: 'ink' }]);
  expect(waveformLayers('lanes', rms, null)).toStrictEqual([{ points: rms, tone: 'ink' }]);
});

test('A 计权：单层，按自己的分位归一', () => {
  const [layer, ...rest] = waveformLayers('weighted', [], bands());
  expect(rest.length).toBe(0);
  expect(layer?.tone).toBe('ink');
  expect(max(layer?.points ?? [])).toBe(1);
});

test('中高频主体：全频 rms 作淡色底影在后，合成的包络在前', () => {
  const rms = [0.3, 0.6];
  const layers = waveformLayers('midHigh', rms, bands());
  expect(layers.map((layer) => layer.tone)).toStrictEqual(['shade', 'ink']);
  expect(layers[0]?.points).toBe(rms);
  expect(max(layers[1]?.points ?? [])).toBe(1);
});

test('三层叠画：低中高从后往前，前两层缩一圈', () => {
  const layers = waveformLayers('layers', [], bands());
  expect(layers.map((layer) => [layer.tone, layer.lane])).toStrictEqual([
    ['shade', undefined],
    ['ink', undefined],
    ['hot', undefined],
  ]);
  expect(max(layers[0]?.points ?? [])).toBe(1);
  expect(Math.abs(max(layers[1]?.points ?? []) - 0.85)).toBeLessThan(1e-6);
  expect(Math.abs(max(layers[2]?.points ?? []) - 0.6)).toBeLessThan(1e-6);
});

test('三条分道：高频在最上一道，低频在最下', () => {
  const layers = waveformLayers('lanes', [], bands());
  expect(layers.map((layer) => [layer.tone, layer.lane])).toStrictEqual([
    ['hot', 0],
    ['ink', 1],
    ['shade', 2],
  ]);
});
