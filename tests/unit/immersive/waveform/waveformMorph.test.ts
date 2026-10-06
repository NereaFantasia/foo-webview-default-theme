import { expect, test } from 'vitest';
import type { Motion } from '../../../../src/immersive/frame/canvasMotion.ts';
import type { ColumnLayer } from '../../../../src/immersive/waveform/waveformDraw.ts';
import {
  morphFrame,
  morphTo,
  restingLayers,
  type ShownLayer,
} from '../../../../src/immersive/waveform/waveformMorph.ts';

const MOTION: Motion = { duration: 100, ease: (progress) => progress };
const layer = (levels: number[], extra: Partial<ColumnLayer> = {}): ColumnLayer => ({
  levels: Float32Array.from(levels),
  tone: 'ink',
  ...extra,
});
const shown = (levels: number[], extra: Partial<ShownLayer> = {}): ShownLayer => ({
  ...layer(levels),
  alpha: 1,
  ...extra,
});
const values = (levels: Float32Array | undefined) =>
  Array.from(levels ?? []).map((value) => Math.round(value * 1000) / 1000);

test('同色调同分道的层直接变形：一半时高度在中间，走完落到目标', () => {
  const morph = morphTo([shown([0.2, 0.8])], [layer([0.6, 0.4])], 0, MOTION);
  if (!morph) throw new Error('没有形变');
  const half = morphFrame(morph, 50);
  expect(half.done).toBe(false);
  expect(values(half.layers[0]?.levels)).toStrictEqual([0.4, 0.6]);
  expect(half.layers[0]?.alpha).toBe(1);
  const end = morphFrame(morph, 100);
  expect(end.done).toBe(true);
  expect(values(end.layers[0]?.levels)).toStrictEqual([0.6, 0.4]);
});

test('全频换中高频：主体从全频变过去，底影借全频的轮廓淡入', () => {
  const rms = [0.5, 0.5];
  const morph = morphTo(
    [shown(rms)],
    [layer(rms, { tone: 'shade' }), layer([0.9, 0.1])],
    0,
    MOTION,
  );
  if (!morph) throw new Error('没有形变');
  const [shade, main] = morphFrame(morph, 50).layers;
  expect(shade?.tone).toBe('shade');
  expect(values(shade?.levels)).toStrictEqual([0.5, 0.5]);
  expect(shade?.alpha).toBe(0.5);
  expect(values(main?.levels)).toStrictEqual([0.7, 0.3]);
  expect(main?.alpha).toBe(1);
});

test('分道从零长起，原来的对称层压回零并淡出，走完只剩分道', () => {
  const morph = morphTo(
    [shown([0.8, 0.8])],
    [layer([1, 1], { tone: 'hot', lane: 0 }), layer([0.5, 0.5], { lane: 1 })],
    0,
    MOTION,
  );
  if (!morph) throw new Error('没有形变');
  const half = morphFrame(morph, 50).layers;
  expect(values(half[0]?.levels)).toStrictEqual([0.5, 0.5]);
  expect(half[0]?.alpha).toBe(1);
  expect(half[0]?.lane).toBe(0);
  const leaving = half[2];
  expect(leaving?.lane).toBe(undefined);
  expect(values(leaving?.levels)).toStrictEqual([0.4, 0.4]);
  expect(leaving?.alpha).toBe(0.5);
  const end = morphFrame(morph, 100);
  expect(end.layers.length).toBe(2);
  expect(end.layers.every((entry) => entry.lane !== undefined)).toBe(true);
});

test('换曲时新层为空：旧图整个压回中线；空画面上来新图从零长起', () => {
  const collapse = morphTo([shown([0.6, 0.6])], [], 0, MOTION);
  if (!collapse) throw new Error('没有形变');
  expect(values(morphFrame(collapse, 50).layers[0]?.levels)).toStrictEqual([0.3, 0.3]);
  expect(morphFrame(collapse, 100).layers).toStrictEqual([]);
  const grow = morphTo([], [layer([0.6, 0.2])], 0, MOTION);
  if (!grow) throw new Error('没有形变');
  const half = morphFrame(grow, 50).layers[0];
  expect(values(half?.levels)).toStrictEqual([0.3, 0.1]);
  expect(half?.alpha).toBe(1);
});

test('形变中途换目标：从当时画面上的样子接着变；列数不同的旧层不拿来变形', () => {
  const first = morphTo([shown([0, 0])], [layer([1, 1])], 0, MOTION);
  if (!first) throw new Error('没有形变');
  const midway = morphFrame(first, 50).layers;
  const second = morphTo(midway, [layer([0, 1])], 50, MOTION);
  if (!second) throw new Error('没有形变');
  expect(values(morphFrame(second, 100).layers[0]?.levels)).toStrictEqual([0.25, 0.75]);
  const resized = morphTo([shown([0.5, 0.5, 0.5])], [layer([0.5, 0.5])], 0, MOTION);
  if (!resized) throw new Error('没有形变');
  expect(resized.tracks.length).toBe(2);
});

test('什么都不用动时给 null；静止的层透明度是 1', () => {
  const target = [layer([0.3, 0.7])];
  expect(morphTo(restingLayers(target), target, 0, MOTION)).toBe(null);
  expect(morphTo([], [], 0, MOTION)).toBe(null);
  expect(restingLayers(target).map((entry) => entry.alpha)).toStrictEqual([1]);
});
