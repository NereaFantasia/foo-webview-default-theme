import { describe, expect, it } from 'vitest';
import {
  createWheelStepper,
  WHEEL_IDLE_MS,
} from '../../../../../src/shell/player/volume/wheelSteps.ts';

const pixels = (deltaY: number, timeStamp: number) => ({ deltaY, deltaMode: 0, timeStamp });

describe('createWheelStepper', () => {
  it('鼠标一格记一步，往上滚为正；一次事件里合了几格就记几步', () => {
    const step = createWheelStepper();
    expect(step(pixels(-100, 0))).toBe(1);
    expect(step(pixels(100, 10))).toBe(-1);
    expect(step(pixels(-300, 20))).toBe(3);
  });

  it('系统设成一格滚几行也只记一步；按行、按页报的也折算', () => {
    const step = createWheelStepper();
    expect(step(pixels(-40, 0))).toBe(1);
    expect(step({ deltaY: -3, deltaMode: 1, timeStamp: 10 })).toBe(1);
    expect(step({ deltaY: 1, deltaMode: 2, timeStamp: 20 })).toBe(-1);
  });

  it('触控板的小增量攒满一格才记一步，零头留到下一次', () => {
    const step = createWheelStepper();
    const results = Array.from({ length: 12 }, (_, index) => step(pixels(-20, index * 16)));
    expect(results.filter((steps) => steps !== 0)).toEqual([1, 1]);
    expect(results.reduce((sum, steps) => sum + steps, 0)).toBe(2);
  });

  it('方向反过来或停顿太久，零头清掉', () => {
    const step = createWheelStepper();
    expect(step(pixels(-30, 0))).toBe(0);
    expect(step(pixels(-30, 16))).toBe(0);
    expect(step(pixels(20, 32))).toBe(0);
    expect(step(pixels(-30, 48))).toBe(0);
    expect(step(pixels(-30, 64))).toBe(0);
    expect(step(pixels(-30, 64 + WHEEL_IDLE_MS + 1))).toBe(0);
    expect(step(pixels(-30, 64 + WHEEL_IDLE_MS + 17))).toBe(0);
    expect(step(pixels(-30, 64 + WHEEL_IDLE_MS + 33))).toBe(0);
    expect(step(pixels(-30, 64 + WHEEL_IDLE_MS + 49))).toBe(1);
  });

  it('增量为 0 的事件不记步', () => {
    const step = createWheelStepper();
    expect(step(pixels(0, 0))).toBe(0);
  });
});
