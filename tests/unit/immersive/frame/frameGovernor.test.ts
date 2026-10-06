import { afterEach, describe, expect, test } from 'vitest';
import {
  createFrameGovernor,
  GOVERNOR_DEFAULTS,
} from '../../../../src/immersive/frame/frameGovernor.ts';
import { setPaintFpsCap } from '../../../../src/immersive/frame/frameScheduler.ts';

const options = { window: 10, ratio: 0.5, slowMs: 25, gapMs: 250, warmup: 3 };

afterEach(() => setPaintFpsCap(null));

describe('createFrameGovernor', () => {
  test('帧都正常：一直不跳闸', () => {
    const governor = createFrameGovernor(options);
    for (let index = 0; index < 100; index += 1) expect(governor.record(16.7)).toBe(false);
  });

  test('开头的预热帧不记：预热期里再慢也不跳闸', () => {
    const governor = createFrameGovernor(options);
    for (let index = 0; index < options.warmup; index += 1) expect(governor.record(80)).toBe(false);
    for (let index = 0; index < options.window; index += 1) {
      expect(governor.record(16.7)).toBe(false);
    }
  });

  test('窗口记满之前不下结论；慢帧过半才跳闸，跳闸后一直是 true', () => {
    const governor = createFrameGovernor(options);
    for (let index = 0; index < options.warmup; index += 1) governor.record(16.7);
    for (let index = 0; index < options.window - 1; index += 1) {
      expect(governor.record(40)).toBe(false);
    }
    expect(governor.record(40)).toBe(true);
    expect(governor.record(16.7)).toBe(true);
  });

  test('慢帧恰好一半不跳闸；超过 gapMs 的停顿（页面隐藏、拖窗）不计入', () => {
    const governor = createFrameGovernor(options);
    for (let index = 0; index < options.warmup; index += 1) governor.record(16.7);
    for (let index = 0; index < options.window; index += 1) {
      governor.record(index % 2 === 0 ? 40 : 16.7);
      governor.record(5000);
    }
    expect(governor.record(16.7)).toBe(false);
  });

  test('设了重画上限：慢帧线放宽到上限帧距的 1.5 倍，按上限画的帧不算慢', () => {
    setPaintFpsCap(30);
    const governor = createFrameGovernor(options);
    for (let index = 0; index < options.warmup + options.window * 2; index += 1) {
      expect(governor.record(33.4)).toBe(false);
    }
    const slowOne = createFrameGovernor(options);
    for (let index = 0; index < options.warmup; index += 1) slowOne.record(33.4);
    for (let index = 0; index < options.window - 1; index += 1) slowOne.record(60);
    expect(slowOne.record(60)).toBe(true);
  });

  test('缺省参数：90 帧窗口、25 ms 算慢帧', () => {
    expect(GOVERNOR_DEFAULTS.window).toBe(90);
    expect(GOVERNOR_DEFAULTS.slowMs).toBe(25);
  });
});
