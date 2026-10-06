import { describe, expect, test } from 'vitest';
import {
  ENTER_MOTION,
  GLIDE_MOTION,
  LEAVE_MOTION,
  progressOf,
  win11Motion,
} from '../../../../src/immersive/frame/canvasMotion.ts';
import { CURVE, DURATION_MS } from '../../../../src/motion/timing.ts';

describe('win11Motion', () => {
  test('时长取 Windows 11 原值，曲线与样式里的同名曲线逐点相同', () => {
    const motion = win11Motion('normal', 'pointToPoint');
    expect(motion.duration).toBe(DURATION_MS.normal);
    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(motion.ease(progress)).toBe(CURVE.pointToPoint.ease(progress));
    }
  });

  test('三段现成的过渡：挪位 250 ms 点到点，进场 333 ms 减速，退场 167 ms 加速', () => {
    expect(GLIDE_MOTION.duration).toBe(250);
    expect(ENTER_MOTION.duration).toBe(333);
    expect(LEAVE_MOTION.duration).toBe(167);
    expect(GLIDE_MOTION.ease(0.5)).toBe(CURVE.pointToPoint.ease(0.5));
    // 减速曲线前段走得快，加速曲线前段走得慢。
    expect(ENTER_MOTION.ease(0.25)).toBeGreaterThan(0.25);
    expect(LEAVE_MOTION.ease(0.25)).toBeLessThan(0.25);
    for (const motion of [GLIDE_MOTION, ENTER_MOTION, LEAVE_MOTION]) {
      expect(motion.ease(0)).toBe(0);
      expect(motion.ease(1)).toBe(1);
    }
  });
});

describe('progressOf', () => {
  const motion = { duration: 200, ease: (progress: number) => progress };

  test('按时长线性推进，两端夹住', () => {
    expect(progressOf(motion, 1000, 900)).toBe(0);
    expect(progressOf(motion, 1000, 1100)).toBeCloseTo(0.5, 9);
    expect(progressOf(motion, 1000, 1400)).toBe(1);
  });

  test('时长为 0 时直接到终态', () => {
    expect(progressOf({ duration: 0, ease: (p) => p }, 1000, 1000)).toBe(1);
  });
});
