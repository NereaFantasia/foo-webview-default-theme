import { DURATION_MS } from '../../motion/timing.ts';

/**
 * 量表值条这次换值走哪一段过渡：`enter` 从没有值到有值、从 0 长到位；`rise` 与 `fall` 是有值之间的升与落，
 * 升得快、落得慢；`exit` 是有值到没有值、缩回 0。各段的时长与曲线写在值条的样式里。
 */
export type BarPhase = 'enter' | 'rise' | 'fall' | 'exit';

/** 比例变化小于它不换阶段：稳态下读数只在末几位抖，来回换时长没有意义。 */
export const STEADY = 0.001;
/**
 * 初始动画的时长（毫秒），与样式里 enter 段取的 `--motion-slow` 一致；这段时间里新读数接着按初始动画走，
 * 不被升落截短。
 */
export const ENTER_MS = DURATION_MS.slow;

export interface BarMotion {
  /** 上一次看到的比例（0…1）；没有值是 `null`。 */
  fraction: number | null;
  phase: BarPhase;
  /** 最近一次进入初始动画的时刻，与 `now` 同一个时钟的毫秒。 */
  enteredAt: number;
}

/** 挂载时的状态：已有值也按初始动画从 0 长出来。 */
export function initialMotion(fraction: number | null, now: number): BarMotion {
  return { fraction, phase: 'enter', enteredAt: now };
}

/** 比例换成 `next` 之后的状态；变化太小、或还在初始动画里时阶段不变，只记下新比例。 */
export function followFraction(motion: BarMotion, next: number | null, now: number): BarMotion {
  const previous = motion.fraction;
  if (previous === null) return next === null ? motion : initialMotion(next, now);
  if (next === null) return { ...motion, fraction: next, phase: 'exit' };
  const entering = motion.phase === 'enter' && now - motion.enteredAt < ENTER_MS;
  if (entering || Math.abs(next - previous) < STEADY) return { ...motion, fraction: next };
  return { ...motion, fraction: next, phase: next > previous ? 'rise' : 'fall' };
}
