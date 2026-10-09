import { describe, expect, test, vi } from 'vitest';
import type { FrameClock } from '../../../../src/immersive/frame/frameScheduler.ts';
import { METER_WINDOW_MS, type PaintStats } from '../../../../src/immersive/perf/paintMeter.ts';
import {
  createSpectrumHistory,
  drawTerrain,
  rowGeometry,
} from '../../../../src/immersive/terrain/terrain.ts';
import {
  canvasDrawer,
  createTerrainPainter,
  FLATNESS_DEVICE_PX,
  SETTLE_MS,
  type TerrainPaintSettings,
  type TerrainSurfaceContext,
} from '../../../../src/immersive/terrain/terrainPainter.ts';

/**
 * 山脊图的重画循环：尺寸与缩放、帧间滑动的进度、帧停即止、定格、释放。假 rAF 手动走帧，
 * 时钟由用例拨；canvas 上下文记录调用，最近一行路径的第一笔落在哪条基线上就读出了滑动进度。
 */
function fakeClock() {
  let queue: { id: number; callback: (now: number) => void }[] = [];
  let next = 1;
  const clock: FrameClock = {
    request: (callback) => {
      queue.push({ id: next, callback });
      return next++;
    },
    cancel: (handle) => {
      queue = queue.filter((entry) => entry.id !== handle);
    },
  };
  const frame = () => {
    const due = queue;
    queue = [];
    for (const entry of due) entry.callback(0);
  };
  return { clock, frame, pending: () => queue.length };
}

type Call = { op: string; args: number[] };

function fakeContext() {
  const calls: Call[] = [];
  const record =
    (op: string) =>
    (...args: number[]) => {
      calls.push({ op, args });
    };
  const context: TerrainSurfaceContext = {
    globalAlpha: 1,
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    setTransform: record('setTransform'),
  };
  return { context, calls, of: (op: string) => calls.filter((call) => call.op === op) };
}

const ROWS = 8;
const BANDS = 16;
const BOX = { width: 400, height: 200, horizon: 200 * 0.5 };
const SETTINGS: TerrainPaintSettings = {
  width: BOX.width,
  height: BOX.height,
  pixelRatio: 2,
  lineColor: 'rgb(1, 2, 3)',
  horizonRatio: 0.5,
  alphaNear: 0.3,
  alphaFar: 0.1,
  curve: true,
  frameInterval: 20,
  glide: true,
  frozen: false,
};

test('清理同步撤销排帧并释放绘制对象，重复清理不重复释放', () => {
  const { clock, pending, frame } = fakeClock();
  const draw = vi.fn();
  const dispose = vi.fn();
  const painter = createTerrainPainter(
    { kind: 'webgl', resize() {}, draw, dispose },
    flatHistory,
    SETTINGS,
    () => 1000,
    clock,
  );
  painter.frameArrived();
  expect(pending()).toBe(1);
  painter.dispose();
  expect(pending()).toBe(0);
  expect(dispose).toHaveBeenCalledOnce();
  painter.dispose();
  painter.frameArrived();
  frame();
  expect(draw).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
});

/** 全零帧填满：每行就是自己的基线，最近一行路径的第一笔是 moveTo(左沿, 基线)。 */
function flatHistory() {
  const history = createSpectrumHistory(ROWS, BANDS);
  for (let index = 0; index < ROWS; index += 1) history.push(new Array<number>(BANDS).fill(0));
  return history;
}

function setup(settings: Partial<TerrainPaintSettings> = {}) {
  const { clock, frame, pending } = fakeClock();
  const fake = fakeContext();
  const surface = { width: 300, height: 150 };
  let time = 1000;
  let tick = 0;
  const history = flatHistory();
  const painter = createTerrainPainter(
    canvasDrawer(surface, fake.context),
    () => history,
    { ...SETTINGS, ...settings },
    () => {
      // 每读一次时钟走 `tick` 毫秒：计时量得到 drawTerrain 前后两次读数之间的那一格。
      time += tick;
      return time;
    },
    clock,
  );
  /** 最近一次重画里最近一行的基线；没画过是 NaN。 */
  const nearestBaseline = () => {
    const clears = fake.calls.map((call) => call.op).lastIndexOf('clearRect');
    const first = fake.calls.slice(clears).find((call) => call.op === 'moveTo');
    return first?.args[1] ?? Number.NaN;
  };
  const advance = (ms: number) => {
    time += ms;
  };
  const ticking = (ms: number) => {
    tick = ms;
  };
  return { painter, fake, surface, frame, pending, advance, ticking, nearestBaseline, history };
}

const baselineAt = (position: number) => rowGeometry(position, ROWS, BOX).baseline;
const near = (a: number, b: number) => expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(1e-3);

