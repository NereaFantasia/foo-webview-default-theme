import type { LyricLine } from '@applemusic-like-lyrics/core';
import { describe, expect, it } from 'vitest';
import {
  SINGLE_MAX_ROWS,
  singleExtraHeight,
  textWidthOf,
  wrappedRows,
} from '../../../../src/lyrics/desktop/desktopLyricsHeight.ts';

// 每个字符宽半个字号，空格同宽
const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5;
const sentence = (chars: number) => 'word '.repeat(Math.ceil(chars / 5)).trim();

function line(text: string, extra: Partial<LyricLine> = {}): LyricLine {
  return {
    words: [{ word: text, startTime: 0, endTime: 1000 }],
    translatedLyric: '',
    romanLyric: '',
    startTime: 0,
    endTime: 1000,
    isBG: false,
    isDuet: false,
    ...extra,
  };
}

const base = {
  fontSize: 34,
  translationFontSize: 20,
  showTranslation: true,
  showRomanization: false,
  width: 1088,
  measure,
};

describe('单行歌词按词排几行', () => {
  const ten = (text: string) => text.length * 10;

  it('一行放得下就是一行，空格不占行首', () => {
    expect(wrappedRows('aaa bbb', 100, ten)).toBe(1);
    expect(wrappedRows('', 100, ten)).toBe(1);
  });

  it('放不下的词换到下一行', () => {
    expect(wrappedRows('aaa bbb ccc', 80, ten)).toBe(2);
    expect(wrappedRows('aaa bbb ccc ddd eee', 80, ten)).toBe(3);
  });

  it('单个词比一行还宽也只占一行', () => {
    expect(wrappedRows('aaaaaaaaaaaaaaaaaaaa', 50, ten)).toBe(1);
  });
});

describe('单行窗高多出的高度', () => {
  it('可排宽度是窗宽扣掉两侧内边距与行自己的内边距', () => {
    expect(textWidthOf(1088, 34)).toBeCloseTo(1088 - 32 - 13.6, 5);
  });

  it('每句都放得下一行时不多出', () => {
    expect(singleExtraHeight({ ...base, lines: [line('short line'), line('another')] })).toBe(0);
  });

  it('主句换成两行，多出一个主句行高（1.2 倍字号），取全曲最高的一句', () => {
    const lines = [line('short'), line(sentence(100)), line('tail')];
    expect(singleExtraHeight({ ...base, lines })).toBe(Math.ceil(34 * 1.2));
  });

  it('主句最多算两行，再长的句子不继续加高', () => {
    expect(SINGLE_MAX_ROWS).toBe(2);
    expect(singleExtraHeight({ ...base, lines: [line(sentence(400))] })).toBe(Math.ceil(34 * 1.2));
  });

  it('译文换行按译文自己的字号与行高（1.5 倍）算，关掉译文就不算', () => {
    const lines = [line('short', { translatedLyric: sentence(130) })];
    expect(singleExtraHeight({ ...base, lines })).toBe(30);
    expect(singleExtraHeight({ ...base, lines, showTranslation: false })).toBe(0);
  });

  it('音译的字号是正文的一半', () => {
    const lines = [line('short', { romanLyric: sentence(130) })];
    expect(singleExtraHeight({ ...base, lines, showRomanization: true })).toBe(Math.ceil(17 * 1.5));
  });

  it('同一句里主句与译文都换行时各自加上', () => {
    const lines = [line(sentence(100), { translatedLyric: sentence(130) })];
    expect(singleExtraHeight({ ...base, lines })).toBe(Math.ceil(34 * 1.2 + 30));
  });

  it('背景行单行时不显示，不算', () => {
    expect(singleExtraHeight({ ...base, lines: [line(sentence(300), { isBG: true })] })).toBe(0);
  });

  it('窗宽扣完内边距没有剩余时不估', () => {
    expect(singleExtraHeight({ ...base, width: 40, lines: [line(sentence(100))] })).toBe(0);
  });
});
