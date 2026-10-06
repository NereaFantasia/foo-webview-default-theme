import { CURVE, DURATION_MS, type DurationName, type Ease } from '../../motion/timing.ts';

/**
 * canvas 件的一段过渡。canvas 读不到 CSS 变量，时长与曲线直接取 `motion/timing.ts` 里 Windows 11 的原值，
 * 与写在样式里的过渡同一套。这里不看减弱动效：减弱动效下由调用方不起过渡，直接画终态。
 */
export interface Motion {
  /** 毫秒；0 表示不过渡，直接到终态。 */
  readonly duration: number;
  readonly ease: Ease;
}

export type CurveName = keyof typeof CURVE;

export function win11Motion(duration: DurationName, curve: CurveName): Motion {
  return { duration: DURATION_MS[duration], ease: CURVE[curve].ease };
}

/** 已在场的元素挪到新位置（seek 后播放头与罗盘轨道点滑过去）：点到点，250 ms。 */
export const GLIDE_MOTION: Motion = win11Motion('normal', 'pointToPoint');
/** 新内容进场（整轨波形从中线长出、换画法后变过去）：直接进场，面积大取 333 ms。 */
export const ENTER_MOTION: Motion = win11Motion('slow', 'decelerateMid');
/** 旧内容退场（换曲时旧波形压回中线）：轻退场，167 ms，短一点不挡新图。 */
export const LEAVE_MOTION: Motion = win11Motion('fast', 'accelerateMid');

/** 过渡从 `start` 起到 `now`（同一时钟的毫秒）走了多少，0…1、未缓动；时长为 0 时直接是 1。 */
export function progressOf(motion: Motion, start: number, now: number): number {
  if (!(motion.duration > 0)) return 1;
  return Math.min(Math.max((now - start) / motion.duration, 0), 1);
}
