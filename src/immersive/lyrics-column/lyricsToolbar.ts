import { LYRICS_SCALE_RANGE } from '../../lyrics/lyricsDisplay.ts';
import type { LyricsContent } from '../../lyrics/lyricsText.ts';

/** 工具条宽度达到该值（CSS 像素）时为宽档，控件显示为双行磁贴 */
export const TOOLBAR_WIDE_MIN = 576;
/** 工具条宽度达到该值（CSS 像素）时为中档，低于该值为窄档 */
export const TOOLBAR_MEDIUM_MIN = 258;

/** 宽档工具条的高度（CSS 像素）。中档、窄档与搜索时高度为 40 px */
export const TOOLBAR_HEIGHT = 72;

/** 搜索结果面板与工具条的间距，以及面板与歌词栏底边的留白（CSS 像素） */
const RESULTS_GAP = 4;
const RESULTS_BOTTOM = 16;

/** 搜索结果面板可用的最大高度（CSS 像素），按宽档工具条的高度预留 */
export function toolbarRoomOf(columnHeight: number, top: number): number {
  return Math.max(0, columnHeight - top - TOOLBAR_HEIGHT - RESULTS_GAP - RESULTS_BOTTOM);
}

export type ToolbarForm = 'wide' | 'medium' | 'narrow';

export function toolbarFormOf(width: number): ToolbarForm {
  if (width >= TOOLBAR_WIDE_MIN) return 'wide';
  return width >= TOOLBAR_MEDIUM_MIN ? 'medium' : 'narrow';
}

/** 按缩放步长增减百分比，结果限制在 `LYRICS_SCALE_RANGE` 内 */
export function stepScale(percent: number, steps: number): number {
  const { min, max, step } = LYRICS_SCALE_RANGE;
  return Math.min(max, Math.max(min, percent + steps * step));
}

/** 时间校正值的上下限（秒），与存储允许的范围一致 */
const OFFSET_LIMIT = 600;

/** 步进调整时间校正值。结果四舍五入到 0.1 秒以免浮点误差累积，并限制在 `OFFSET_LIMIT` 内 */
export function stepOffset(offset: number, delta: number): number {
  const next = Math.round((offset + delta) * 10) / 10;
  return Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, next));
}

/** 时间校正值的显示文字：非零值带正负号，单位为秒，最多两位小数 */
export function formatOffset(offset: number): string {
  const sign = offset > 0 ? '+' : offset < 0 ? '−' : '';
  return `${sign}${Number(Math.abs(offset).toFixed(2))} s`;
}

/**
 * 工具条各控件是否可用，按当前歌词的形态及是否有译文、音译计算。
 * 不可用的控件禁用但保留占位，布局保持稳定
 */
export interface ToolbarSubjects {
  readonly font: boolean;
  readonly align: boolean;
  readonly timing: boolean;
  readonly translation: boolean;
  readonly romanization: boolean;
}

export function toolbarSubjectsOf(content: LyricsContent | null): ToolbarSubjects {
  if (!content)
    return { font: false, align: false, timing: false, translation: false, romanization: false };
  if (content.kind === 'plain')
    return { font: true, align: true, timing: false, translation: false, romanization: false };
  const lines = content.lines;
  return {
    font: true,
    align: true,
    timing: true,
    translation: lines.some((line) => line.translatedLyric.trim() !== ''),
    romanization: lines.some((line) => line.romanLyric.trim() !== ''),
  };
}
