import { describe, expect, test } from 'vitest';
import {
  ALPHA_FAR,
  ALPHA_NEAR,
  createSpectrumHistory,
  drawTerrain,
  FAR_WIDTH,
  HORIZON_RATIO,
  rowGeometry,
  TERRAIN_BANDS,
  TERRAIN_ROWS,
  type TerrainContext,
} from '../../../../src/immersive/terrain/terrain.ts';

/**
 * 山脊图的纯函数部分：环形缓冲的绕回与重采样、天际线消隐的行序与遮挡、透视几何的单调性、
 * 帧间滑动的行位置。canvas 由记录调用序列的替身顶替。
 */
type Call = { op: string; args: number[]; alpha: number };

function fakeContext() {
  const calls: Call[] = [];
  const ctx: TerrainContext = {
    globalAlpha: 1,
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    clearRect: (...args) => calls.push({ op: 'clearRect', args, alpha: ctx.globalAlpha }),
    beginPath: () => calls.push({ op: 'beginPath', args: [], alpha: ctx.globalAlpha }),
    moveTo: (...args) => calls.push({ op: 'moveTo', args, alpha: ctx.globalAlpha }),
    lineTo: (...args) => calls.push({ op: 'lineTo', args, alpha: ctx.globalAlpha }),
    stroke: () => calls.push({ op: 'stroke', args: [], alpha: ctx.globalAlpha }),
  };
  /** 每行的路径：beginPath 到 stroke 之间的 moveTo / lineTo，按画的顺序（近行在前）。 */
  const rows = (): Call[][] => {
    const out: Call[][] = [];
    let current: Call[] | null = null;
    for (const call of calls) {
      if (call.op === 'beginPath') current = [];
      else if (call.op === 'stroke' && current) {
        out.push(current);
        current = null;
      } else if (current) current.push(call);
    }
    return out;
  };
  return { ctx, calls, rows, of: (op: string) => calls.filter((call) => call.op === op) };
}

const frameOf = (length: number, value: number) => Array.from({ length }, () => value);
// 折线点存 Float32，比到 1e-3 就够。
const near = (a: number, b: number, epsilon = 1e-3) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

