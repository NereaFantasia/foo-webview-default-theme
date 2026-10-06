import { argbFromHex, Contrast, Hct, lstarFromArgb } from '@material/material-color-utilities';
import { describe, expect, it } from 'vitest';
import { PLAY_BUTTON_STYLES, playButtonColors } from '../../../src/theme/playButtonColors.ts';

describe('主播放按钮颜色', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const style of PLAY_BUTTON_STYLES) {
      it(`${scheme} ${style} 的文字与图标在各交互态均达到 4.5:1`, () => {
        for (let hue = 0; hue < 360; hue += 30) {
          for (const chroma of [0, 8, 36, 100]) {
            for (const tone of [0, 5, 25, 50, 75, 95, 100]) {
              const color = Hct.from(hue, chroma, tone);
              const states = playButtonColors(
                { argb: color.toInt(), hue: color.hue, chroma: color.chroma, tone: color.tone },
                scheme,
                style,
              );
              for (const state of Object.values(states)) {
                const background = lstarFromArgb(argbFromHex(state.background));
                for (const foreground of [state.foreground, state.icon]) {
                  expect(
                    Contrast.ratioOfTones(background, lstarFromArgb(argbFromHex(foreground))),
                  ).toBeGreaterThanOrEqual(4.5);
                }
              }
            }
          }
        }
      });
    }
  }
  it('原色保持原始底色，柔和只降低派生色板彩度', () => {
    const color = Hct.fromInt(argbFromHex('#cc2255'));
    const accent = { argb: color.toInt(), hue: color.hue, chroma: color.chroma, tone: color.tone };
    expect(playButtonColors(accent, 'dark', 'raw').rest.background).toBe('#cc2255');
    const soft = playButtonColors(accent, 'dark', 'soft');
    expect(Hct.fromInt(argbFromHex(soft.rest.background)).chroma).toBeLessThanOrEqual(37);
    expect(Hct.fromInt(argbFromHex(soft.rest.background)).tone).toBeCloseTo(85, 0);
  });
});
