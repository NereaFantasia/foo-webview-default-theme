import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import { tealBrand } from './brand.ts';

/** 两档主题都由同一条青绿 ramp 生成；深浅跟随系统，按 `colorSchemeAtom` 选档 */
export const lightTheme: Theme = createLightTheme(tealBrand);
export const darkTheme: Theme = createDarkTheme(tealBrand);

export type ColorScheme = 'light' | 'dark';

export function themeFor(scheme: ColorScheme): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}

/**
 * 按指定的品牌 ramp 现生成一份主题，与主窗口跟随强调色的主题同源；每次都是新对象，调用方可以改它。
 * ramp 就是缺省的青绿时直接给 `themeFor` 的那一份，与它引用相同
 */
export function themeWithRamp(scheme: ColorScheme, ramp: BrandVariants): Theme {
  if (ramp === tealBrand) return themeFor(scheme);
  return scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp);
}
