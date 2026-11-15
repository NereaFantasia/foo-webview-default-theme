import { describe, expect, it } from 'vitest';
import { tealBrand } from '../../../src/theme/brand.ts';
import { rampFrom } from '../../../src/theme/brandRamp.ts';
import { darkTheme, lightTheme, themeFor, themeWithRamp } from '../../../src/theme/themes.ts';

describe('themes', () => {
  // 两个锚点是设计定的 accent：浅色档取 ramp 80，深色档取 ramp 100
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

  it('按品牌 ramp 现生成：缺省的青绿给现成那一份，别的 ramp 得到新对象，不碰现成的', () => {
    expect(themeWithRamp('light', tealBrand)).toBe(lightTheme);
    expect(themeWithRamp('dark', tealBrand)).toBe(darkTheme);
    const ramp = rampFrom({ hue: 340, chroma: 60 });
    const custom = themeWithRamp('light', ramp);
    expect(custom).not.toBe(lightTheme);
    expect(custom.colorBrandBackground).not.toBe(lightTheme.colorBrandBackground);
    custom.fontFamilyBase = 'changed';
    expect(lightTheme.fontFamilyBase).not.toBe('changed');
    expect(themeWithRamp('light', ramp)).not.toBe(custom);
  });
});
