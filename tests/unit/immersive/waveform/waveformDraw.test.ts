import { expect, test } from 'vitest';
import { COLUMN_PITCH, COLUMN_WIDTH } from '../../../../src/immersive/waveform/waveformColumns.ts';
import {
  LANE_GAP,
  drawColumnLayers,
  laneCenter,
  layerColumns,
  type ColumnLayer,
  type WaveformContext,
} from '../../../../src/immersive/waveform/waveformDraw.ts';

type Rect = { x: number; y: number; width: number; height: number; color: string; alpha: number };

function fakeContext() {
  const rects: Rect[] = [];
  const ctx: WaveformContext = {
    fillStyle: '',
    globalAlpha: 1,
    fillRect(x, y, width, height) {
      rects.push({ x, y, width, height, color: String(this.fillStyle), alpha: this.globalAlpha });
    },
  };
  return { ctx, rects };
}

const palette = { ink: 'ink', hot: 'hot', idle: 'idle' };
const layer = (levels: number[], extra: Partial<ColumnLayer> = {}): ColumnLayer => ({
  levels: Float32Array.from(levels),
  tone: 'ink',
  ...extra,
});

test('重采样成列：每列取所覆盖点的最大值，色调与分道原样带上', () => {
  const [columns] = layerColumns([{ points: [0.1, 0.4, 0.9, 0.2], tone: 'hot', lane: 2 }], 2);
  expect(Array.from(columns?.levels ?? [])).toStrictEqual([0.4, 0.9].map(Math.fround));
  expect(columns?.tone).toBe('hot');
  expect(columns?.lane).toBe(2);
  const [mirrored] = layerColumns([{ points: [1], tone: 'ink' }], 1);
  expect('lane' in (mirrored ?? {})).toBe(false);
});

test('对称的层：以中线上下各画一半，播放头左边取层色、右边取未播色', () => {
  const { ctx, rects } = fakeContext();
  drawColumnLayers(ctx, [layer([0.5, 0.5, 0])], 60, palette, COLUMN_PITCH);
  expect(rects).toStrictEqual([
    { x: 0, y: 15, width: COLUMN_WIDTH, height: 30, color: 'ink', alpha: 1 },
    { x: COLUMN_PITCH, y: 15, width: COLUMN_WIDTH, height: 30, color: 'idle', alpha: 0.75 },
  ]);
  expect(ctx.globalAlpha).toBe(1);
});

test('淡色与热色：已播段各取三成五的数据墨与热色，未播段是未播色的三档深浅', () => {
  const { ctx, rects } = fakeContext();
  const layers = [layer([1, 1], { tone: 'shade' }), layer([1, 1], { tone: 'hot' })];
  drawColumnLayers(ctx, layers, 20, palette, COLUMN_PITCH);
  expect(rects.map((rect) => [rect.color, rect.alpha])).toStrictEqual([
    ['ink', 0.35],
    ['idle', 0.4],
    ['hot', 1],
    ['idle', 1],
  ]);
});

test('有声的列至少 1 px：对称层半高不小于 0.5', () => {
  const { ctx, rects } = fakeContext();
  drawColumnLayers(ctx, [layer([0.001])], 60, palette, 100);
  expect([rects[0]?.y, rects[0]?.height]).toStrictEqual([29.5, 1]);
});

test('分道：三道等高、道间留空，各自从底往上画，至少 1 px', () => {
  const { ctx, rects } = fakeContext();
  const laneHeight = (60 - 2 * LANE_GAP) / 3;
  drawColumnLayers(
    ctx,
    [layer([1], { lane: 0 }), layer([0.5], { lane: 1 }), layer([0.0001], { lane: 2 })],
    60,
    palette,
    100,
  );
  expect(rects.map((rect) => [rect.y, rect.height])).toStrictEqual([
    [0, laneHeight],
    [laneHeight + LANE_GAP + laneHeight / 2, laneHeight / 2],
    [60 - 1, 1],
  ]);
});

test('分道中点：道名按它对齐', () => {
  expect([0, 1, 2].map((lane) => laneCenter(lane, 3, 60))).toStrictEqual([9, 30, 51]);
});
