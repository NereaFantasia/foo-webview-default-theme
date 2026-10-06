import { describe, expect, it } from 'vitest';
import {
  DRILL_FAR_SCALE,
  DRILL_NEAR_SCALE,
  pageTransition,
  REFRESH_DISTANCE_PX,
  type LayerMotion,
} from '../../../src/motion/pageTransition.ts';
import { CURVE, REDUCED_MOTION_MS } from '../../../src/motion/timing.ts';

/** 一组动画里改 `property` 的那一段。 */
function track(motions: readonly LayerMotion[], property: 'opacity' | 'transform'): LayerMotion {
  const found = motions.find((item) => property in (item.keyframes[0] ?? {}));
  if (!found) throw new Error(`没有改 ${property} 的动画`);
  return found;
}

function edges(motion: LayerMotion): [unknown, unknown] {
  const first = motion.keyframes[0];
  const last = motion.keyframes[motion.keyframes.length - 1];
  const property = Object.keys(first ?? {})[0] ?? '';
  return [first?.[property], last?.[property]];
}

describe('pageTransition', () => {
  it('页面刷新：新内容从下方上移并淡入，旧内容只淡出', () => {
    const { enter, exit } = pageTransition('refresh', 'forward', false);
    const slide = track(enter, 'transform');
    expect(edges(slide)).toEqual([`translateY(${REFRESH_DISTANCE_PX}px)`, 'none']);
    expect(slide.options).toMatchObject({ duration: 333, easing: CURVE.decelerateMid.timing });
    expect(track(enter, 'opacity').options).toMatchObject({
      duration: 83,
      easing: CURVE.linear.timing,
    });
    expect(exit).toHaveLength(1);
    expect(edges(track(exit, 'opacity'))).toEqual([1, 0]);
    expect(track(exit, 'opacity').options).toMatchObject({ duration: 83, fill: 'forwards' });
  });

  it('后退时方向反过来，位移更快', () => {
    const slide = track(pageTransition('refresh', 'back', false).enter, 'transform');
    expect(edges(slide)).toEqual([`translateY(${-REFRESH_DISTANCE_PX}px)`, 'none']);
    expect(slide.options.duration).toBe(250);
  });

  it('深入：新内容由小放大，旧内容放大淡出；后退反过来', () => {
    const forward = pageTransition('drill', 'forward', false);
    expect(edges(track(forward.enter, 'transform'))).toEqual([
      `scale(${DRILL_NEAR_SCALE})`,
      'none',
    ]);
    expect(edges(track(forward.exit, 'transform'))).toEqual(['none', `scale(${DRILL_FAR_SCALE})`]);
    expect(track(forward.exit, 'transform').options).toMatchObject({
      duration: 167,
      fill: 'forwards',
    });

    const back = pageTransition('drill', 'back', false);
    expect(edges(track(back.enter, 'transform'))).toEqual([`scale(${DRILL_FAR_SCALE})`, 'none']);
    expect(edges(track(back.exit, 'transform'))).toEqual(['none', `scale(${DRILL_NEAR_SCALE})`]);
    expect(track(back.enter, 'transform').options.duration).toBe(250);
  });

  it('进场的动画结束后回到样式本身，离场的停在终态等移走', () => {
    for (const kind of ['refresh', 'drill'] as const) {
      const { enter, exit } = pageTransition(kind, 'forward', false);
      expect(enter.every((item) => item.options.fill === 'none')).toBe(true);
      expect(exit.every((item) => item.options.fill === 'forwards')).toBe(true);
    }
  });

  it('减弱动效时每一段都缩到 1 ms', () => {
    for (const kind of ['refresh', 'drill'] as const) {
      for (const direction of ['forward', 'back'] as const) {
        const { enter, exit } = pageTransition(kind, direction, true);
        for (const item of [...enter, ...exit]) {
          expect(item.options.duration).toBe(REDUCED_MOTION_MS);
        }
      }
    }
  });
});
