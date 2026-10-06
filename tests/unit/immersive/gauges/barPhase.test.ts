import { describe, expect, it } from 'vitest';
import {
  ENTER_MS,
  STEADY,
  followFraction,
  initialMotion,
  type BarMotion,
} from '../../../../src/immersive/gauges/barPhase.ts';
import { DURATION_MS } from '../../../../src/motion/timing.ts';

/** 已过初始动画的稳态：比例 0.5、阶段 rise。 */
const settled: BarMotion = { fraction: 0.5, phase: 'rise', enteredAt: 0 };
const LATER = ENTER_MS + 1;

describe('followFraction', () => {
  it('初始动画与直接进场同长', () => {
    expect(ENTER_MS).toBe(DURATION_MS.slow);
  });

  it('挂载时不论有没有值都是初始动画', () => {
    expect(initialMotion(0.3, 10)).toStrictEqual({ fraction: 0.3, phase: 'enter', enteredAt: 10 });
    expect(initialMotion(null, 10)).toStrictEqual({
      fraction: null,
      phase: 'enter',
      enteredAt: 10,
    });
  });

  it('从没有值到有值重新进入初始动画，并从这一刻起计时', () => {
    const gone: BarMotion = { fraction: null, phase: 'exit', enteredAt: 0 };
    expect(followFraction(gone, 0.4, 5000)).toStrictEqual({
      fraction: 0.4,
      phase: 'enter',
      enteredAt: 5000,
    });
  });

  it('有值到没有值缩回', () => {
    expect(followFraction(settled, null, LATER)).toStrictEqual({
      fraction: null,
      phase: 'exit',
      enteredAt: 0,
    });
  });

  it('有值之间按方向分升与落', () => {
    expect(followFraction(settled, 0.6, LATER)).toStrictEqual({
      fraction: 0.6,
      phase: 'rise',
      enteredAt: 0,
    });
    expect(followFraction(settled, 0.4, LATER)).toStrictEqual({
      fraction: 0.4,
      phase: 'fall',
      enteredAt: 0,
    });
  });

  it('初始动画没走完时新读数照旧按初始动画走', () => {
    const entering = initialMotion(0.2, 1000);
    const next = followFraction(entering, 0.8, 1000 + ENTER_MS - 1);
    expect(next).toStrictEqual({ fraction: 0.8, phase: 'enter', enteredAt: 1000 });
    expect(followFraction(next, 0.3, 1000 + ENTER_MS)).toStrictEqual({
      fraction: 0.3,
      phase: 'fall',
      enteredAt: 1000,
    });
  });

  it('变化不到阈值时阶段不变，只记下新比例', () => {
    const next = followFraction(settled, 0.5 - STEADY / 2, LATER);
    expect(next).toStrictEqual({ ...settled, fraction: 0.5 - STEADY / 2 });
  });
});
