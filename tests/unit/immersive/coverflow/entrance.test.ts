import { describe, expect, it } from 'vitest';
import {
  ENTRY_DELAY_MS,
  ENTRY_MS,
  ENTRY_STAGGER_MS,
  EXIT_MS,
  REDUCED_FADE_MS,
  enteringPose,
  entryEnd,
  entryProgress,
  entryRank,
  entryTilt,
  exitFactor,
  TILT_DELAY_MS,
  fadeInFactor,
  offscreenOffset,
  tiltProgress,
} from '../../../../src/immersive/coverflow/entrance.ts';
import { slotAt } from '../../../../src/immersive/coverflow/slots.ts';

describe('入场时序：250 ms 后起飞，每张 400 ms，间隔 40 ms', () => {
  it('常量是任务单定下的值', () => {
    expect(ENTRY_DELAY_MS).toBe(250);
    expect(ENTRY_MS).toBe(400);
    expect(ENTRY_STAGGER_MS).toBe(40);
    expect(EXIT_MS).toBe(167);
    expect(REDUCED_FADE_MS).toBe(167);
  });

  it('起飞之前进度是 0，飞完是 1', () => {
    expect(entryProgress(0, 0)).toBe(0);
    expect(entryProgress(0, ENTRY_DELAY_MS)).toBe(0);
    expect(entryProgress(0, ENTRY_DELAY_MS + ENTRY_MS)).toBe(1);
    expect(entryProgress(0, 5000)).toBe(1);
  });

  it('后面的卡晚起飞：同一时刻靠右的进度更小', () => {
    const t = ENTRY_DELAY_MS + 100;
    expect(entryProgress(0, t)).toBeGreaterThan(entryProgress(1, t));
    expect(entryProgress(1, t)).toBeGreaterThan(entryProgress(2, t));
    expect(entryProgress(5, ENTRY_DELAY_MS + 5 * ENTRY_STAGGER_MS)).toBe(0);
  });

  it('进场曲线先快后慢：走到一半时间时已经过半', () => {
    expect(entryProgress(0, ENTRY_DELAY_MS + ENTRY_MS / 2)).toBeGreaterThan(0.5);
  });

  it('6 张满配时最后一张约 850 ms 落位', () => {
    expect(entryEnd(6)).toBe(850);
    expect(entryEnd(1)).toBe(650);
    expect(entryEnd(0)).toBe(0);
    expect(entryProgress(5, entryEnd(6))).toBe(1);
  });
});

describe('entryRank：从左数第几张要飞', () => {
  it('选中项不飞，它右边的各提前一位', () => {
    // 渲染 2 到 8，选中 5：2、3、4 是 0、1、2，6、7、8 是 3、4、5
    expect([2, 3, 4, 6, 7, 8].map((index) => entryRank(index, 2, 5))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('选中的是第一张时只有右边', () => {
    expect([1, 2, 3].map((index) => entryRank(index, 0, 0))).toEqual([0, 1, 2]);
  });
});

describe('倾角的时间线：先平着飞，TILT_DELAY_MS 后才转，飞行结束时转完', () => {
  it('起飞到 TILT_DELAY_MS 之前是 0', () => {
    expect(TILT_DELAY_MS).toBe(100);
    expect(tiltProgress(-50)).toBe(0);
    expect(tiltProgress(0)).toBe(0);
    expect(tiltProgress(TILT_DELAY_MS)).toBe(0);
  });

  it('飞行结束时是 1，之后保持 1', () => {
    expect(tiltProgress(ENTRY_MS)).toBe(1);
    expect(tiltProgress(ENTRY_MS * 3)).toBe(1);
  });

  it('中间单调增，晚于位置：位置走了 69% 的时刻（100 ms）倾角还没动', () => {
    const samples = [150, 200, 250, 300, 350].map((flown) => tiltProgress(flown));
    for (const [index, value] of samples.entries()) {
      expect(value).toBeGreaterThan(index === 0 ? 0 : (samples[index - 1] ?? 0));
      expect(value).toBeLessThan(1);
    }
    // 转的时间跨度约 300 ms，而不是挤在前 100 ms：飞行过半（200 ms）时倾角还没转到九成
    expect(tiltProgress(200)).toBeLessThan(0.9);
  });

  it('entryTilt 按顺位错开：后面的卡晚起飞也晚转', () => {
    const t = ENTRY_DELAY_MS + 200;
    expect(entryTilt(0, t)).toBeGreaterThan(entryTilt(1, t));
    expect(entryTilt(0, ENTRY_DELAY_MS + TILT_DELAY_MS)).toBe(0);
    expect(entryTilt(2, ENTRY_DELAY_MS + 2 * ENTRY_STAGGER_MS + TILT_DELAY_MS)).toBe(0);
  });
});

describe('enteringPose：飞行途中的样子', () => {
  const target = slotAt(-2);
  const from = offscreenOffset(1280, 320, target.size);

  it('进度 0 在屏外起点、倾角 0，进度 1 是槽位', () => {
    const start = enteringPose(target, 0, from, 0);
    expect(start.offset).toBe(from);
    expect(start.tilt).toBe(0);
    expect(enteringPose(target, 1, from, 1)).toEqual(target);
  });

  it('位置与倾角各按自己的进度：位置过半时倾角还是 0', () => {
    const middle = enteringPose(target, 0.5, from, 0);
    expect(middle.offset).toBeCloseTo((from + target.offset) / 2, 10);
    expect(middle.tilt).toBe(0);
    const turning = enteringPose(target, 0.9, from, 0.5);
    expect(turning.tilt).toBeCloseTo(target.tilt / 2, 10);
  });

  it('边长、不透明度、暗层不变', () => {
    const middle = enteringPose(target, 0.3, from, 0.3);
    expect(middle.size).toBe(target.size);
    expect(middle.opacity).toBe(target.opacity);
    expect(middle.shade).toBe(target.shade);
  });

  it('屏外起点：卡的左缘在舞台右缘之外', () => {
    const size = 0.7;
    const offset = offscreenOffset(1280, 320, size);
    // 单位是封面边长：舞台右缘离中线 2 个封面，卡的左缘 = offset − size / 2
    expect(offset - size / 2).toBeGreaterThanOrEqual(1280 / 2 / 320);
  });
});

describe('退出与减弱动效的淡入淡出', () => {
  it('退出：从 1 淡到 0，167 ms 走完', () => {
    expect(exitFactor(0)).toBe(1);
    expect(exitFactor(EXIT_MS)).toBe(0);
    expect(exitFactor(EXIT_MS * 3)).toBe(0);
    const middle = exitFactor(EXIT_MS / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it('减弱动效进入：从 0 线性淡到 1', () => {
    expect(fadeInFactor(0)).toBe(0);
    expect(fadeInFactor(REDUCED_FADE_MS / 2)).toBeCloseTo(0.5, 10);
    expect(fadeInFactor(REDUCED_FADE_MS)).toBe(1);
    expect(fadeInFactor(9999)).toBe(1);
  });
});
