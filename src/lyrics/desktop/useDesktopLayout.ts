import type { LyricLine } from '@applemusic-like-lyrics/core';
import { useEffect, useState, type RefObject } from 'react';
import { canvasMeasure, singleExtraHeight, translationFontSizeOf } from './desktopLyricsHeight.ts';
import type { DesktopLyricsView } from './desktopLyricsLink.ts';
import type { DesktopLyricsPopup } from './desktopLyricsPopup.ts';

/** 桌面歌词工具栏固定高度，单位 CSS 像素 */
export const TOOLBAR = 48;
/** 歌词容器上下内边距，单位 CSS 像素 */
const AREA_PADDING = 16;
const MIN_WIDTH = 416;

/** 计算单行歌词及其副行所需的区块高度，包含上下内边距，单位 CSS 像素 */
function lineBlock(fontSize: number, subLines: number): number {
  const main = fontSize * 1.25;
  const translation = subLines * (fontSize * 0.6 * 1.5 + fontSize * 0.3);
  return Math.ceil(main + translation + AREA_PADDING * 2);
}

export interface DesktopLayoutInput {
  readonly single: boolean;
  readonly locked: boolean;
  readonly multilineSize: DesktopLyricsView['multilineSize'];
  readonly lines: readonly LyricLine[] | null;
  /** 实时测得的歌词渲染区域宽度，单位 CSS 像素；尚未完成首次测量时为 0 */
  readonly lyricsWidth: number;
  readonly fontSize: number;
  readonly showTranslation: boolean;
  readonly showRomanization: boolean;
}

/**
 * 测算并将窗口排版尺寸同步至桌面歌词弹窗服务
 * 多行模式上报单句与副行的最小高度；单行模式则基于当前曲目最高句折行估算增量高度，单曲只重算一次；字体加载完成时触发重测
 */
export function useDesktopLayout(
  popup: DesktopLyricsPopup,
  lyricsBox: RefObject<HTMLElement | null>,
  input: DesktopLayoutInput,
): void {
  const { single, locked, multilineSize, lines, lyricsWidth, fontSize } = input;
  const { showTranslation, showRomanization } = input;
  const [fontsEpoch, setFontsEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) setFontsEpoch((epoch) => epoch + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const block = lineBlock(fontSize, Number(showTranslation) + Number(showRomanization));
    const singleWidth = Math.max(1000, fontSize * 32);
    const player = lyricsBox.current?.querySelector('.amll-lyric-player');
    let extra = 0;
    if (single && lines && player) {
      // 刚切换至单行时视口可能仍保留多行宽度，优先采用单行目标宽度估算
      const width = Math.min(Math.max(lyricsWidth, singleWidth), screen.availWidth || Infinity);
      extra = singleExtraHeight({
        lines,
        fontSize,
        translationFontSize: translationFontSizeOf(fontSize),
        showTranslation,
        showRomanization,
        width,
        measure: canvasMeasure(getComputedStyle(player).fontFamily),
      });
    }
    popup.setLayout(MIN_WIDTH, TOOLBAR + block + extra, singleWidth);
    // multilineSize 不参与高度计算，但属于弹窗服务恢复多行尺寸的依赖依据，变更时需同步上报
  }, [
    popup,
    lyricsBox,
    single,
    locked,
    multilineSize,
    lines,
    lyricsWidth,
    fontSize,
    showTranslation,
    showRomanization,
    fontsEpoch,
  ]);
}
