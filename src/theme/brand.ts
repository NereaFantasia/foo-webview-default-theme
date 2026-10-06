import type { BrandVariants } from '@fluentui/react-components';

/**
 * 青绿品牌 ramp。只有这里写字面色值，其余颜色一律取 Fluent token。
 *
 * 两个锚点是设计定的，不要改动：档 80 是浅色档 accent，档 100 是深色档 accent，
 * 它们分别是 `colorBrandForeground1` 在 createLightTheme / createDarkTheme 下的取值。
 * 其余十四档由 OKLCH 梯度补出，沿用 Fluent 默认 ramp 的亮度阶梯形状，
 * 只在 hover、pressed、stroke 这类派生槽上露面。
 */
export const tealBrand: BrandVariants = {
  10: '#09181b',
  20: '#0c2529',
  30: '#0f3135',
  40: '#143f43',
  50: '#134d50',
  60: '#135c5e',
  70: '#08696a',
  80: '#007a78', // 浅色档 accent
  90: '#44aba5',
  100: '#78d7ce', // 深色档 accent
  110: '#8edcd1',
  120: '#9fe1d5',
  130: '#b5e7dc',
  140: '#ccede4',
  150: '#dff3ed',
  160: '#f2faf7',
};
