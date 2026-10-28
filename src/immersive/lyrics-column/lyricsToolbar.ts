import { LYRICS_FONT_SIZE_RANGE } from '../../lyrics/lyricsDisplay.ts';
import type { LyricsContent } from '../../lyrics/lyricsText.ts';

/** 展开为双行工具块的宽度阈值（CSS 像素） */
export const TOOLBAR_WIDE_MIN = 576;
/** 单行展开与紧凑折叠的临界宽度阈值（CSS 像素） */
export const TOOLBAR_MEDIUM_MIN = 258;

/** 双行工具条高度（CSS 像素）；单行与搜索状态下高度为 40px */
export const TOOLBAR_HEIGHT = 72;

/** 搜索结果面板与工具条间隙及视口底部留白（CSS 像素） */
const RESULTS_GAP = 4;
const RESULTS_BOTTOM = 16;

/** 计算搜索结果浮层可用最大高度 */
export function toolbarRoomOf(columnHeight: number, top: number): number {
  return Math.max(0, columnHeight - top - TOOLBAR_HEIGHT - RESULTS_GAP - RESULTS_BOTTOM);
}

export type ToolbarForm = 'wide' | 'medium' | 'narrow';

export function toolbarFormOf(width: number): ToolbarForm {
  if (width >= TOOLBAR_WIDE_MIN) return 'wide';
  return width >= TOOLBAR_MEDIUM_MIN ? 'medium' : 'narrow';
}

/** 歌词字号单步调节步长（CSS 像素） */
export const FONT_SIZE_STEP = 2;

/** 按步长增减字号并钳制在有效极值范围内 */
export function stepFontSize(size: number, steps: number): number {
  const { min, max } = LYRICS_FONT_SIZE_RANGE;
  return Math.min(max, Math.max(min, size + steps * FONT_SIZE_STEP));
}

/** 歌词时间轴校正上下限（秒），与存储约束对齐 */
const OFFSET_LIMIT = 600;

/** 步进调整时间轴校正值并四舍五入至 0.1 秒，避免浮点累积误差 */
export function stepOffset(offset: number, delta: number): number {
  const next = Math.round((offset + delta) * 10) / 10;
  return Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, next));
}

/** 格式化时间轴校正偏移文案，显式标注正负符号并附带秒单位 */
export function formatOffset(offset: number): string {
  const sign = offset > 0 ? '+' : offset < 0 ? '−' : '';
  return `${sign}${Number(Math.abs(offset).toFixed(2))} s`;
}

/**
 * 歌词工具栏各功能控件可用性目标
 *
 * 依据歌词形态（纯文本/逐行/逐字）及是否存在译文、音译轨道计算可用性；不可用控件置灰保留占位以保持布局稳定
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
