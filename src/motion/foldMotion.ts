import { CURVE, DURATION_MS, type MotionCurve } from './timing.ts';

/** 一段补间：从 `from` 到 `to`，`start` 起（毫秒，与 `performance.now()` 同一时钟）走 `duration` 毫秒。 */
export interface Tween {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly duration: number;
  readonly curve: MotionCurve;
}

/** 补间在 `now` 时的值；没到起点是 `from`，过了终点是 `to`。 */
export function tweenAt(tween: Tween, now: number): number {
  const progress = tween.duration > 0 ? (now - tween.start) / tween.duration : 1;
  if (progress >= 1) return tween.to;
  if (progress <= 0) return tween.from;
  return tween.from + (tween.to - tween.from) * tween.curve.ease(progress);
}

export function tweenDone(tween: Tween, now: number): boolean {
  return now - tween.start >= tween.duration;
}

/**
 * 折叠卡照 WinUI Expander：展开 333 ms、`(0,0,0,1)`；收起 167 ms、`(1,1,0,1)`。展开着改高（首数变了、
 * 同一行换一张）是已在场元素的移动，250 ms、点到点。
 */
export const FOLD_OPEN = { duration: DURATION_MS.slow, curve: CURVE.decelerateMid } as const;
export const FOLD_CLOSE = { duration: DURATION_MS.fast, curve: CURVE.collapse } as const;
export const FOLD_RESIZE = { duration: DURATION_MS.normal, curve: CURVE.pointToPoint } as const;

/**
 * 露出的高从 `current` 朝 `target` 走：变大按展开、变小按收起。中途反向时剩下的时长按已走的比例缩短，
 * 即新方向的全程时长乘「还要走的距离 ÷ 全程 `span`」，同 CSS 过渡被打断反向时的规则（reversing
 * shortening factor）：展开到三成时收起，只用收起时长的三成走回去。减弱动效时时长为 0，当场到位。
 */
export function foldTween(
  current: number,
  target: number,
  span: number,
  now: number,
  reduced: boolean,
): Tween {
  const spec = target > current ? FOLD_OPEN : FOLD_CLOSE;
  const fraction = span > 0 ? Math.min(1, Math.abs(target - current) / span) : 0;
  const duration = reduced ? 0 : spec.duration * fraction;
  return { from: current, to: target, start: now, duration, curve: spec.curve };
}

/** 展开着改高：从 `current` 走到 `target`，时长固定。 */
export function resizeTween(current: number, target: number, now: number, reduced: boolean): Tween {
  const duration = reduced ? 0 : FOLD_RESIZE.duration;
  return { from: current, to: target, start: now, duration, curve: FOLD_RESIZE.curve };
}

/** 跟着另一段补间走的一段：同起点、同时长、同曲线，只换首尾值。视口随展开同步滚动用它。 */
export function followTween(lead: Tween, from: number, to: number): Tween {
  return { ...lead, from, to };
}
