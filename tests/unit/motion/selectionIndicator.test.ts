import { describe, expect, it } from 'vitest';
import { indicatorMotion, INDICATOR_MS } from '../../../src/motion/selectionIndicator.ts';
import { CURVE, cubicBezier } from '../../../src/motion/timing.ts';

type Motions = ReturnType<typeof indicatorMotion>;

const BEZIER = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,)]+)\)$/;

/** 关键帧里写的缓动换成求值函数；没写按线性。 */
function easeOf(easing: unknown): (progress: number) => number {
  if (typeof easing !== 'string' || easing === 'linear') return (progress) => progress;
  const values = BEZIER.exec(easing.replace(/\s+/g, ''))?.slice(1).map(Number);
  if (!values || values.length !== 4) throw new Error(`读不懂的缓动：${easing}`);
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = values;
  return cubicBezier(x1, y1, x2, y2);
}

/** 第二个分量的数：`0 12px` 取 12，`1 3.5` 取 3.5。 */
function second(value: unknown): number {
  const text = typeof value === 'string' ? value : '';
  return Number.parseFloat(text.split(' ')[1] ?? 'NaN');
}

/**
 * 按关键帧求一根竖条在进度 `progress`（0–1）时覆盖的上下沿：位移加在原位上，缩放以上沿为原点，
 * 与竖条样式里的 `transform-origin` 一致。
 */
function coverage(motions: Motions, rest: number, height: number, progress: number) {
  const frames = motions.find((motion) => 'scale' in (motion.keyframes[0] ?? {}))?.keyframes;
  if (!frames) throw new Error('没有位移与缩放的那一组关键帧');
  const offsets = frames.map((frame, at) => frame.offset ?? at / (frames.length - 1));
  let segment = offsets.findIndex(
    (offset, at) => progress <= (offsets[at + 1] ?? 1) && at < frames.length - 1,
  );
  if (segment < 0) segment = frames.length - 2;
  const start = offsets[segment] ?? 0;
  const end = offsets[segment + 1] ?? 1;
  const local = end === start ? 1 : (progress - start) / (end - start);
  const eased = easeOf(frames[segment]?.easing)(local);
  const mix = (property: string) => {
    const a = second(frames[segment]?.[property]);
    const b = second(frames[segment + 1]?.[property]);
    return a + (b - a) * eased;
  };
  const top = rest + mix('translate');
  return { top, bottom: top + height * mix('scale') };
}

const PROGRESS = Array.from({ length: 61 }, (_, step) => step / 60);

describe('indicatorMotion', () => {
  for (const [label, from, to] of [
    ['往下', 100, 164],
    ['往上', 164, 100],
  ] as const) {
    it(`${label}：两根竖条一直在两者之间，拉到最长时盖住两者，结束时正好落在目标上`, () => {
      const height = 16;
      const move = { from, to, height };
      for (const [outgoing, rest] of [
        [true, from],
        [false, to],
      ] as const) {
        const motions = indicatorMotion(move, outgoing);
        for (const motion of motions) expect(motion.options.duration).toBe(INDICATOR_MS);
        for (const progress of PROGRESS) {
          const { top, bottom } = coverage(motions, rest, height, progress);
          expect(top).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-6);
          expect(bottom).toBeLessThanOrEqual(Math.max(from, to) + height + 1e-6);
        }
        const longest = coverage(motions, rest, height, 1 / 3);
        expect(longest.top).toBeCloseTo(Math.min(from, to));
        expect(longest.bottom).toBeCloseTo(Math.max(from, to) + height);
        const last = coverage(motions, rest, height, 1);
        expect(last.top).toBeCloseTo(to);
        expect(last.bottom).toBeCloseTo(to + height);
      }
    });
  }

  it('拉伸段用 accelerateMax、收拢段用 decelerateMax，关键帧里不换原点、不用跳变', () => {
    const motions = indicatorMotion({ from: 100, to: 164, height: 16 }, false);
    const frames = motions[0]?.keyframes ?? [];
    expect(frames.map((frame) => frame.easing)).toEqual([
      CURVE.accelerateMax.timing,
      CURVE.decelerateMax.timing,
      undefined,
    ]);
    expect(frames[1]?.offset).toBeCloseTo(1 / 3);
    for (const frame of motions.flatMap((motion) => motion.keyframes)) {
      expect(frame).not.toHaveProperty('transformOrigin');
      expect(String(frame.easing ?? '')).not.toContain('steps');
    }
  });

  it('旧的那根在收拢段淡出，新的那根不淡', () => {
    const move = { from: 0, to: 40, height: 16 };
    const opacity = (motions: Motions) =>
      motions
        .find((motion) => 'opacity' in (motion.keyframes[0] ?? {}))
        ?.keyframes.map((frame) => frame.opacity);
    expect(opacity(indicatorMotion(move, true))).toEqual([1, 1, 0]);
    expect(opacity(indicatorMotion(move, false))).toBeUndefined();
  });

  it('原地不动或量不到高度时不播', () => {
    expect(indicatorMotion({ from: 10, to: 10, height: 16 }, true)).toEqual([]);
    expect(indicatorMotion({ from: 0, to: 40, height: 0 }, false)).toEqual([]);
  });
});
