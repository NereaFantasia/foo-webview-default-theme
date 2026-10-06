import { describe, expect, test } from 'vitest';
import {
  buildDecor,
  cellKey,
  createRandom,
  DECOR_CELL,
  DECOR_DIAGONAL_RATIO,
  DECOR_FILL_RATIO,
  DECOR_OPEN_RATIO,
  DECOR_SCALE,
  rectsOverlap,
  seedFromKey,
  type Decor,
  type Rect,
} from '../../../../src/immersive/decor/paperDecor.ts';
import {
  drawDecor,
  transparentOf,
  type DecorContext,
  type DecorStyle,
} from '../../../../src/immersive/decor/paperDecorDraw.ts';
import { DIAL_CENTER } from '../../../../src/immersive/paper/paperLayout.ts';
import { STAGE_ARCS } from '../../../../src/immersive/paper/paperStage.ts';

/**
 * 图纸的生成式网格：布局按种子可复现、占比照网页版、护区里不放装饰；
 * 作画由记录调用的替身接住，只看打开格的边有没有进格线路径。
 */
const WIDTH = 1600;
const HEIGHT = 1000;
/** 版心坐标：封面与标题块两处护区。 */
const GUARDS: Rect[] = [
  { x: 73, y: 183, w: 394, h: 394 },
  { x: 548, y: 8, w: 672, h: 214 },
];

const serialize = (decor: Decor) =>
  JSON.stringify({
    open: [...decor.open].sort(),
    filled: [...decor.filled].sort(),
    diagonals: [...decor.diagonals].sort(),
    marks: decor.marks,
  });

/** 与 `buildDecor` 同样的走法数出护区外的格，给占比断言当分母。 */
function freeCells(decor: Decor, guards: Rect[]): Rect[] {
  const shifted = guards.map((g) => ({ ...g, x: g.x + decor.origin.x, y: g.y + decor.origin.y }));
  const cells: Rect[] = [];
  for (let row = decor.rows[0]; row <= decor.rows[1]; row += 1) {
    for (let column = decor.columns[0]; column <= decor.columns[1]; column += 1) {
      const cell = {
        x: decor.origin.x + column * DECOR_CELL,
        y: decor.origin.y + row * DECOR_CELL,
        w: DECOR_CELL,
        h: DECOR_CELL,
      };
      if (!shifted.some((g) => rectsOverlap(cell, g))) cells.push(cell);
    }
  }
  return cells;
}

describe('paperDecor', () => {
  test('createRandom / seedFromKey：同一种子同一串数，取值 [0, 1)；空曲目键得 0，同键同种子', () => {
    const first = createRandom(42);
    const again = createRandom(42);
    const other = createRandom(43);
    const values = Array.from({ length: 5 }, () => first());
    expect(values).toStrictEqual(Array.from({ length: 5 }, () => again()));
    expect(values).not.toEqual(Array.from({ length: 5 }, () => other()));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(seedFromKey('')).toBe(0);
    expect(seedFromKey('E:\\a.flac|0')).toBe(seedFromKey('E:\\a.flac|0'));
    expect(seedFromKey('E:\\a.flac|0')).not.toBe(seedFromKey('E:\\a.flac|1'));
  });

  test('buildDecor：同一种子与尺寸两次一样，换种子就变；格子铺满容器且对齐版心原点', () => {
    const decor = buildDecor({ width: WIDTH, height: HEIGHT, guards: GUARDS, seed: 7 });
    expect(serialize(decor)).toBe(
      serialize(buildDecor({ width: WIDTH, height: HEIGHT, guards: GUARDS, seed: 7 })),
    );
    expect(serialize(decor)).not.toBe(
      serialize(buildDecor({ width: WIDTH, height: HEIGHT, guards: GUARDS, seed: 8 })),
    );
    expect(decor.origin).toStrictEqual({ x: 160, y: 100 });
    expect(decor.origin.x + decor.columns[0] * DECOR_CELL).toBeLessThanOrEqual(0);
    expect(decor.origin.x + (decor.columns[1] + 1) * DECOR_CELL).toBeGreaterThanOrEqual(WIDTH);
    expect(decor.origin.y + decor.rows[0] * DECOR_CELL).toBeLessThanOrEqual(0);
    expect(decor.origin.y + (decor.rows[1] + 1) * DECOR_CELL).toBeGreaterThanOrEqual(HEIGHT);
  });

  test('buildDecor：打开 / 填色 / 对角线的格数照网页版占比，全落在护区外；记号也避开护区', () => {
    const decor = buildDecor({ width: WIDTH, height: HEIGHT, guards: GUARDS, seed: 3 });
    const free = freeCells(decor, GUARDS);
    expect(decor.open.size).toBe(Math.round(free.length * DECOR_OPEN_RATIO));
    expect(decor.filled.size).toBe(Math.round(free.length * DECOR_FILL_RATIO));
    expect(decor.diagonals.size).toBe(Math.round(free.length * DECOR_DIAGONAL_RATIO));
    const freeKeys = new Set(
      free.map((cell) =>
        cellKey(
          Math.round((cell.x - decor.origin.x) / DECOR_CELL),
          Math.round((cell.y - decor.origin.y) / DECOR_CELL),
        ),
      ),
    );
    for (const key of [...decor.open, ...decor.filled, ...decor.diagonals.keys()]) {
      expect(freeKeys.has(key), `格 ${key} 落进了护区`).toBe(true);
    }
    const shifted = GUARDS.map((g) => ({ ...g, x: g.x + decor.origin.x, y: g.y + decor.origin.y }));
    expect(decor.marks.length).toBeGreaterThan(0);
    for (const mark of decor.marks) {
      const box = { x: mark.x - 12, y: mark.y - 12, w: 24, h: 24 };
      expect(
        shifted.some((g) => rectsOverlap(box, g)),
        `记号 (${mark.x}, ${mark.y}) 挨着护区`,
      ).toBe(false);
    }
  });

  test('buildDecor：三段仪表弧刻度 11 / 8 / 5，第一段绕罗盘圆心', () => {
    const decor = buildDecor({ width: WIDTH, height: HEIGHT, guards: [], seed: 1 });
    expect(decor.arcs.map((arc) => arc.ticks)).toStrictEqual([11, 8, 5]);
    expect(decor.arcs[0]?.cx).toBe(DIAL_CENTER.x + decor.origin.x);
    expect(decor.arcs[0]?.cy).toBe(DIAL_CENTER.y + decor.origin.y);
  });

  test('buildDecor：舞台缩放是整体等比——同一种子下 s = 0.5 的布局与 s = 1 的逐项成比例', () => {
    const stage = { width: 1920, height: 1080 };
    const guards: Rect[] = [{ x: 150, y: 270, w: 460, h: 460 }];
    const common = { guards, seed: 5, sheet: stage, arcs: STAGE_ARCS };
    const full = buildDecor({ ...common, width: 1920, height: 1080, scale: 1, unit: 1 });
    const half = buildDecor({ ...common, width: 960, height: 540, scale: 0.5, unit: 0.5 });
    expect(full.cell).toBe(DECOR_CELL);
    expect(half.cell).toBe(DECOR_CELL / 2);
    expect([...half.open].sort()).toStrictEqual([...full.open].sort());
    expect([...half.filled].sort()).toStrictEqual([...full.filled].sort());
    expect([...half.diagonals].sort()).toStrictEqual([...full.diagonals].sort());
    expect(full.marks.length).toBe(10);
    expect(half.marks).toStrictEqual(
      full.marks.map((mark) => ({ ...mark, x: mark.x / 2, y: mark.y / 2, size: mark.size / 2 })),
    );
    expect(half.arcs).toStrictEqual(
      full.arcs.map((arc) => ({ ...arc, cx: arc.cx / 2, cy: arc.cy / 2, r: arc.r / 2 })),
    );
  });
});

