import { webDarkTheme, webLightTheme } from '@fluentui/react-components';
import {
  argbFromHex,
  Blend,
  Contrast,
  Hct,
  hexFromArgb,
  lstarFromArgb,
  TonalPalette,
} from '@material/material-color-utilities';
import { rampFrom } from './brandRamp.ts';
import type { CoverTone } from './coverPalette.ts';
import type { ColorScheme } from './themes.ts';

export const PLAY_BUTTON_STYLES = ['brand', 'soft', 'raw', 'tonal', 'neutral'] as const;
export type PlayButtonStyle = (typeof PLAY_BUTTON_STYLES)[number];
export interface PlayButtonColors {
  readonly background: string;
  readonly foreground: string;
  readonly icon: string;
}
export interface PlayButtonStates {
  readonly rest: PlayButtonColors;
  readonly hover: PlayButtonColors;
  readonly pressed: PlayButtonColors;
}

const BLACK = Hct.from(0, 0, 0).toInt();
const WHITE = Hct.from(0, 0, 100).toInt();

function contrast(first: number, second: number): number {
  return Contrast.ratioOfTones(lstarFromArgb(first), lstarFromArgb(second));
}

function readable(preferred: number, background: number): number {
  if (contrast(preferred, background) >= 4.5) return preferred;
  const source = Hct.fromInt(preferred);
  const tone = lstarFromArgb(background);
  const target = tone > 50 ? Contrast.darker(tone, 4.6) : Contrast.lighter(tone, 4.6);
  if (target >= 0) {
    const adjusted = Hct.from(source.hue, source.chroma, target).toInt();
    if (contrast(adjusted, background) >= 4.5) return adjusted;
  }
  return contrast(BLACK, background) >= contrast(WHITE, background) ? BLACK : WHITE;
}

/** 原色按钮只改变交互态明度；字色确定后，底色朝对比度更高的一端移动。 */
export function playButtonColors(
  accent: CoverTone,
  scheme: ColorScheme,
  style: PlayButtonStyle,
): PlayButtonStates {
  const dark = scheme === 'dark';
  const theme = dark ? webDarkTheme : webLightTheme;
  const palette = TonalPalette.fromHueAndChroma(accent.hue, accent.chroma);
  const soft = TonalPalette.fromHueAndChroma(accent.hue, Math.min(accent.chroma, 36));
  const neutral = argbFromHex(theme.colorNeutralBackground1);
  let background: number;
  let foreground: number;
  if (style === 'soft') {
    background = soft.tone(dark ? 85 : 92);
    foreground = soft.tone(dark ? 22 : 32);
  } else if (style === 'raw') {
    background = accent.argb;
    foreground = readable(WHITE, background);
    if (contrast(BLACK, background) > contrast(WHITE, background)) foreground = BLACK;
  } else if (style === 'brand') {
    const yellow = !dark && accent.hue >= 70 && accent.hue <= 120 && accent.tone >= 70;
    background = yellow ? accent.argb : argbFromHex(rampFrom(accent)[dark ? 70 : 80]);
    foreground = yellow ? BLACK : WHITE;
  } else if (style === 'tonal') {
    background = Blend.cam16Ucs(neutral, accent.argb, 0.18);
    foreground = palette.tone(dark ? 80 : 35);
  } else {
    background = neutral;
    foreground = argbFromHex(theme.colorNeutralForeground1);
  }
  foreground = readable(foreground, background);
  const base = Hct.fromInt(background);
  const direction = lstarFromArgb(foreground) > lstarFromArgb(background) ? -1 : 1;
  const state = (step: number): PlayButtonColors => {
    const bg =
      step === 0
        ? background
        : Hct.from(base.hue, base.chroma, base.tone + direction * step).toInt();
    const fg = readable(foreground, bg);
    return {
      background: hexFromArgb(bg),
      foreground: hexFromArgb(fg),
      icon: hexFromArgb(style === 'neutral' ? readable(accent.argb, bg) : fg),
    };
  };
  return { rest: state(0), hover: state(4), pressed: state(8) };
}
