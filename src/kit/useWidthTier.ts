import { useLayoutEffect, useRef, useState, type RefCallback } from 'react';
import { useElementWidth } from './useElementWidth.ts';

/** 响应式宽度断点档位配置：元素内容宽度不小于 `min` 像素时匹配当前档位 */
export interface WidthTier<T extends string> {
  readonly tier: T;
  readonly min: number;
}

/**
 * 根据内容宽度计算匹配的档位。`tiers` 按宽度阈值降序排列；若低于最小阈值则归入最后一档
 * 初次渲染未测得宽度（null）时默认采用最宽档位，避免视图先收缩再撑开产生抖动
 */
export function widthTier<T extends string>(
  width: number | null,
  tiers: readonly [WidthTier<T>, ...WidthTier<T>[]],
): T {
  if (width === null) return tiers[0].tier;
  return (tiers.find((step) => width >= step.min) ?? tiers[tiers.length - 1]).tier;
}

/**
 * 响应式测量元素内容宽度并映射至预设断点档位的 Hook
 * 仅在跨档位切换时触发组件重渲染，档内微小尺寸波动不引发渲染
 * @param tiers 档位阶梯配置，必须按阈值降序排列（建议作为模块常量声明）；换成另一张表时按最近一次量到的宽度
 * 重新取档，宽度没变也不必重新挂载
 */
export function useWidthTier<T extends string, E extends Element = HTMLElement>(
  tiers: readonly [WidthTier<T>, ...WidthTier<T>[]],
): readonly [RefCallback<E>, T] {
  const [tier, setTier] = useState<T>(() => widthTier(null, tiers));
  const measured = useRef<number | null>(null);
  const ref = useElementWidth<E>((width) => {
    measured.current = width;
    setTier(widthTier(width, tiers));
  });
  useLayoutEffect(() => {
    setTier(widthTier(measured.current, tiers));
  }, [tiers]);
  return [ref, tier];
}