type Segment = [number, number, number, number];

function recorder() {
  const paths: { style: unknown; segments: Segment[] }[] = [];
  const fills: Rect[] = [];
  let current: Segment[] = [];
  let last: [number, number] = [0, 0];
  const ctx: DecorContext & { paths: typeof paths; fills: Rect[] } = {
    paths,
    fills,
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    clearRect: () => {},
    fillRect: (x, y, w, h) => fills.push({ x, y, w, h }),
    beginPath: () => {
      current = [];
    },
    moveTo: (x, y) => {
      last = [x, y];
    },
    lineTo: (x, y) => {
      current.push([last[0], last[1], x, y]);
      last = [x, y];
    },
    arc: () => {},
    stroke: () => paths.push({ style: ctx.strokeStyle, segments: current }),
    fill: () => {},
    fillText: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return ctx;
}

const STYLE: DecorStyle = {
  grid: 'rgba(0, 0, 0, 0.08)',
  ink: '#0f6cbd',
  hot: '#115ea3',
  neutral: '#242424',
  mono: 'monospace',
};

describe('paperDecorDraw', () => {
  test('drawDecor：打开格的四条边不进格线路径，相邻闭合格的边照画；填色格按格填；画完 globalAlpha 复位', () => {
    const decor: Decor = {
      width: 256,
      height: 192,
      origin: { x: 0, y: 0 },
      cell: DECOR_CELL,
      unit: DECOR_SCALE,
      center: { x: 128, y: 96 },
      columns: [0, 3],
      rows: [0, 2],
      open: new Set([cellKey(1, 1)]),
      filled: new Set([cellKey(3, 0)]),
      diagonals: new Map(),
      marks: [],
      arcs: [],
    };
    const ctx = recorder();
    drawDecor(ctx, decor, STYLE);
    const grid = ctx.paths.find((path) => path.style === STYLE.grid);
    expect(grid).toBeTruthy();
    const segments = grid?.segments ?? [];
    const has = (segment: Segment) =>
      segments.some((s) =>
        s.every((value, index) => Math.abs(value - (segment[index] ?? 0)) < 1e-9),
      );
    // 打开格 (1, 1) 占 x 64…128、y 64…128；格线落在像素中间（+0.5）。
    expect(has([64.5, 64, 64.5, 128]), '左边不该画').toBe(false);
    expect(has([128.5, 64, 128.5, 128]), '右边不该画').toBe(false);
    expect(has([64, 64.5, 128, 64.5]), '上边不该画').toBe(false);
    expect(has([64, 128.5, 128, 128.5]), '下边不该画').toBe(false);
    expect(has([64.5, 0, 64.5, 64]), '上一格的左边照画').toBe(true);
    expect(has([192.5, 64, 192.5, 128]), '隔一格的竖线照画').toBe(true);
    expect(ctx.fills.at(-1)).toStrictEqual({ x: 192, y: 0, w: 64, h: 64 });
    expect(ctx.globalAlpha).toBe(1);
  });

  test('transparentOf：六位十六进制补 00 透明度取同色全透明，别的写法落到透明黑', () => {
    expect(transparentOf('#0f6cbd')).toBe('#0f6cbd00');
    expect(transparentOf(' #0F6CBD ')).toBe('#0F6CBD00');
    expect(transparentOf('rgba(36, 36, 36, 0.5)')).toBe('transparent');
    expect(transparentOf('oklch(0.5 0.1 200)')).toBe('transparent');
  });
});
