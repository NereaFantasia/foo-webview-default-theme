import { describe, expect, it } from 'vitest';
import {
  edgeMove,
  insertMotion,
  SHADOW_ALLOWANCE_PX,
  STEP_DISTANCE_PX,
  stepEnter,
} from '../../../src/motion/stepTransition.ts';
import { CURVE, DURATION_MS, REDUCED_MOTION_MS } from '../../../src/motion/timing.ts';

const OUT = `-${SHADOW_ALLOWANCE_PX}px`;

describe('换步：新内容进场', () => {
  it('前进从右侧、后退从左侧横移 20 px，250 ms 直接进场，配 83 ms 线性淡入', () => {
    const [fade, slide] = stepEnter('forward', false);
    expect(fade?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(fade?.options).toMatchObject({
      duration: DURATION_MS.faster,
      easing: CURVE.linear.timing,
    });
    expect(slide?.keyframes[0]).toEqual({ transform: `translateX(${STEP_DISTANCE_PX}px)` });
    expect(slide?.options).toMatchObject({
      duration: DURATION_MS.normal,
      easing: CURVE.decelerateMid.timing,
    });
    expect(stepEnter('back', false)[1]?.keyframes[0]).toEqual({
      transform: `translateX(${-STEP_DISTANCE_PX}px)`,
    });
  });

  it('减弱动效时每段都缩到 1 ms', () => {
    for (const leg of stepEnter('forward', true)) {
      expect(leg.options.duration).toBe(REDUCED_MOTION_MS);
    }
  });
});

describe('换步：底边移动', () => {
  it('高度没变时不动', () => {
    expect(edgeMove(300, 300.4, DURATION_MS.normal, false)).toBeNull();
  });

  it('变高：底板从旧高度露出，页脚从旧位置下移，点到点', () => {
    const move = edgeMove(272, 482, DURATION_MS.normal, false);
    expect(move?.surface.keyframes).toEqual([
      { clipPath: `inset(${OUT} ${OUT} 210px ${OUT})` },
      { clipPath: `inset(${OUT} ${OUT} 0px ${OUT})` },
    ]);
    expect(move?.footer.keyframes).toEqual([
      { transform: 'translateY(-210px)' },
      { transform: 'none' },
    ]);
    expect(move?.surface.options).toMatchObject({
      easing: CURVE.pointToPoint.timing,
      fill: 'none',
    });
  });

  it('变矮：在钉住的旧高度上收回，播完停在终态', () => {
    const move = edgeMove(482, 272, DURATION_MS.fast, false);
    expect(move?.surface.keyframes.at(-1)).toEqual({
      clipPath: `inset(${OUT} ${OUT} 210px ${OUT})`,
    });
    expect(move?.footer.keyframes.at(-1)).toEqual({ transform: 'translateY(-210px)' });
    expect(move?.footer.options).toMatchObject({ duration: DURATION_MS.fast, fill: 'forwards' });
  });
});

describe('插进一块', () => {
  it('后面的兄弟从原位让位 167 ms；这一块等让位播完再 83 ms 淡入', () => {
    const motion = insertMotion(71.6, false);
    expect(motion.following.keyframes).toEqual([
      { transform: 'translateY(-72px)' },
      { transform: 'none' },
    ]);
    expect(motion.following.options).toMatchObject({
      duration: DURATION_MS.fast,
      easing: CURVE.pointToPoint.timing,
    });
    expect(motion.inserted.options).toMatchObject({
      duration: DURATION_MS.faster,
      delay: DURATION_MS.fast,
      fill: 'backwards',
    });
  });
});
