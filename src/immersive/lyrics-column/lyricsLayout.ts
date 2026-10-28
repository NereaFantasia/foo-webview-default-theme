import { DEFAULT_LYRICS_DISPLAY, type LyricsDisplay } from '../../lyrics/lyricsDisplay.ts';
import { SIDE_EDGE, SIDE_MAX_WIDTH } from '../scene/sideBox.ts';

/** 歌词字号档位枚举 */
export type LyricsSize = 'large' | 'medium' | 'small';

/** 各档位歌词基础字号上限（CSS 像素） */
export const LYRICS_BASE_SIZE: Readonly<Record<LyricsSize, number>> = {
  large: 36,
  medium: 28,
  small: 22,
};

/** 歌词最小字号下限（CSS 像素） */
export const LYRICS_MIN_SIZE = 22;

/** 歌词栏左右边距（CSS 像素），与侧栏公共边距对齐 */
export const LYRICS_EDGE = SIDE_EDGE;

/** 歌词最大排版宽度上限（CSS 像素） */
export const LYRICS_MAX_WIDTH = SIDE_MAX_WIDTH;

/** 当前播放行视心中轴高度比例与像素偏移常量 */
const ANCHOR_RATIO = 0.3;
const ANCHOR_OFFSET = 60;

/** 每行最小容纳字符数基准，用于推算动态字号上限 */
const MIN_CHARS_PER_LINE = 12;

/** 计算容器宽度与档位约束下的最终歌词字号 */
export function lyricsFontSize(size: LyricsSize, columnWidth: number): number {
  const fit = Math.floor((columnWidth - LYRICS_EDGE.start - LYRICS_EDGE.end) / MIN_CHARS_PER_LINE);
  return Math.max(LYRICS_MIN_SIZE, Math.min(LYRICS_BASE_SIZE[size], fit));
}

/** 计算当前行对齐位置在容器高度中的归一化比例 */
export function anchorRatio(columnHeight: number): number {
  return columnHeight > 0 ? ANCHOR_RATIO + ANCHOR_OFFSET / columnHeight : ANCHOR_RATIO;
}

/** 按版式基准字号等比缩放用户偏好的主歌词与译文字号 */
export function scaleDisplay(display: LyricsDisplay, base: number): LyricsDisplay {
  const factor = base / DEFAULT_LYRICS_DISPLAY.fontSize;
  return {
    ...display,
    fontSize: display.fontSize * factor,
    translationFontSize:
      display.translationFontSize === null ? null : display.translationFontSize * factor,
  };
}
