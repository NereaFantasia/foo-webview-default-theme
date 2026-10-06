import { describe, expect, it } from 'vitest';
import {
  FOLD_CLOSE,
  FOLD_OPEN,
  FOLD_RESIZE,
  followTween,
  foldTween,
  resizeTween,
  tweenAt,
  tweenDone,
} from '../../../src/motion/foldMotion.ts';
import { CURVE } from '../../../src/motion/timing.ts';

describe('补间', () => {
  const tween = { from: 0, to: 300, start: 1000, duration: 100, curve: CURVE.linear };

  it('起点之前是首值，终点之后是尾值，中间按曲线插值', () => {
    expect(tweenAt(tween, 900)).toBe(0);
    expect(tweenAt(tween, 1050)).toBeCloseTo(150);
    expect(tweenAt(tween, 1100)).toBe(300);
    expect(tweenAt(tween, 2000)).toBe(300);
    expect(tweenDone(tween, 1099)).toBe(false);
    expect(tweenDone(tween, 1100)).toBe(true);
  });

  it('时长为 0 当场是尾值', () => {
    expect(tweenAt({ ...tween, duration: 0 }, 1000)).toBe(300);
  });
});

describe('折叠卡', () => {
  it('从合着展开走全程 333 ms、从展开收起走全程 167 ms，各用自己的曲线', () => {
    expect(foldTween(0, 300, 300, 0, false)).toMatchObject({
      duration: 333,
      curve: FOLD_OPEN.curve,
    });
    expect(foldTween(300, 0, 300, 0, false)).toMatchObject({
      duration: 167,
      curve: FOLD_CLOSE.curve,
    });
    expect(FOLD_OPEN.curve.timing).toBe('cubic-bezier(0,0,0,1)');
    expect(FOLD_CLOSE.curve.timing).toBe('cubic-bezier(1,1,0,1)');
  });

  it('展开到三成时收起：用收起时长的三成走回去', () => {
    const back = foldTween(90, 0, 300, 50, false);
    expect(back.duration).toBeCloseTo(167 * 0.3);
    expect(back).toMatchObject({ from: 90, to: 0, start: 50 });
  });

  it('收起到只剩一成时再展开：用展开时长的九成走完', () => {
    expect(foldTween(30, 300, 300, 0, false).duration).toBeCloseTo(333 * 0.9);
  });

  it('连着反向两次，剩下的时长与 CSS 过渡的反向缩短一致', () => {
    // 展开走到三成反向，收起走到一成再反向：CSS 的缩短因子是 0.667 × 0.3 + (1 − 0.3) = 0.9。
    const again = foldTween(30, 300, 300, 0, false);
    expect(again.duration / FOLD_OPEN.duration).toBeCloseTo((2 / 3) * 0.3 + 0.7);
  });

  it('减弱动效时时长为 0', () => {
    expect(foldTween(0, 300, 300, 0, true).duration).toBe(0);
    expect(resizeTween(300, 400, 0, true).duration).toBe(0);
  });

  it('展开着改高固定 250 ms、点到点曲线', () => {
    expect(resizeTween(300, 200, 5, false)).toMatchObject({
      from: 300,
      to: 200,
      start: 5,
      duration: FOLD_RESIZE.duration,
      curve: CURVE.pointToPoint,
    });
  });

  it('跟随的一段与领头的同起点、同时长、同曲线', () => {
    const lead = foldTween(0, 300, 300, 10, false);
    expect(followTween(lead, 100, 400)).toEqual({ ...lead, from: 100, to: 400 });
  });
});
