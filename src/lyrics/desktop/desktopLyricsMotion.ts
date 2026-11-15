import { LYRICS_MOTION_PRESET_VALUES, type LyricsMotion } from '../lyricsMotion.ts';
import type { DesktopLyricsMotionPreset, DesktopMotionCustom } from './desktopLyricsPrefs.ts';

/** 切到「自定义」时的起点：当前预设的这四项，当前行位置照桌面固定的居中 */
export function motionCustomFrom(
  preset: Exclude<DesktopLyricsMotionPreset, 'custom'>,
): DesktopMotionCustom {
  const { blur, scale, hidePassedLines } = LYRICS_MOTION_PRESET_VALUES[preset];
  return { blur, scale, hidePassedLines, alignPosition: 0.5 };
}

/**
 * 桌面歌词的动效：当前行固定居中。单行窗口只放得下当前句，已唱行隐藏、不缩放，
 * 自定义的四项只对多行生效：单行一律不读它们，自定义档在单行下的表现就是 AMLL 档
 */
export function desktopMotion(
  single: boolean,
  preset: DesktopLyricsMotionPreset,
  custom: DesktopMotionCustom,
): LyricsMotion {
  const base = LYRICS_MOTION_PRESET_VALUES[preset === 'custom' ? 'amll' : preset];
  if (single) return { ...base, alignPosition: 0.5, hidePassedLines: true, scale: false };
  return preset === 'custom' ? { ...base, ...custom } : { ...base, alignPosition: 0.5 };
}
