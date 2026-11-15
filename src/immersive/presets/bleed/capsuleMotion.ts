import { CURVE } from '../../../motion/timing.ts';

const BEZIER = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,)]+)\)$/;

const trim = (value: number): string => String(Math.round(value * 10000) / 10000);

/**
 * 把一条 `cubic-bezier()` 曲线倒放：时间反过来走，进度曲线变成 y′(x) = 1 − y(1 − x)，
 * 控制点对应地变成 P1′ = (1 − x2, 1 − y2)、P2′ = (1 − x1, 1 − y1)。解析不了就原样答回
 */
export function reverseBezier(timing: string): string {
  const parts = BEZIER.exec(timing.replace(/\s+/g, ''))?.slice(1).map(Number);
  const [x1, y1, x2, y2] = parts ?? [];
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return timing;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return timing;
  return `cubic-bezier(${trim(1 - x2)},${trim(1 - y2)},${trim(1 - x1)},${trim(1 - y1)})`;
}

/** 胶囊收起的曲线：展开曲线（`decelerateMid`）倒放，收起就是展开的倒放，时长也与展开一样 */
export const COLLAPSE_CURVE = reverseBezier(CURVE.decelerateMid.timing);
