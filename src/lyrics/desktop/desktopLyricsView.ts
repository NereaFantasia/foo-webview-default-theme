import type { BrandVariants } from '@fluentui/react-components';
import type { Translate } from '../../i18n/translate.ts';
import type { FontChoice } from '../../theme/fontStack.ts';
import type { DesktopLyricsProcess, DesktopLyricsView } from './desktopLyricsLink.ts';
import { translationFontSizeOf } from './desktopLyricsHeight.ts';
import { motionCustomFrom } from './desktopLyricsMotion.ts';
import { desktopFontSizeOf, type DesktopLyricsPref } from './desktopLyricsPrefs.ts';

/** 已播放歌词高亮色取色阶 step 120，染色底板取色阶 step 30（设置页缺省值对齐该基准） */
export const DESKTOP_LYRICS_SUNG_STEP = 120;
export const DESKTOP_LYRICS_TINT_STEP = 30;

export interface DesktopLyricsViewInput {
  readonly pref: DesktopLyricsPref;
  /** 跟随主题与封面的强调色 ramp */
  readonly ramp: BrandVariants;
  readonly translate: Translate;
  readonly offset: number;
  readonly track: { readonly title: string; readonly artist: string } | null;
  /** 主窗口在前台，且右侧卡或沉浸视图正显示歌词 */
  readonly shown: boolean;
  readonly process: DesktopLyricsProcess;
  /** 界面字体：弹窗是另一个页面，读不到主窗口的偏好 */
  readonly font: FontChoice;
}

/** 把偏好与主窗口此刻的状态拼成下发给弹窗的显示参数；弹窗不带语言包，文案在这里译好 */
export function desktopLyricsViewOf({
  pref: p,
  ramp,
  translate: t,
  offset,
  track,
  shown,
  process,
  font,
}: DesktopLyricsViewInput): DesktopLyricsView {
  const accent = ramp[DESKTOP_LYRICS_SUNG_STEP];
  const fontSize = desktopFontSizeOf(p);
  return {
    labels: {
      previous: t('player.previous'),
      play: t('player.play'),
      pause: t('player.pause'),
      next: t('player.next'),
      earlier: t('desktopLyrics.earlier'),
      later: t('desktopLyrics.later'),
      align: t('desktopLyrics.alignCycle'),
      mode: t(p.mode === 'multi' ? 'desktopLyrics.toSingle' : 'desktopLyrics.toMulti'),
      lock: t('desktopLyrics.lock'),
      unlock: t('desktopLyrics.unlock'),
      settings: t('desktopLyrics.settings'),
      close: t('desktopLyrics.close'),
    },
    locked: p.locked,
    align: p.align,
    motionPreset: p.motionPreset,
    motionCustom: p.motionCustom ?? motionCustomFrom('amll'),
    mode: p.mode,
    multilineSize: p.multilineSize,
    fontSize,
    translationFontSize: p.translationSize ?? translationFontSizeOf(fontSize),
    font: p.fontFamily,
    fontWeight: p.fontWeight,
    uiFont: font.latin,
    cjkFont: font.cjk,
    sung: p.palette === 'white' ? null : p.palette === 'custom' ? p.sungColor || accent : accent,
    unsung: p.palette === 'custom' ? p.unsungColor || null : null,
    tint: p.plateTint ? ramp[DESKTOP_LYRICS_TINT_STEP] : null,
    plate: p.background === 'plate',
    plateOpacity: p.plateOpacity,
    glow: p.glowColor || null,
    showTranslation: p.showTranslation,
    showRomanization: p.showRomanization,
    offset,
    title: track?.title ?? '',
    artist: track?.artist ?? '',
    hidden: p.autoHide && shown,
    process,
  };
}
