import { afterEach, describe, expect, test } from 'vitest';
import {
  DATA_FPS,
  createFrameScheduler,
  paintFpsCap,
  setPaintFpsCap,
  type FrameClock,
  type FrameLimit,
} from '../../../../src/immersive/frame/frameScheduler.ts';

/**
 * 沉浸视图 canvas 的帧调度：合并重画请求；重画缺省不封顶，设了上限按上限封顶，取数循环按固定上限，
 * 慢画布自己的上限与重画上限取小。
 * 假 rAF 按给定刷新率逐帧回调，数一段时间里 paint 了几次。重画上限是模块级状态，每条用例结束还原成不封顶。
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
  /** 走一个显示刷新周期：把此刻排着的回调都按时间戳 `now` 调一遍。 */
  const frame = (now: number) => {
    const due = queue;
    queue = [];
    for (const entry of due) entry.callback(now);
  };
  return { clock, frame, pending: () => queue.length };
}

/** 一直有东西要画（每次 paint 完立刻再排）时，`hz` 刷新率的屏上 `seconds` 秒画了几次。 */
function paintsAt(hz: number, seconds: number, limit?: FrameLimit): number {
  const { clock, frame } = fakeClock();
  let paints = 0;
  const scheduler = createFrameScheduler(
    () => {
      paints += 1;
      scheduler.schedule();
    },
    clock,
    limit,
  );
  scheduler.schedule();
  for (let index = 0; index < hz * seconds; index += 1) frame((index * 1000) / hz);
  return paints;
}

/** 与期望次数最多差一次：按截止时刻推进时，非整倍数的刷新率两帧、三帧交替。 */
const expectAbout = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected), `${actual} ≠ ${expected}`).toBeLessThanOrEqual(1);

afterEach(() => setPaintFpsCap(null));

describe('createFrameScheduler', () => {
  test('缺省不封顶：一直在画时每个刷新周期都画', () => {
    expect(paintFpsCap()).toBeNull();
    expect(paintsAt(60, 2)).toBe(120);
    expect(paintsAt(144, 2)).toBe(288);
    expect(paintsAt(240, 2)).toBe(480);
  });

  test('重画上限 60：60 Hz 屏上每帧都画；120 / 144 / 240 Hz 屏上封顶 60 fps', () => {
    setPaintFpsCap(60);
    expect(paintsAt(60, 2)).toBe(120);
    expect(paintsAt(120, 2)).toBe(120);
    expectAbout(paintsAt(144, 2), 120);
    expect(paintsAt(240, 2)).toBe(120);
  });

  test('取数循环的固定上限不随重画上限变：不封顶或封 30 时都按 DATA_FPS', () => {
    expect(DATA_FPS).toBe(60);
    expectAbout(paintsAt(165, 2, { fixed: DATA_FPS }), 120);
    setPaintFpsCap(30);
    expectAbout(paintsAt(165, 2, { fixed: DATA_FPS }), 120);
    expectAbout(paintsAt(165, 2), 60);
  });

  test('画布自己的上限与重画上限取小：不封顶时按自己的，重画上限更低时按重画上限', () => {
    expectAbout(paintsAt(165, 2, { max: 60 }), 120);
    expect(paintsAt(60, 2, { max: 60 })).toBe(120);
    setPaintFpsCap(30);
    expectAbout(paintsAt(165, 2, { max: 60 }), 60);
    setPaintFpsCap(120);
    expectAbout(paintsAt(165, 2, { max: 60 }), 120);
  });

  test('上限改了下一个刷新周期就生效，不必重建调度；0、负数、非有限数都当不封顶', () => {
    const { clock, frame } = fakeClock();
    const stamps: number[] = [];
    const scheduler = createFrameScheduler((now) => {
      stamps.push(now);
      scheduler.schedule();
    }, clock);
    scheduler.schedule();
    for (let index = 0; index < 4; index += 1) frame(index * 10);
    expect(stamps).toStrictEqual([0, 10, 20, 30]);
    setPaintFpsCap(50);
    for (let index = 4; index < 12; index += 1) frame(index * 10);
    // 封 50（20 ms 一帧）从改完后的第一拍重新数：40、60、80、100。
    expect(stamps.slice(4)).toStrictEqual([40, 60, 80, 100]);
    for (const value of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      setPaintFpsCap(value);
      expect(paintFpsCap(), String(value)).toBeNull();
    }
  });

  test('同一刷新周期里多次 schedule 只画一次；停画一阵后第一次请求立即画，不补欠下的帧', () => {
    setPaintFpsCap(60);
    const { clock, frame, pending } = fakeClock();
    const stamps: number[] = [];
    const scheduler = createFrameScheduler((now) => stamps.push(now), clock);
    scheduler.schedule();
    scheduler.schedule();
    expect(pending()).toBe(1);
    frame(0);
    expect(stamps).toStrictEqual([0]);
    frame(16.7);
    expect(stamps).toStrictEqual([0]);
    scheduler.schedule();
    frame(1000);
    expect(stamps).toStrictEqual([0, 1000]);
  });

  test('有上限时离上次不足一帧的请求顺延到下一个够时的刷新周期；cancel 撤掉排着的', () => {
    setPaintFpsCap(60);
    const { clock, frame, pending } = fakeClock();
    const stamps: number[] = [];
    const scheduler = createFrameScheduler((now) => stamps.push(now), clock);
    scheduler.schedule();
    frame(0);
    scheduler.schedule();
    frame(8.3);
    expect(stamps).toStrictEqual([0]);
    frame(16.7);
    expect(stamps).toStrictEqual([0, 16.7]);
    scheduler.schedule();
    scheduler.cancel();
    expect(pending()).toBe(0);
    frame(40);
    expect(stamps).toStrictEqual([0, 16.7]);
  });
});
