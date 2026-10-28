import type { WidthTier } from '../../kit/useWidthTier.ts';

/** 字号档位规格（由当前预设场景根据窗高评估判定） */
export type InfoSize = 'large' | 'medium' | 'small';

/** 各档位字号与固定单行行高规格（像素），副标题缺省时保持占位以稳定垂直间距 */
export const INFO_SIZES: Readonly<
  Record<InfoSize, { title: number; titleLine: number; sub: number; subLine: number }>
> = {
  large: { title: 28, titleLine: 34, sub: 16, subLine: 22 },
  medium: { title: 22, titleLine: 27, sub: 14, subLine: 20 },
  small: { title: 20, titleLine: 24, sub: 13, subLine: 18 },
};

/** 曲名行与副标题行垂直间距（像素） */
export const INFO_ROW_GAP = 2;

/**
 * 宽度受限时的辅助信息元素折叠阶梯定义
 *
 * 空间不足时依序折叠：首先隐藏位深与采样率，其次隐藏星级评分，最后隐藏编码格式徽标（在线音质键占用相同槽位）；
 * 折叠隐藏元素不再保留占位宽度
 */
export type CollapseTier = 'full' | 'noDetail' | 'noRating' | 'bare';

/** 各字号档位对应的容器宽度折叠临界阈值配置 */
export const COLLAPSE_TIERS: Readonly<
  Record<InfoSize, readonly [WidthTier<CollapseTier>, ...WidthTier<CollapseTier>[]]>
> = {
  large: [
    { tier: 'full', min: 209 },
    { tier: 'noDetail', min: 186 },
    { tier: 'noRating', min: 163 },
    { tier: 'bare', min: 0 },
  ],
  medium: [
    { tier: 'full', min: 174 },
    { tier: 'noDetail', min: 162 },
    { tier: 'noRating', min: 132 },
    { tier: 'bare', min: 0 },
  ],
  small: [
    { tier: 'full', min: 166 },
    { tier: 'noDetail', min: 156 },
    { tier: 'noRating', min: 124 },
    { tier: 'bare', min: 0 },
  ],
};

/** 这一档里各件还在不在 */
export function partsOf(tier: CollapseTier): {
  readonly detail: boolean;
  readonly rating: boolean;
  readonly badge: boolean;
} {
  return {
    detail: tier === 'full',
    rating: tier === 'full' || tier === 'noDetail',
    badge: tier !== 'bare',
  };
}
