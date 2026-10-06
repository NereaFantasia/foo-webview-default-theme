import { describe, expect, test } from 'vitest';
import {
  createPolyline,
  createSkyline,
  CURVE_SUBDIVISIONS,
  polylineCapacity,
  tracePolyline,
  type PathContext,
  type Polyline,
} from '../../../../src/immersive/terrain/skyline.ts';

/**
 * 天际线消隐的三件小活：曲线细分、轮廓逐列并入、按轮廓切可见段。
 * 路径由记录 moveTo / lineTo 的替身接住。
 */
type Op = [string, number, number];

function recorder(): PathContext & { ops: Op[] } {
  const ops: Op[] = [];
  return {
    ops,
    moveTo: (x, y) => ops.push(['moveTo', x, y]),
    lineTo: (x, y) => ops.push(['lineTo', x, y]),
  };
}

const lineOf = (xs: number[], ys: number[]) => {
  const line = createPolyline(xs.length);
  line.x.set(xs);
  line.y.set(ys);
  line.length = xs.length;
  return line;
};

/** 两条 x 单调的折线之间最大的竖直差：在两边的每个顶点上插值比较。 */
function maxGap(a: Polyline, b: Polyline) {
  const yAt = (line: Polyline, x: number) => {
    let index = 1;
    while (index < line.length - 1 && (line.x[index] ?? 0) < x) index += 1;
    const x0 = line.x[index - 1] ?? 0;
    const x1 = line.x[index] ?? 0;
    const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
    return (line.y[index - 1] ?? 0) + ((line.y[index] ?? 0) - (line.y[index - 1] ?? 0)) * t;
  };
  let gap = 0;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    for (let index = 0; index < from.length; index += 1) {
      gap = Math.max(gap, Math.abs((from.y[index] ?? 0) - yAt(to, from.x[index] ?? 0)));
    }
  }
  return gap;
}

describe('tracePolyline', () => {
  test('曲线把中间点当控制点、相邻中点当端点，每段切 4 份，末段直线；关掉就是原点列', () => {
    const xs = [0, 10, 20, 30];
    const ys = [0, 10, 0, 10];
    const curved = createPolyline(polylineCapacity(4, true));
    tracePolyline(
      (i) => xs[i] ?? 0,
      (i) => ys[i] ?? 0,
      4,
      true,
      curved,
    );
    expect(curved.length).toBe(2 * CURVE_SUBDIVISIONS + 2);
    expect([curved.x[0], curved.y[0]]).toStrictEqual([0, 0]);
    // 第一段收在 P₁P₂ 中点 (15, 5)；第二段收在 P₂P₃ 中点 (25, 5)；末点是 P₃。
    expect([curved.x[4], curved.y[4]]).toStrictEqual([15, 5]);
    expect([curved.x[8], curved.y[8]]).toStrictEqual([25, 5]);
    expect([curved.x[9], curved.y[9]]).toStrictEqual([30, 10]);
    // 曲线贴着控制点走、不穿过：t = 1/2 处是 (8.75, 6.25)，没到控制点 (10, 10)。
    expect(curved.x[2]).toBe(8.75);
    expect(curved.y[2]).toBe(6.25);
    const straight = createPolyline(polylineCapacity(4, false));
    tracePolyline(
      (i) => xs[i] ?? 0,
      (i) => ys[i] ?? 0,
      4,
      false,
      straight,
    );
    expect(straight.length).toBe(4);
    expect([...straight.x.subarray(0, 4)]).toStrictEqual(xs);
    // 两个点没有中间段，开不开曲线都是一段直线。
    expect(polylineCapacity(2, true)).toBe(2);
  });

  test('给了容差：离弦近的段少切，直线只剩弦；弯的段仍切 4 份；与恒切 4 份的差不超过容差的两倍', () => {
    const flat = createPolyline(polylineCapacity(5, true));
    tracePolyline(
      (i) => i * 10,
      (i) => i * 2,
      5,
      true,
      flat,
      0.05,
    );
    // 共线点：首段从 P₀ 起，参数走得不均匀，按参数量的离弦距离不为零，仍切 4 份；
    // 其后两段就是弦，各留一个端点；再加 P₀ 与 P₄。
    expect(flat.length).toBe(1 + CURVE_SUBDIVISIONS + 2 + 1);
    const zigzag = createPolyline(polylineCapacity(4, true));
    tracePolyline(
      (i) => i * 10,
      (i) => (i % 2) * 10,
      4,
      true,
      zigzag,
      0.05,
    );
    expect(zigzag.length).toBe(2 * CURVE_SUBDIVISIONS + 2);

    // 起伏有缓有急的一行：平缓处少切，点数变少；与恒切 4 份逐点比，差在两倍容差以内。
    const points = 200;
    const ys = Array.from(
      { length: points },
      (_, i) => 100 + 40 * Math.sin(i / 9) + (i % 17 === 0 ? 12 : 0),
    );
    const tolerance = 0.25;
    const fixed = createPolyline(polylineCapacity(points, true));
    const adaptive = createPolyline(polylineCapacity(points, true));
    tracePolyline(
      (i) => i * 3,
      (i) => ys[i] ?? 0,
      points,
      true,
      fixed,
    );
    tracePolyline(
      (i) => i * 3,
      (i) => ys[i] ?? 0,
      points,
      true,
      adaptive,
      tolerance,
    );
    expect(fixed.length).toBe(polylineCapacity(points, true));
    expect(adaptive.length, `${adaptive.length} / ${fixed.length}`).toBeLessThan(
      fixed.length * 0.8,
    );
    expect(maxGap(fixed, adaptive)).toBeLessThanOrEqual(2 * tolerance + 1e-6);
  });

  test('给了轮廓：整段被挡住的曲线段跳过、折线在那里断开；逐行出线与并进轮廓的结果都与不跳过逐笔相同', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const width = 777.3;
    const points = 96;
    for (const curve of [true, false]) {
      for (const tolerance of [0, 0.04]) {
        const plain = createSkyline(width);
        const culled = createSkyline(width);
        const full = createPolyline(polylineCapacity(points, curve));
        const cut = createPolyline(polylineCapacity(points, curve));
        let skipped = 0;
        // 从近到远：基线逐行上移、偶有高峰，远处的行大半被近处挡住，也有露出来的尖。
        for (let row = 0; row < 40; row += 1) {
          const left = row * 3.1;
          const step = (width - 2 * left) / (points - 1);
          const baseline = 400 - row * 6;
          const ys = Array.from(
            { length: points },
            () => baseline - random() * (random() < 0.2 ? 150 : 40),
          );
          const xAt = (index: number) => left + index * step;
          const yAt = (index: number) => ys[index] ?? baseline;
          tracePolyline(xAt, yAt, points, curve, full, tolerance);
          tracePolyline(xAt, yAt, points, curve, cut, tolerance, culled);
          const plainPath = recorder();
          const culledPath = recorder();
          plain.strokeVisible(plainPath, full);
          culled.strokeVisible(culledPath, cut);
          expect(culledPath.ops).toStrictEqual(plainPath.ops);
          expect(cut.firstY).toBe(full.y[0]);
          expect(cut.lastY).toBe(full.y[full.length - 1]);
          plain.raise(full);
          culled.raise(cut);
          for (let column = 0; column <= Math.ceil(width) + 1; column += 1) {
            expect(culled.at(column)).toBe(plain.at(column));
          }
          skipped += full.length - cut.length;
        }
        expect(skipped, '这组数据里应当有被跳过的段').toBeGreaterThan(0);
      }
    }
  });
});

