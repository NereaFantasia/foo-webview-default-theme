import { describe, expect, it } from 'vitest';
import { iconSvgOf } from '../../../src/shell/trayIcons.ts';

describe('iconSvgOf', () => {
  it('从渲染出来的 <svg> 标记里抽出 viewBox 与内层', () => {
    const markup =
      '<svg fill="currentColor" class="x" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h2"></path></svg>';
    expect(iconSvgOf(markup)).toEqual({
      viewBox: '0 0 24 24',
      content: '<path d="M1 1h2"></path>',
    });
  });

  it('没有 viewBox 或内层为空时不带图标', () => {
    expect(iconSvgOf('<svg width="24"><path d="M0 0"/></svg>')).toBeUndefined();
    expect(iconSvgOf('<svg viewBox="0 0 24 24"></svg>')).toBeUndefined();
    expect(iconSvgOf('')).toBeUndefined();
  });
});
