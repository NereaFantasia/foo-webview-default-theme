import { describe, expect, it } from 'vitest';
import {
  anchorRatio,
  LYRICS_BASE_SIZE,
  lyricsFontSize,
  scaleDisplay,
} from '../../../../src/immersive/lyrics-column/lyricsLayout.ts';
import { DEFAULT_LYRICS_DISPLAY } from '../../../../src/lyrics/lyricsDisplay.ts';

describe('lyricsFontSize', () => {
  it('宽栏取档上限：1280 宽的 0.55 栏约 704，800 高 36、600 高 28、不到 466 取 22', () => {
    expect(lyricsFontSize('large', 704)).toBe(36);
    expect(lyricsFontSize('medium', 704)).toBe(28);
    expect(lyricsFontSize('small', 704)).toBe(22);
  });

  it('窄栏按栏宽放得下 12 个字取小', () => {
    // (560 − 112) ÷ 12 = 37.3，仍是档上限
    expect(lyricsFontSize('large', 560)).toBe(36);
    // (500 − 112) ÷ 12 = 32.3
    expect(lyricsFontSize('large', 500)).toBe(32);
    // (440 − 112) ÷ 12 = 27.3，比 medium 的 28 小
    expect(lyricsFontSize('medium', 440)).toBe(27);
  });

  it('不小于 22', () => {
    expect(lyricsFontSize('large', 300)).toBe(22);
    expect(lyricsFontSize('large', 0)).toBe(22);
    expect(lyricsFontSize('medium', 112)).toBe(22);
  });

  it('档上限随档递减', () => {
    expect(LYRICS_BASE_SIZE.large).toBeGreaterThan(LYRICS_BASE_SIZE.medium);
    expect(LYRICS_BASE_SIZE.medium).toBeGreaterThan(LYRICS_BASE_SIZE.small);
  });
});

describe('anchorRatio', () => {
  it('比例乘栏高就是当前行上沿距窗口顶：800 高 300，600 高 240，400 高 180', () => {
    expect(anchorRatio(800) * 800).toBeCloseTo(300, 6);
    expect(anchorRatio(600) * 600).toBeCloseTo(240, 6);
    expect(anchorRatio(400) * 400).toBeCloseTo(180, 6);
  });

  it('超高的窗口比例趋近 0.3，还没量到栏高时取 0.3', () => {
    expect(anchorRatio(6000)).toBeCloseTo(0.31, 6);
    expect(anchorRatio(0)).toBe(0.3);
  });
});

describe('scaleDisplay', () => {
  it('用户没改过字号（22）时歌词字号就是版式字号，译文字号没设不动', () => {
    const scaled = scaleDisplay(DEFAULT_LYRICS_DISPLAY, 36);
    expect(scaled.fontSize).toBe(36);
    expect(scaled.translationFontSize).toBeNull();
  });

  it('改过的字号与译文字号同比放大或缩小，其余设置原样', () => {
    const display = { ...DEFAULT_LYRICS_DISPLAY, fontSize: 28, translationFontSize: 14 };
    const scaled = scaleDisplay(display, 33);
    expect(scaled.fontSize).toBeCloseTo(42, 6);
    expect(scaled.translationFontSize).toBeCloseTo(21, 6);
    expect(scaled.showTranslation).toBe(display.showTranslation);
    expect(scaled.fontFamily).toBe(display.fontFamily);
    expect(scaleDisplay(display, 22)).toEqual(display);
  });
});