describe('createSkyline', () => {
  test('没画过的地方很高（可见）；raise 后逐列取更小的 y，at 在列间线性插值', () => {
    const skyline = createSkyline(10);
    expect(skyline.at(3)).toBeGreaterThan(1e6);
    skyline.raise(lineOf([0, 4, 8], [40, 0, 40]));
    expect(skyline.at(4)).toBe(0);
    expect(skyline.at(2)).toBe(20);
    expect(skyline.at(6)).toBe(20);
    expect(skyline.at(2.5)).toBe(15);
    // 再并一条更低的线（y 更大）不改轮廓；更高的改。
    skyline.raise(lineOf([0, 8], [30, 30]));
    expect(skyline.at(4)).toBe(0);
    expect(skyline.at(0)).toBe(30);
    skyline.raise(lineOf([0, 8], [-5, -5]));
    expect(skyline.at(4)).toBe(-5);
    // 越界的 x 夹到两端列。
    expect(skyline.at(-3)).toBe(skyline.at(0));
  });

  test('strokeVisible：只画高出轮廓的段，翻转处按线性插值切开', () => {
    const skyline = createSkyline(10);
    skyline.raise(lineOf([0, 10], [50, 50]));
    const ctx = recorder();
    // 从 y = 60（挡住）升到 y = 40（露出）再回到 60：与 y = 50 的交点在 x = 2.5 与 7.5。
    skyline.strokeVisible(ctx, lineOf([0, 5, 10], [60, 40, 60]));
    expect(ctx.ops).toStrictEqual([
      ['moveTo', 2.5, 50],
      ['lineTo', 5, 40],
      ['lineTo', 7.5, 50],
    ]);
    // 整条都在轮廓之下：一笔不画；整条在上：从第一点起全画。
    const hidden = recorder();
    skyline.strokeVisible(hidden, lineOf([0, 10], [70, 70]));
    expect(hidden.ops).toStrictEqual([]);
    const shown = recorder();
    skyline.strokeVisible(shown, lineOf([0, 10], [10, 20]));
    expect(shown.ops).toStrictEqual([
      ['moveTo', 0, 10],
      ['lineTo', 10, 20],
    ]);
  });

  test('strokeLevel：水平线按列扫，只画高出轮廓的列段，端点夹在 left…right', () => {
    const skyline = createSkyline(20);
    // 中间 x 8…12 有一座 y = 10 的山，两侧没画过。
    skyline.raise(lineOf([8, 12], [10, 10]));
    const ctx = recorder();
    skyline.strokeLevel(ctx, 30, 2.5, 17.5);
    expect(ctx.ops).toStrictEqual([
      ['moveTo', 3, 30],
      ['lineTo', 8, 30],
      ['moveTo', 13, 30],
      ['lineTo', 17.5, 30],
    ]);
    // 线在山之上（y 更小）：整段一笔。
    const above = recorder();
    skyline.strokeLevel(above, 5, 0, 19);
    expect(above.ops).toStrictEqual([
      ['moveTo', 0, 5],
      ['lineTo', 19, 5],
    ]);
  });

  test('lowestIn：取所跨各列连同右邻列里轮廓最低处，两端按余量放宽一列', () => {
    const skyline = createSkyline(10);
    skyline.raise(lineOf([0, 10], [5, 5]));
    skyline.raise(lineOf([4, 6], [9, 1]));
    expect(skyline.lowestIn(5, 5)).toBe(5);
    expect(skyline.lowestIn(4.5, 5.5)).toBe(5);
    expect(skyline.lowestIn(7, 8)).toBeLessThanOrEqual(5);
    expect(createSkyline(10).lowestIn(0, 3)).toBeGreaterThan(1e8);
  });
});
