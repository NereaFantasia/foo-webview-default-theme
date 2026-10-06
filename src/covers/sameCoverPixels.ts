export const SAME_COVER_TOLERANCE = 6;

/** 按最大通道差比较，避免局部角标差异被整图平均；取色缓存传 0 以免跨过灰色门槛。 */
export function sameCoverPixels(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tolerance = SAME_COVER_TOLERANCE,
): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (Math.abs((a[index] ?? 0) - (b[index] ?? 0)) > tolerance) return false;
  }
  return true;
}
