import { describe, expect, it } from 'vitest';
import { trayMenuCss } from '../../../src/playback/trayMenuStyle.ts';
import { darkTheme, lightTheme } from '../../../src/theme/themes.ts';

/** 取一条规则的声明块：选择器原样给、独占行首，只认第一处。 */
function block(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`样式里没有 ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

describe('trayMenuCss', () => {
  it('间距与圆角从主题对象取值，落到的像素是面板、菜单项、分隔线、歌曲卡与播放三键各自的定值', () => {
    for (const [theme, dark] of [
      [lightTheme, false],
      [darkTheme, true],
    ] as const) {
      const css = trayMenuCss(theme, dark);
      expect(block(css, '.fb-menu')).toContain('padding: 6px 4px;');
      expect(block(css, '.fb-item')).toContain('gap: 12px;');
      expect(block(css, '.fb-item')).toContain('padding: 0 12px;');
      expect(block(css, '.fb-sep')).toContain('margin: 6px 8px;');
      expect(block(css, '.fb-item[data-item-id="np"]')).toContain('padding: 8px 12px;');
      const playback = block(css, '.fb-zone[data-zone="playback"]');
      expect(playback).toContain('gap: 8px;');
      expect(playback).toContain('padding: 6px 0;');
      expect(block(css, '.fb-item.fb-slider')).toContain('gap: 8px;');
      expect(block(css, '.fb-slider-track')).toContain('border-radius: 2px;');
      expect(block(css, '.fb-slider-fill')).toContain('border-radius: 2px;');
    }
  });

  it('菜单项不画浏览器的焦点框：指针打开菜单时宿主也把焦点放到第一项', () => {
    expect(block(trayMenuCss(darkTheme, true), '.fb-item:focus')).toContain('outline: none;');
  });

  it('源码里不出现字面色值：颜色全从主题对象取', () => {
    const css = trayMenuCss(lightTheme, false);
    expect(css).toContain(`color: ${lightTheme.colorNeutralForeground1};`);
    expect(trayMenuCss(darkTheme, true)).toContain(':root { color-scheme: dark; }');
  });
});