describe('createSpectrumHistory', () => {
  test('环形缓冲：rows + 1 帧后 head 绕回，row(0) 永远是最新帧，最旧帧在最后一行', () => {
    const history = createSpectrumHistory();
    expect(history.count).toBe(0);
    history.push(frameOf(TERRAIN_BANDS, 0.001));
    const headAfterFirst = history.head;
    for (let index = 2; index <= TERRAIN_ROWS + 1; index += 1) {
      history.push(frameOf(TERRAIN_BANDS, index / 1000));
    }
    expect(history.count).toBe(TERRAIN_ROWS + 1);
    expect(history.head).toBe(headAfterFirst);
    near(history.row(0)[0] ?? -1, (TERRAIN_ROWS + 1) / 1000, 1e-6);
    near(history.row(TERRAIN_ROWS - 1)[0] ?? -1, 0.002, 1e-6);
    expect(history.row(0)).toHaveLength(TERRAIN_BANDS);
  });

  test('重采样与夹取：48 点帧最近邻铺成 96 点（缓冲按给定带数建），非数与越界值夹到 0…1，空帧写零，长帧分组均值', () => {
    const history = createSpectrumHistory(4, 96);
    history.push(Array.from({ length: 48 }, (_, index) => index / 47));
    const row = history.row(0);
    near(row[0] ?? -1, 0);
    near(row[95] ?? -1, 1);
    near(row[47] ?? -1, Math.round(47 * (47 / 95)) / 47, 1e-6);
    history.push([Number.NaN, 2, -1, 0.5, ...frameOf(92, 0.25)]);
    expect([...history.row(0).slice(0, 5)]).toStrictEqual([0, 1, 0, 0.5, 0.25]);
    history.push([]);
    expect([...history.row(0)].every((value) => value === 0)).toBe(true);
    // 比行宽长的帧分组取均值：1024 带订阅落到 256 带的缓冲。
    const wide = createSpectrumHistory(1, 4);
    wide.push([1, 1, 0, 0, 1, 0, 0, 0]);
    expect([...wide.row(0)]).toStrictEqual([1, 0, 0.5, 0]);
    wide.push([1, 1, 1, 0, 0, 0]);
    expect([...wide.row(0)]).toStrictEqual([1, 1, 0, 0]);
  });

  test('push 带 retention：新行 = 上一行 × retention + 本帧 × (1 − retention)；缓冲空着与 retention 0 都不混', () => {
    const history = createSpectrumHistory(3, 4);
    history.push([1, 1, 1, 1], 0.75);
    expect([...history.row(0)]).toStrictEqual([1, 1, 1, 1]);
    history.push([0, 0, 0, 0], 0.75);
    expect([...history.row(0)]).toStrictEqual([0.75, 0.75, 0.75, 0.75]);
    expect([...history.row(1)]).toStrictEqual([1, 1, 1, 1]);
    history.push([0, 0.5, 1, 0], 0);
    expect([...history.row(0)]).toStrictEqual([0, 0.5, 1, 0]);
    // 重采样的帧也混；只有一行的缓冲里上一行与本行是同一段内存，照样按点先读后写。
    const single = createSpectrumHistory(1, 4);
    single.push([1, 1], 0.5);
    single.push([0, 0], 0.5);
    expect([...single.row(0)]).toStrictEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe('rowGeometry', () => {
  test('近行满宽满幅 α 近、远行 0.7 宽 α 远，基线、宽、幅、α 都随行单调', () => {
    const box = { width: 1280, height: 800, horizon: 800 * HORIZON_RATIO };
    const nearest = rowGeometry(0, TERRAIN_ROWS, box);
    const farthest = rowGeometry(TERRAIN_ROWS - 1, TERRAIN_ROWS, box);
    near(nearest.width, 1280);
    near(farthest.width, 1280 * FAR_WIDTH);
    near(nearest.alpha, ALPHA_NEAR);
    near(farthest.alpha, ALPHA_FAR);
    near(nearest.baseline, 800);
    near(farthest.baseline, 340);
    let previous = nearest;
    for (let k = 1; k < TERRAIN_ROWS; k += 1) {
      const current = rowGeometry(k, TERRAIN_ROWS, box);
      expect(current.baseline, `行 ${k} 基线没往上走`).toBeLessThan(previous.baseline);
      expect(current.width, `行 ${k} 没变窄`).toBeLessThan(previous.width);
      expect(current.amplitude, `行 ${k} 幅度没变小`).toBeLessThan(previous.amplitude);
      expect(current.alpha, `行 ${k} 没变淡`).toBeLessThan(previous.alpha);
      previous = current;
    }
    // 远处行距密、近处疏：相邻基线的间距从近到远递减（透视）。
    const gaps = Array.from(
      { length: TERRAIN_ROWS - 1 },
      (_, k) =>
        rowGeometry(k, TERRAIN_ROWS, box).baseline - rowGeometry(k + 1, TERRAIN_ROWS, box).baseline,
    );
    for (let index = 1; index < gaps.length; index += 1) {
      expect(gaps[index] ?? 0, `第 ${index} 段行距没比前一段小`).toBeLessThan(gaps[index - 1] ?? 0);
    }
    // 近处一段好几像素、远处一段不到一像素。
    expect(gaps[0] ?? 0).toBeGreaterThan(5);
    expect(gaps.at(-1) ?? 1).toBeLessThan(1);
  });
});

describe('drawTerrain', () => {
  test('先清屏，全部行由近到远只描边，stroke 带该行 α 且越远越淡；曲线细分为折线', () => {
    const history = createSpectrumHistory();
    for (let index = 0; index < TERRAIN_ROWS; index += 1) {
      history.push(frameOf(TERRAIN_BANDS, 0.5));
    }
    const fake = fakeContext();
    drawTerrain(fake.ctx, history, {
      width: 1280,
      height: 800,
      horizon: 340,
      lineColor: 'rgb(1, 2, 3)',
      pixelRatio: 2,
    });
    expect(fake.calls[0]?.op).toBe('clearRect');
    expect(fake.of('beginPath')).toHaveLength(TERRAIN_ROWS);
    expect(fake.of('stroke')).toHaveLength(TERRAIN_ROWS);
    expect(fake.ctx.lineWidth).toBe(0.5);
    expect(fake.ctx.strokeStyle).toBe('rgb(1, 2, 3)');
    expect(fake.ctx.globalAlpha).toBe(1);
    const strokes = fake.of('stroke');
    near(strokes[0]?.alpha ?? -1, ALPHA_NEAR);
    near(strokes.at(-1)?.alpha ?? -1, ALPHA_FAR);
    for (let index = 1; index < strokes.length; index += 1) {
      expect(strokes[index]?.alpha ?? 1, '越远越淡').toBeLessThan(strokes[index - 1]?.alpha ?? 0);
    }
    // 最近一行先画、无遮挡：起点是曲线第一点（满宽左沿，基线减半幅），
    // 曲线每段切 4 份、末段直线，再两侧竖边各一段、基线一段。
    const nearest = fake.rows()[0] ?? [];
    const nearGeometry = rowGeometry(0, TERRAIN_ROWS, { width: 1280, height: 800, horizon: 340 });
    expect(nearest[0]?.op).toBe('moveTo');
    near(nearest[0]?.args[0] ?? -1, 0);
    near(nearest[0]?.args[1] ?? -1, nearGeometry.baseline - nearGeometry.amplitude * 0.5);
    const curveSegments = (TERRAIN_BANDS - 2) * 4 + 1;
    expect(nearest.filter((call) => call.op === 'lineTo')).toHaveLength(curveSegments + 3);
    const step = 1280 / (TERRAIN_BANDS - 1);
    // 第一段曲线 t = 1/4 处：P₀ 起、P₁ 控制、P₁P₂ 中点收，x = 0.375 · step + 0.0625 · 1.5 · step。
    near(nearest[1]?.args[0] ?? -1, (0.375 + 0.09375) * step);
    const tail = nearest.slice(-4);
    const halfPeak = Math.round(nearGeometry.baseline - nearGeometry.amplitude * 0.5);
    expect(tail.map((call) => [call.op, ...call.args.map(Math.round)])).toStrictEqual([
      ['moveTo', 1280, halfPeak],
      ['lineTo', 1280, 800],
      ['moveTo', 0, 800],
      ['lineTo', 1280, 800],
    ]);
    // 关掉曲线就是折线：每行 bands − 1 段直线。
    const straight = fakeContext();
    drawTerrain(straight.ctx, history, {
      width: 1280,
      height: 800,
      horizon: 340,
      lineColor: 'a',
      curve: false,
    });
    const straightNearest = straight.rows()[0] ?? [];
    expect(straightNearest.filter((call) => call.op === 'lineTo')).toHaveLength(
      TERRAIN_BANDS - 1 + 3,
    );
  });

  test('天际线消隐：近行高过远行的地方远行不画，谷里露出来；全被挡住的行路径为空但仍 stroke', () => {
    const box = {
      width: 1280,
      height: 800,
      horizon: 340,
      lineColor: 'a',
      amplitude: 0.8,
      curve: false,
    };
    const draw = (nearRow: number[]) => {
      const history = createSpectrumHistory(2, 5);
      history.push([0, 0, 0, 0, 0]);
      history.push(nearRow);
      const fake = fakeContext();
      drawTerrain(fake.ctx, history, box);
      expect(fake.of('stroke')).toHaveLength(2);
      return fake.rows()[1] ?? [];
    };
    // 近行两肩高 y = 160、中间谷底 y = 800；远行是 y = 340 的一条横线（x 192…1088）。
    // 近行在 x ≈ 410 与 870 处穿过 y = 340：远行只在这之间露出来。
    const valley = draw([1, 1, 0, 1, 1]);
    expect(valley.length, '谷里要画').toBeGreaterThan(0);
    const xs = valley.map((call) => call.args[0] ?? Number.NaN);
    expect(Math.min(...xs)).toBeGreaterThan(395);
    expect(Math.max(...xs)).toBeLessThan(885);
    expect(
      valley.some((call) => call.op === 'lineTo' && call.args[0] === 640),
      '谷底正中在画',
    ).toBe(true);
    expect(valley[0]?.op).toBe('moveTo');
    // 近行整条在 y = 160：远行整条在它后面。
    expect(draw([1, 1, 1, 1, 1])).toStrictEqual([]);
    // 近行平在基线 y = 800：远行整条可见，曲线一笔、基线一笔（曲线全零时与基线重合，竖边零长不画）。
    const open = draw([0, 0, 0, 0, 0]);
    expect(open.filter((call) => call.op === 'moveTo')).toHaveLength(2);
    expect(open.filter((call) => call.op === 'lineTo')).toHaveLength(5);
    near(open[0]?.args[0] ?? -1, 192);
    near(open[0]?.args[1] ?? -1, 340);
  });

  test('offset：行画在 k + offset 处，滑过最远一行的不画；越界的 offset 夹到 0…1', () => {
    // 全零帧：每行就是自己的基线，远行永远高于近行，都可见；每行路径第一笔是 moveTo(左沿, 基线)。
    const history = createSpectrumHistory();
    for (let index = 0; index < TERRAIN_ROWS; index += 1) history.push(frameOf(TERRAIN_BANDS, 0));
    const box = { width: 1280, height: 800, horizon: 340 };
    const options = { ...box, lineColor: 'a' };
    const baselineOf = (row: Call[] | undefined) => row?.[0]?.args[1] ?? -1;
    const half = fakeContext();
    drawTerrain(half.ctx, history, { ...options, offset: 0.5 });
    expect(half.of('stroke')).toHaveLength(TERRAIN_ROWS - 1);
    near(baselineOf(half.rows()[0]), rowGeometry(0.5, TERRAIN_ROWS, box).baseline);
    near(
      baselineOf(half.rows().at(-1)),
      rowGeometry(TERRAIN_ROWS - 1.5, TERRAIN_ROWS, box).baseline,
    );
    const middle = rowGeometry(0.5, TERRAIN_ROWS, box);
    expect(middle.baseline).toBeLessThan(rowGeometry(0, TERRAIN_ROWS, box).baseline);
    expect(middle.baseline).toBeGreaterThan(rowGeometry(1, TERRAIN_ROWS, box).baseline);
    const over = fakeContext();
    drawTerrain(over.ctx, history, { ...options, offset: 7 });
    expect(over.of('stroke')).toHaveLength(TERRAIN_ROWS - 1);
    near(baselineOf(over.rows()[0]), rowGeometry(1, TERRAIN_ROWS, box).baseline);
    const zero = fakeContext();
    drawTerrain(zero.ctx, history, { ...options, offset: -3 });
    expect(zero.of('stroke')).toHaveLength(TERRAIN_ROWS);
    near(baselineOf(zero.rows()[0]), 800);
  });

  test('flatness 缺省 0 与恒切 4 份逐笔相同；大于 0 时平缓处少切，行数不变', () => {
    const history = createSpectrumHistory(4, 64);
    for (let index = 0; index < 4; index += 1) {
      history.push(Array.from({ length: 64 }, (_, band) => 0.3 + 0.2 * Math.sin(band / 10)));
    }
    const box = { width: 640, height: 400, horizon: 170, lineColor: 'a' };
    const fixed = fakeContext();
    drawTerrain(fixed.ctx, history, box);
    const zero = fakeContext();
    drawTerrain(zero.ctx, history, { ...box, flatness: 0 });
    expect(zero.calls).toStrictEqual(fixed.calls);
    const adaptive = fakeContext();
    drawTerrain(adaptive.ctx, history, { ...box, flatness: 0.05 });
    expect(adaptive.of('lineTo').length).toBeLessThan(fixed.of('lineTo').length);
    expect(adaptive.of('stroke')).toHaveLength(fixed.of('stroke').length);
  });

  test('没收过帧只清屏不画；只收过 3 帧就只画 3 行', () => {
    const empty = fakeContext();
    drawTerrain(empty.ctx, createSpectrumHistory(), {
      width: 100,
      height: 100,
      horizon: 40,
      lineColor: 'a',
    });
    expect(empty.calls.map((call) => call.op)).toStrictEqual(['clearRect']);
    const history = createSpectrumHistory();
    for (let index = 0; index < 3; index += 1) history.push(frameOf(TERRAIN_BANDS, 0.2));
    const few = fakeContext();
    drawTerrain(few.ctx, history, {
      width: 100,
      height: 100,
      horizon: 40,
      lineColor: 'a',
    });
    expect(few.of('stroke')).toHaveLength(3);
  });

  test('空间平滑开着时相邻三点均值，峰被抹平但基线与两端不变', () => {
    const history = createSpectrumHistory(1, 5);
    history.push([0, 0, 1, 0, 0]);
    const raw = fakeContext();
    const smooth = fakeContext();
    const options = {
      width: 100,
      height: 100,
      horizon: 40,
      lineColor: 'a',
      curve: false,
    };
    drawTerrain(raw.ctx, history, options);
    drawTerrain(smooth.ctx, history, { ...options, smooth: true });
    const peakOf = (calls: Call[]) =>
      Math.min(...calls.filter((c) => c.op === 'lineTo').map((c) => c.args[1] ?? 0));
    expect(peakOf(smooth.calls), '平滑后峰更低（y 更大）').toBeGreaterThan(peakOf(raw.calls));
    expect(smooth.of('lineTo')).toHaveLength(raw.of('lineTo').length);
  });
});
