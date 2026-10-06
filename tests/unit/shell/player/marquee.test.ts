import { describe, expect, it } from 'vitest';
import {
  MARQUEE_END_MS,
  MARQUEE_MASKS,
  MARQUEE_MIN_OVERFLOW,
  MARQUEE_SPEED,
  marqueeCycle,
} from '../../../../src/shell/player/marquee.ts';
import { DURATION_MS } from '../../../../src/motion/timing.ts';

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
