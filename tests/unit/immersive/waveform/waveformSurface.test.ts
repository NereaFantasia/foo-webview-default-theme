import { expect, test } from 'vitest';
import { COLUMN_WIDTH } from '../../../../src/immersive/waveform/waveformColumns.ts';
import type { ColumnLayer } from '../../../../src/immersive/waveform/waveformDraw.ts';
import {
  columnsFor,
  createSurface,
  openSurface,
  paintSurface,
  readPalette,
  type SurfaceCanvas,
  type SurfaceContext,
} from '../../../../src/immersive/waveform/waveformSurface.ts';

type Call = readonly [string, ...unknown[]];

function fakeContext() {
  const calls: Call[] = [];
  const ctx: SurfaceContext = {
    fillStyle: '',
    globalAlpha: 1,
    fillRect(x, y, width, height) {
      calls.push(['fillRect', x, y, width, height, String(this.fillStyle)]);
    },
    clearRect(x, y, width, height) {
      calls.push(['clearRect', x, y, width, height]);
    },
    setTransform(...args: unknown[]) {
      calls.push(['setTransform', ...args]);
    },
  };
  return { ctx, calls };
}

function fakeCanvas(ctx: SurfaceContext | null): SurfaceCanvas {
  return { width: 300, height: 150, getContext: () => ctx };
}

const palette = { ink: 'ink', hot: 'hot', idle: 'idle' };

test('开 canvas：物理像素取 CSS 尺寸乘像素比、四舍五入且至少 1，变换按像素比重设', () => {
  const { ctx, calls } = fakeContext();
  const canvas = fakeCanvas(ctx);
  const surface = createSurface();
  expect(openSurface(surface, canvas, 1020.4, 0.2, 1.5)).toBe(true);
  expect([canvas.width, canvas.height]).toStrictEqual([1531, 1]);
  expect([surface.width, surface.height, surface.ctx]).toStrictEqual([1020.4, 0.2, ctx]);
  expect(calls).toStrictEqual([['setTransform', 1.5, 0, 0, 1.5, 0, 0]]);
});

test('只换像素比时答尺寸没变，列不用重排', () => {
  const { ctx } = fakeContext();
  const canvas = fakeCanvas(ctx);
  const surface = createSurface();
  openSurface(surface, canvas, 1020, 64, 1);
  expect(openSurface(surface, canvas, 1020, 64, 2)).toBe(false);
  expect([canvas.width, canvas.height]).toStrictEqual([2040, 128]);
  expect(openSurface(surface, canvas, 600, 64, 2)).toBe(true);
});

test('配色：三个纸面变量现读、去掉两端空白', () => {
  const values: Record<string, string> = {
    '--paper-ink': ' ink ',
    '--paper-hot': 'hot',
    '--paper-waveform-idle': '  idle',
  };
  const style = { getPropertyValue: (name: string) => values[name] ?? '' };
  expect(readPalette(style)).toStrictEqual({ ink: 'ink', hot: 'hot', idle: 'idle' });
});

test('排列：数据还没到时没有列；有数据时按宽排成列', () => {
  expect(columnsFor(null, 600)).toStrictEqual([]);
  const [columns] = columnsFor([{ points: [0.2, 0.8], tone: 'ink' }], 5);
  expect(Array.from(columns?.levels ?? [])).toStrictEqual([0.2, 0.8].map(Math.fround));
});

test('画一帧：先清空，等数据时画一条 1 px 的未播色中线，再画各层', () => {
  const { ctx, calls } = fakeContext();
  const surface = { ...createSurface(), ctx, width: 30, height: 64, palette };
  const layer: ColumnLayer = { levels: Float32Array.from([1]), tone: 'ink' };
  paintSurface(surface, [layer], 100, true);
  expect(calls).toStrictEqual([
    ['clearRect', 0, 0, 30, 64],
    ['fillRect', 0, 32, 30, 1, 'idle'],
    ['fillRect', 0, 0, COLUMN_WIDTH, 64, 'ink'],
  ]);
});

test('画一帧：不等数据时不画中线；没开上下文或尺寸为 0 时什么也不画', () => {
  const { ctx, calls } = fakeContext();
  paintSurface({ ...createSurface(), ctx, width: 30, height: 64, palette }, [], 0, false);
  expect(calls).toStrictEqual([['clearRect', 0, 0, 30, 64]]);
  calls.length = 0;
  paintSurface({ ...createSurface(), ctx, width: 0, height: 64, palette }, [], 0, true);
  paintSurface({ ...createSurface(), width: 30, height: 64, palette }, [], 0, true);
  expect(calls).toStrictEqual([]);
});
