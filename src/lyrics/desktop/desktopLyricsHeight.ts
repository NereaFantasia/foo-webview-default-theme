import type { LyricLine } from '@applemusic-like-lyrics/core';

/** 单行模式下主句与副行每项最多保留的折行行数；超出部分由样式截断 */
export const SINGLE_MAX_ROWS = 2;

/** 单行模式下 AMLL 播放器容器两侧的内边距，单位 CSS 像素；用于与播放器同步可用排版宽度 */
export const SINGLE_PADDING_X = 16;

// AMLL 主句行高为 1.2 倍字号，副行行高为 1.5 倍副行字号；音译字号为正文的 0.5 倍且不小于 10px
const MAIN_LINE_HEIGHT = 1.2;
const SUB_LINE_HEIGHT = 1.5;
const ROMAN_SCALE = 0.5;
const ROMAN_MIN_SIZE = 10;
// 单行容器自身的四周边距各取 0.2 倍字号
const LINE_INSET = 0.4;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/** 测量指定字号下文本宽度的函数契约，单位 CSS 像素 */
export type MeasureText = (text: string, fontSize: number) => number;

/** 计算桌面歌词译文字号：固定为正文字号的 0.6 倍，单位 CSS 像素 */
export function translationFontSizeOf(fontSize: number): number {
  return Math.round(fontSize * 0.6);
}

/** 计算单行歌词文本的实际可用排版宽度：总宽度扣除容器两端边距与行内边距 */
export function textWidthOf(width: number, fontSize: number): number {
  return width - SINGLE_PADDING_X * 2 - fontSize * LINE_INSET;
}

/** 贪心分词计算文本在指定宽度下的折行数；行首忽略空白符，单词超宽按一行计 */
export function wrappedRows(
  text: string,
  width: number,
  measure: (segment: string) => number,
): number {
  let rows = 1;
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const size = measure(segment);
    if (segment.trim() === '') {
      if (used > 0) used += size;
    } else if (used > 0 && used + size > width) {
      rows += 1;
      used = size;
    } else used += size;
  }
  return rows;
}

export interface SingleRowsInput {
  readonly lines: readonly LyricLine[];
  readonly fontSize: number;
  /** 译文字号，单位 CSS 像素 */
  readonly translationFontSize: number;
  readonly showTranslation: boolean;
  readonly showRomanization: boolean;
  /** 窗口宽度，单位 CSS 像素 */
  readonly width: number;
  readonly measure: MeasureText;
}

/**
 * 计算单行模式下因折行超出基础单行高度所需的额外窗口高度，单位 CSS 像素
 * 取全曲最高句计算固定高度，保证切句时窗口高度平稳；不显示背景行，各文本段最大折行数受 SINGLE_MAX_ROWS 约束
 */
export function singleExtraHeight(input: SingleRowsInput): number {
  const { fontSize, translationFontSize, width, measure } = input;
  const available = textWidthOf(width, fontSize);
  if (available <= 0) return 0;
  const romanSize = Math.max(fontSize * ROMAN_SCALE, ROMAN_MIN_SIZE);
  const extraRows = (text: string, size: number) => {
    if (text.trim() === '') return 0;
    const rows = wrappedRows(text, available, (segment) => measure(segment, size));
    return Math.min(SINGLE_MAX_ROWS, rows) - 1;
  };
  let worst = 0;
  for (const line of input.lines) {
    if (line.isBG) continue;
    let extra =
      extraRows(line.words.map((word) => word.word).join(''), fontSize) *
      fontSize *
      MAIN_LINE_HEIGHT;
    if (input.showTranslation)
      extra +=
        extraRows(line.translatedLyric, translationFontSize) *
        translationFontSize *
        SUB_LINE_HEIGHT;
    if (input.showRomanization)
      extra += extraRows(line.romanLyric, romanSize) * romanSize * SUB_LINE_HEIGHT;
    worst = Math.max(worst, extra);
  }
  return Math.ceil(worst);
}

/** 基于 Canvas 2D 上下文测量文本排版宽度；上下文不可用时按单字等宽宽松估算 */
export function canvasMeasure(family: string): MeasureText {
  const context = document.createElement('canvas').getContext('2d');
  return (text, fontSize) => {
    if (!context) return text.length * fontSize;
    context.font = `${fontSize}px ${family}`;
    return context.measureText(text).width;
  };
}
