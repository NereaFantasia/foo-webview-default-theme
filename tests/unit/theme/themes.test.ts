import { describe, expect, it } from 'vitest';
import { tealBrand } from '../../../src/theme/brand.ts';
import { darkTheme, lightTheme, themeFor } from '../../../src/theme/themes.ts';

describe('themes', () => {
  // 两个锚点是设计定的 accent：浅色档取 ramp 80，深色档取 ramp 100。
  it('浅色档的 accent 是 ramp 80', () => {
    expect(lightTheme.colorBrandForeground1).toBe(tealBrand[80]);
  });

  it('深色档的 accent 是 ramp 100', () => {
    expect(darkTheme.colorBrandForeground1).toBe(tealBrand[100]);
  });

  it('按深浅选档', () => {
    expect(themeFor('light')).toBe(lightTheme);
    expect(themeFor('dark')).toBe(darkTheme);
  });
});
