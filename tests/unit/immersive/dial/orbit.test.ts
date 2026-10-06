import { describe, expect, test } from 'vitest';
import {
  DASHED_RINGS,
  DOT_RADIUS,
  dotAngles,
  drawOrbit,
  ORBIT_DASH,
  ringAngles,
  spokeSegments,
  type OrbitContext,
  type OrbitStyle,
} from '../../../../src/immersive/dial/orbit.ts';
import { STAGE_ORBIT } from '../../../../src/immersive/paper/paperStage.ts';

/**
 * 罗盘转动层：环与辐条按墙钟转、转向相反，轨道点按播放位置每秒 3°；
 * 作画由记录调用的替身接住，看虚线环的起始角、辐条两组、轨道点落位与虚线复位。
 */
const near = (actual: number, expected: number, message?: string) =>
  expect(Math.abs(actual - expected), message ?? `${actual} ≉ ${expected}`).toBeLessThan(1e-9);
const DEG = Math.PI / 180;

interface Arc {
  x: number;
  y: number;
  radius: number;
  start: number;
  end: number;
  dash: number[];
}

function recorder() {
  const arcs: Arc[] = [];
  const strokes: { style: unknown; alpha: number; segments: number }[] = [];
  let dash: number[] = [];
  let segments = 0;
  const ctx: OrbitContext & { arcs: Arc[]; strokes: typeof strokes } = {
    arcs,
    strokes,
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    setLineDash: (next) => {
      dash = [...next];
    },
    clearRect: () => {},
    beginPath: () => {
      segments = 0;
    },
    moveTo: () => {},
    lineTo: () => {
      segments += 1;
    },
    arc: (x, y, radius, start, end) => arcs.push({ x, y, radius, start, end, dash }),
    stroke: () => strokes.push({ style: ctx.strokeStyle, alpha: ctx.globalAlpha, segments }),
    fill: () => {},
  };
  return ctx;
}

const STYLE: OrbitStyle = { ink: '#0f6cbd', hot: '#115ea3', neutral: '#242424' };

describe('orbit', () => {
  test('ringAngles：t = 0 都在 0；t = 10 s 内圈 +1、外圈 +0.65（顺时针），辐条 −1.6（逆时针）', () => {
    const start = ringAngles(0);
    near(start.inner, 0);
    near(start.spokes, 0);
    near(start.outer, 0);
    const later = ringAngles(10);
    near(later.inner, 1);
    near(later.outer, 0.65);
    near(later.spokes, -1.6);
  });

  test('spokeSegments：24 根每 15° 一根；0° / 90° / 180° / 270° 四根长 252 → 272，其余 20 根短 262 → 272', () => {
    const spokes = spokeSegments();
    expect(spokes.length).toBe(24);
    spokes.forEach((spoke, index) => near(spoke.angle, index * 15 * DEG));
    const long = spokes.filter((spoke) => spoke.long);
    expect(long.map((spoke) => Math.round(spoke.angle / DEG))).toStrictEqual([0, 90, 180, 270]);
    for (const spoke of long) expect([spoke.from, spoke.to]).toStrictEqual([252, 272]);
    const short = spokes.filter((spoke) => !spoke.long);
    expect(short.length).toBe(20);
    for (const spoke of short) expect([spoke.from, spoke.to]).toStrictEqual([262, 272]);
  });

  test('dotAngles：位置 0 在设计稿上量出的四个角度；0 → 10 s 每个点进 30°；位置不动角度不变', () => {
    const start = dotAngles(0);
    [-77, -146, 27, 98].forEach((degrees, index) => near(start[index] ?? NaN, degrees * DEG));
    const later = dotAngles(10);
    later.forEach((angle, index) => near(angle - (start[index] ?? NaN), 30 * DEG));
    expect(dotAngles(42.5)).toStrictEqual(dotAngles(42.5));
  });

  test('drawOrbit：两圈虚线环从转到的角度起画整圈；辐条短长两组；轨道点落在最外环、画前虚线已复位', () => {
    const ctx = recorder();
    const frame = {
      width: 600,
      height: 600,
      cx: 300,
      cy: 300,
      wallSeconds: 10,
      positionSeconds: 10,
    };
    drawOrbit(ctx, frame, STYLE);

    const angles = ringAngles(10);
    const rings = ctx.arcs.filter((arc) => arc.radius !== 2.5);
    expect(rings.map((arc) => arc.radius)).toStrictEqual([DASHED_RINGS.inner, DASHED_RINGS.outer]);
    near(rings[0]?.start ?? NaN, angles.inner);
    near(rings[1]?.start ?? NaN, angles.outer);
    for (const arc of rings) {
      near(arc.end - arc.start, Math.PI * 2);
      expect(arc.dash).toStrictEqual([...ORBIT_DASH]);
    }

    const spokes = ctx.strokes.slice(2);
    expect(spokes.map((stroke) => [stroke.style, stroke.alpha, stroke.segments])).toStrictEqual([
      [STYLE.neutral, 0.22, 20],
      [STYLE.ink, 0.7, 4],
    ]);

    const dots = ctx.arcs.filter((arc) => arc.radius === 2.5);
    expect(dots.length).toBe(4);
    dotAngles(10).forEach((angle, index) => {
      const dot = dots[index];
      near(dot?.x ?? NaN, 300 + Math.cos(angle) * DOT_RADIUS);
      near(dot?.y ?? NaN, 300 + Math.sin(angle) * DOT_RADIUS);
      expect(dot?.dash).toStrictEqual([]);
    });
    expect(ctx.fillStyle).toBe(STYLE.hot);
    expect(ctx.globalAlpha).toBe(1);
  });

  test('规格：舞台那套的虚线环 304 / 386、辐条 402 / 418 → 434，轨道点的半径、初始角与直径各取各的', () => {
    for (const spoke of spokeSegments(STAGE_ORBIT)) {
      expect([spoke.from, spoke.to]).toStrictEqual(spoke.long ? [402, 434] : [418, 434]);
    }
    const start = dotAngles(0, STAGE_ORBIT);
    [202, 16, 300, 128].forEach((degrees, index) => near(start[index] ?? NaN, degrees * DEG));

    const ctx = recorder();
    const frame = { width: 900, height: 900, cx: 450, cy: 450, wallSeconds: 0, positionSeconds: 0 };
    drawOrbit(ctx, { ...frame, spec: STAGE_ORBIT }, STYLE);
    expect(ctx.arcs.slice(0, 2).map((arc) => arc.radius)).toStrictEqual([304, 386]);
    const dots = ctx.arcs.slice(2);
    expect(dots.map((arc) => arc.radius)).toStrictEqual([5, 4, 3, 3]);
    STAGE_ORBIT.dots.forEach((dot, index) => {
      near(dots[index]?.x ?? NaN, 450 + Math.cos(dot.degrees * DEG) * dot.radius);
      near(dots[index]?.y ?? NaN, 450 + Math.sin(dot.degrees * DEG) * dot.radius);
    });
  });
});
