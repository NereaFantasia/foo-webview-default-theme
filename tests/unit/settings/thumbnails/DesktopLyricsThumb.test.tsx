import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_LYRICS_BACKGROUNDS,
  DESKTOP_LYRICS_PALETTES,
  type DesktopLyricsBackground,
  type DesktopLyricsPalette,
} from '../../../../src/lyrics/desktop/desktopLyricsPrefs.ts';
import { DesktopLyricsThumb } from '../../../../src/settings/thumbnails/DesktopLyricsThumb.tsx';

const markup = (background: DesktopLyricsBackground, palette: DesktopLyricsPalette) =>
  renderToStaticMarkup(<DesktopLyricsThumb background={background} palette={palette} />);

describe('DesktopLyricsThumb', () => {
  it('背景两张、配色三张各画各的，标记里带各自的取值', () => {
    const backgrounds = DESKTOP_LYRICS_BACKGROUNDS.map((value) => markup(value, 'white'));
    const palettes = DESKTOP_LYRICS_PALETTES.map((value) => markup('plate', value));
    expect(new Set(backgrounds).size).toBe(2);
    expect(new Set(palettes).size).toBe(3);
    DESKTOP_LYRICS_BACKGROUNDS.forEach((value, index) =>
      expect(backgrounds[index]).toContain(`data-background="${value}"`),
    );
    DESKTOP_LYRICS_PALETTES.forEach((value, index) =>
      expect(palettes[index]).toContain(`data-palette="${value}"`),
    );
  });

  it('只有自定义带取色点；白取静态反白，不写行内色，跟随与自定义才给已唱部分行内色', () => {
    expect(/class="[^"]*_dot_/.test(markup('plate', 'custom'))).toBe(true);
    for (const palette of ['white', 'follow'] as const)
      expect(/class="[^"]*_dot_/.test(markup('plate', palette)), palette).toBe(false);
    expect(markup('plate', 'white')).toMatch(/_sung_[^"]*">/);
    expect(markup('plate', 'follow')).toMatch(/_sung_[^"]*" style="color:/);
    expect(markup('plate', 'custom')).toMatch(/_sung_[^"]*" style="color:/);
  });

  it('形态与真实的歌词窗一致：顶上一排八块迷你工具条，主句加译文两行', () => {
    const html = markup('plate', 'white');
    expect(html.match(/class="[^"]*_(?:key|icon|time)_/g)).toHaveLength(8);
    expect(html).toContain('Keep a lantern');
    expect(html).toMatch(/_sub_[^"]*">[^<]+<\/span>/);
  });
});
