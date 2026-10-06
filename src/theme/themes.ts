import { createDarkTheme, createLightTheme, type Theme } from '@fluentui/react-components';
import { tealBrand } from './brand.ts';

/** 两档主题都由同一条青绿 ramp 生成；深浅跟随系统，按 `colorSchemeAtom` 选档。 */
export const lightTheme: Theme = createLightTheme(tealBrand);
export const darkTheme: Theme = createDarkTheme(tealBrand);

export type ColorScheme = 'light' | 'dark';

export function themeFor(scheme: ColorScheme): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
