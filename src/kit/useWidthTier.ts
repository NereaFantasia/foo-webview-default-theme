import { useState, type RefCallback } from 'react';
import { useElementWidth } from './useElementWidth.ts';

/** 一档：内容宽不小于 `min` 像素就落在这一档。 */
export interface WidthTier<T extends string> {
  readonly tier: T;
  readonly min: number;
}

/**
 * 按内容宽分档，`tiers` 从宽到窄排；比最后一档的 `min` 还窄也落在最后一档。还没量到（null）时按最宽那档：
 * 首帧先按宽档画，量到再收，不会先挤成窄档再撑开。
 */
export function widthTier<T extends string>(
  width: number | null,
  tiers: readonly [WidthTier<T>, ...WidthTier<T>[]],
): T {
  if (width === null) return tiers[0].tier;
  return (tiers.find((step) => width >= step.min) ?? tiers[tiers.length - 1]).tier;
}

/**
 * 量元素的内容宽并分档：返回挂到元素上的 ref 与当前档。只在跨档时重渲染，宽度在档内变化不打扰调用方。
 * 档界改了要等下一次尺寸变化才生效，应当是模块顶层的常量。
 */
export function useWidthTier<T extends string, E extends Element = HTMLElement>(
  tiers: readonly [WidthTier<T>, ...WidthTier<T>[]],
): readonly [RefCallback<E>, T] {
  const [tier, setTier] = useState<T>(() => widthTier(null, tiers));
  const ref = useElementWidth<E>((width) => setTier(widthTier(width, tiers)));
  return [ref, tier];
}