describe('createTerrainPainter', () => {
  test('尺寸按物理像素设、缩放按像素比重设；尺寸不变的 update 不碰 canvas；尺寸为零时不画', () => {
    const zero = setup({ width: 0, height: 0 });
    expect(zero.surface).toStrictEqual({ width: 300, height: 150 });
    zero.painter.update({});
    zero.frame();
    expect(zero.fake.of('clearRect')).toHaveLength(0);

    const { painter, fake, surface, frame } = setup();
    expect(surface).toStrictEqual({ width: 800, height: 400 });
    expect(fake.of('setTransform')[0]?.args).toStrictEqual([2, 0, 0, 2, 0, 0]);
    painter.update({ width: 401.4, pixelRatio: 1.25 });
    expect(surface).toStrictEqual({ width: 502, height: 250 });
    expect(fake.of('setTransform')[1]?.args).toStrictEqual([1.25, 0, 0, 1.25, 0, 0]);
    painter.update({ width: 401.4, lineColor: 'red' });
    expect(fake.of('setTransform')).toHaveLength(2);
    frame();
    expect(fake.of('clearRect')).toHaveLength(1);
  });

  test('帧到后按「经过时间 / 帧距」滑向远处，滑满一行停在那里；帧停超过 SETTLE_MS 画完这一次就不再排', () => {
    const { painter, frame, pending, advance, nearestBaseline } = setup();
    painter.update({});
    frame();
    // 挂载后还没收过帧：当作早就停了，画在滑完的位置，也不再排。
    near(nearestBaseline(), baselineAt(1));
    expect(pending()).toBe(0);

    painter.frameArrived();
    advance(5);
    frame();
    near(nearestBaseline(), baselineAt(0.25));
    expect(pending()).toBe(1);
    advance(10);
    frame();
    near(nearestBaseline(), baselineAt(0.75));
    advance(10);
    frame();
    near(nearestBaseline(), baselineAt(1));
    expect(pending(), '没到 SETTLE_MS，滑满了也接着排').toBe(1);
    advance(SETTLE_MS);
    frame();
    near(nearestBaseline(), baselineAt(1));
    expect(pending()).toBe(0);
  });

  test('不滑时帧到只画一次、行不挪位；定格时一笔不画，解除后补画一次', () => {
    const still = setup({ glide: false });
    still.painter.frameArrived();
    still.advance(5);
    still.frame();
    near(still.nearestBaseline(), baselineAt(0));
    expect(still.pending()).toBe(0);

    const frozen = setup({ frozen: true });
    frozen.painter.frameArrived();
    frozen.frame();
    expect(frozen.fake.of('clearRect')).toHaveLength(0);
    expect(frozen.pending()).toBe(0);
    frozen.painter.update({ frozen: false });
    frozen.frame();
    expect(frozen.fake.of('clearRect')).toHaveLength(1);
  });

  test('曲线细分的容差按像素比折成 CSS 像素，与直接调 drawTerrain 逐笔相同', () => {
    const { painter, fake, frame, history } = setup({ pixelRatio: 1.25 });
    for (let index = 0; index < ROWS; index += 1) {
      history.push(Array.from({ length: BANDS }, (_, band) => 0.3 + 0.2 * Math.sin(band / 3)));
    }
    painter.update({});
    frame();
    const direct = fakeContext();
    drawTerrain(direct.context, history, {
      ...BOX,
      lineColor: SETTINGS.lineColor,
      alphaNear: SETTINGS.alphaNear,
      alphaFar: SETTINGS.alphaFar,
      pixelRatio: 1.25,
      offset: 1,
      flatness: FLATNESS_DEVICE_PX / 1.25,
    });
    const drawn = fake.calls.slice(fake.calls.map((call) => call.op).lastIndexOf('clearRect'));
    expect(drawn).toStrictEqual(direct.calls);
  });

  test('dispose 撤掉排着的重画，之后 update 与 frameArrived 都不再排', () => {
    const { painter, pending } = setup();
    painter.frameArrived();
    expect(pending()).toBe(1);
    painter.dispose();
    expect(pending()).toBe(0);
    painter.update({ lineColor: 'red' });
    painter.frameArrived();
    expect(pending()).toBe(0);
  });

  test('meter 给每次 drawTerrain 计时，满一个统计窗交一次；null 停，dispose 后也不再计', () => {
    const { painter, frame, advance, ticking } = setup({ glide: false });
    const reports: PaintStats[] = [];
    painter.meter((stats) => reports.push(stats));
    ticking(1);
    // 每 200 ms 画一次，第四次画完时这一窗跨过 500 ms。
    for (let index = 0; index < 4; index += 1) {
      painter.frameArrived();
      frame();
      advance(200);
    }
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report && [report.paints, report.totalMs, report.maxMs]).toStrictEqual([4, 4, 1]);
    expect(report?.spanMs).toBeGreaterThanOrEqual(METER_WINDOW_MS);
    expect(report?.spanMs).toBeLessThan(4 * 200);

    painter.meter(null);
    painter.frameArrived();
    frame();
    advance(METER_WINDOW_MS);
    painter.frameArrived();
    frame();
    expect(reports).toHaveLength(1);

    painter.dispose();
    painter.meter((stats) => reports.push(stats));
    painter.frameArrived();
    frame();
    expect(reports).toHaveLength(1);
  });
});
