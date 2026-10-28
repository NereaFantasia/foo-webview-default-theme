import { describe, expect, it } from 'vitest';
import {
  FADE_PX,
  MARQUEE_END_MS,
  MARQUEE_LEFT_FADE,
  MARQUEE_MASKS,
  MARQUEE_MIN_OVERFLOW,
  MARQUEE_SPEED,
  conveyorCycle,
  marqueeCycle,
  marqueeSpeedFor,
} from '../../../src/kit/marquee.ts';
import { DURATION_MS } from '../../../src/motion/timing.ts';

/** 某一刻（毫秒）的遮罩：遮罩不插值，取这一刻之前最后一帧。 */
function maskAt(frames: Keyframe[], duration: number, ms: number): unknown {
  const progress = ms / duration;
  let current: unknown = frames[0]?.['maskImage'];
  for (const frame of frames) if ((frame.offset ?? 0) <= progress) current = frame['maskImage'];
  return current;
}

describe('marqueeCycle', () => {
  it('放不下的量太小或不是数时不滚', () => {
    expect(marqueeCycle(0)).toBeNull();
    expect(marqueeCycle(MARQUEE_MIN_OVERFLOW - 0.5)).toBeNull();
    expect(marqueeCycle(Number.NaN)).toBeNull();
  });

  it('停顿之后的一段是匀速滚到尾、停、淡出淡入，滚动那段按速度算', () => {
    const cycle = marqueeCycle(72);
    if (!cycle) throw new Error('应当滚动');
    const scroll = (72 / MARQUEE_SPEED) * 1000;
    expect(cycle.duration).toBeCloseTo(scroll + MARQUEE_END_MS + 2 * DURATION_MS.faster, 6);
    expect(cycle.text[0]).toMatchObject({ offset: 0, transform: 'translateX(0)', opacity: 1 });
    const moved = cycle.text.filter((frame) => frame['transform'] === 'translateX(-72px)');
    expect(moved.map((frame) => frame.offset)).toEqual([
      scroll / cycle.duration,
      (scroll + MARQUEE_END_MS) / cycle.duration,
      (scroll + MARQUEE_END_MS + DURATION_MS.faster) / cycle.duration,
    ]);
    const offsets = cycle.text.map((frame) => frame.offset ?? 0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(cycle.text.at(-1)).toMatchObject({ offset: 1, transform: 'translateX(0)', opacity: 1 });
  });

  it('遮罩：滚动中两边淡，滚到尾淡左缘，回到开头又只淡右缘', () => {
    const cycle = marqueeCycle(90);
    if (!cycle) throw new Error('应当滚动');
    const scroll = (90 / MARQUEE_SPEED) * 1000;
    const at = (ms: number) => maskAt(cycle.mask, cycle.duration, ms);
    expect(at(0)).toBe(MARQUEE_MASKS.both);
    expect(at(scroll / 2)).toBe(MARQUEE_MASKS.both);
    expect(at(scroll + MARQUEE_END_MS / 2)).toBe(MARQUEE_MASKS.left);
    expect(at(cycle.duration - 1)).toBe(MARQUEE_MASKS.right);
    const offsets = cycle.mask.map((frame) => frame.offset ?? 0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe('marqueeCycle 的速度', () => {
  it('给了速度就按它算滚动那一段，不给用播放栏那一档', () => {
    const fast = marqueeCycle(72, 2 * MARQUEE_SPEED);
    const base = marqueeCycle(72);
    if (!fast || !base) throw new Error('应当滚动');
    expect(base.duration - fast.duration).toBeCloseTo((72 / MARQUEE_SPEED / 2) * 1000, 6);
  });
});

describe('marqueeSpeedFor', () => {
  it('按字号等比加快，播放栏那一档的字号不变速，更小的字不放慢', () => {
    expect(marqueeSpeedFor(13)).toBe(MARQUEE_SPEED);
    expect(marqueeSpeedFor(12)).toBe(MARQUEE_SPEED);
    expect(marqueeSpeedFor(26)).toBe(2 * MARQUEE_SPEED);
    expect(marqueeSpeedFor(28)).toBeCloseTo((MARQUEE_SPEED * 28) / 13, 6);
  });
});

describe('conveyorCycle', () => {
  it('一圈的长度不是正数时不滚', () => {
    expect(conveyorCycle(0)).toBeNull();
    expect(conveyorCycle(-5)).toBeNull();
    expect(conveyorCycle(Number.NaN)).toBeNull();
  });

  it('匀速左移一圈：结尾正好是一圈的长度，第二份落在第一份原来的位置', () => {
    const cycle = conveyorCycle(300, 60);
    if (!cycle) throw new Error('应当滚动');
    expect(cycle.duration).toBe(5000);
    expect(cycle.text).toEqual([
      { offset: 0, transform: 'translateX(0)' },
      { offset: 1, transform: 'translateX(-300px)' },
    ]);
  });

  it('不给速度用播放栏那一档', () => {
    const cycle = conveyorCycle(72);
    expect(cycle?.duration).toBeCloseTo((72 / MARQUEE_SPEED) * 1000, 6);
  });

  it('左缘渐隐只在移动期间：开头渐入、结尾渐出，两头是 0，与静止时只淡右缘的遮罩一致', () => {
    const cycle = conveyorCycle(600, 60);
    if (!cycle) throw new Error('应当滚动');
    const ramp = DURATION_MS.normal / cycle.duration;
    expect(cycle.mask.map((frame) => [frame.offset, frame[MARQUEE_LEFT_FADE]])).toEqual([
      [0, '0px'],
      [ramp, `${FADE_PX}px`],
      [1 - ramp, `${FADE_PX}px`],
      [1, '0px'],
    ]);
  });

  it('一圈很短时渐入渐出各占一半，不重叠', () => {
    const cycle = conveyorCycle(2, 36);
    if (!cycle) throw new Error('应当滚动');
    const offsets = cycle.mask.map((frame) => frame.offset ?? 0);
    expect(offsets).toEqual([0, 0.5, 0.5, 1]);
  });
});
