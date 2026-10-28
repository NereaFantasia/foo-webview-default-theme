import { describe, expect, it } from 'vitest';
import {
  FONT_SIZE_STEP,
  TOOLBAR_HEIGHT,
  formatOffset,
  stepFontSize,
  stepOffset,
  toolbarFormOf,
  toolbarRoomOf,
  toolbarSubjectsOf,
} from '../../../../src/immersive/lyrics-column/lyricsToolbar.ts';
import type { LyricsContent } from '../../../../src/lyrics/lyricsText.ts';

const line = (translatedLyric = '', romanLyric = '') => ({
  words: [{ word: 'a', startTime: 0, endTime: 1, obscene: false, romanWord: '' }],
  translatedLyric,
  romanLyric,
  startTime: 0,
  endTime: 1,
  isBG: false,
  isDuet: false,
});

describe('工具条的排法档位', () => {
  it('条宽 576 以上排成两格高的块，258 到 576 收成一行图标，不到 258 收进更多', () => {
    expect(toolbarFormOf(592)).toBe('wide');
    expect(toolbarFormOf(576)).toBe('wide');
    expect(toolbarFormOf(575)).toBe('medium');
    expect(toolbarFormOf(258)).toBe('medium');
    expect(toolbarFormOf(257)).toBe('narrow');
  });

  it('分栏预设里窗宽 1280 是宽档，1251 是宽档的下限，700 是窄窗里仍有侧栏的下限（栏占后 0.55，扣左右边距 112）', () => {
    const barWidth = (windowWidth: number) => Math.min(0.55 * windowWidth - 112, 760);
    expect(toolbarFormOf(barWidth(1280))).toBe('wide');
    expect(toolbarFormOf(barWidth(1251))).toBe('wide');
    expect(toolbarFormOf(barWidth(1250))).toBe('medium');
    expect(toolbarFormOf(barWidth(700))).toBe('medium');
  });
});

describe('字号步进', () => {
  it('每次 2 px，夹在 12 到 48 之间', () => {
    expect(FONT_SIZE_STEP).toBe(2);
    expect(stepFontSize(22, 1)).toBe(24);
    expect(stepFontSize(22, -1)).toBe(20);
    expect(stepFontSize(12, -1)).toBe(12);
    expect(stepFontSize(48, 1)).toBe(48);
    expect(stepFontSize(47, 1)).toBe(48);
  });

  it('一次几格（滚轮）按格数算，夹在范围内', () => {
    expect(stepFontSize(22, 3)).toBe(28);
    expect(stepFontSize(22, -2)).toBe(18);
    expect(stepFontSize(46, 5)).toBe(48);
    expect(stepFontSize(14, -5)).toBe(12);
  });
});

describe('时间校正步进', () => {
  it('反复加 0.1 秒不留浮点尾巴', () => {
    let offset = 0;
    for (let i = 0; i < 3; i += 1) offset = stepOffset(offset, 0.1);
    expect(offset).toBe(0.3);
    expect(stepOffset(0.3, -0.5)).toBe(-0.2);
  });

  it('夹在 ±600 秒之间', () => {
    expect(stepOffset(599.9, 0.5)).toBe(600);
    expect(stepOffset(-599.9, -0.5)).toBe(-600);
  });

  it('设置页里写过的百分位取整到 0.1', () => {
    expect(stepOffset(0.25, 0.1)).toBe(0.4);
  });

  it('写法：正数带加号，负数用减号，零不带符号', () => {
    expect(formatOffset(0.3)).toBe('+0.3 s');
    expect(formatOffset(-1.5)).toBe('−1.5 s');
    expect(formatOffset(0)).toBe('0 s');
    expect(formatOffset(0.25)).toBe('+0.25 s');
  });
});

describe('控件的对象', () => {
  it('没有歌词：都不可用', () => {
    expect(toolbarSubjectsOf(null)).toEqual({
      font: false,
      align: false,
      timing: false,
      translation: false,
      romanization: false,
    });
  });

  it('纯文本：只有字号与对齐可用', () => {
    const content: LyricsContent = { kind: 'plain', lines: ['第一行'] };
    expect(toolbarSubjectsOf(content)).toEqual({
      font: true,
      align: true,
      timing: false,
      translation: false,
      romanization: false,
    });
  });

  it('带时间轴：字号与校正可用，译文、音译看有没有内容', () => {
    const plain: LyricsContent = { kind: 'synced', lines: [line(), line('  ')] };
    expect(toolbarSubjectsOf(plain)).toMatchObject({
      font: true,
      align: true,
      timing: true,
      translation: false,
      romanization: false,
    });
    const both: LyricsContent = { kind: 'synced', lines: [line(), line('译', 'yi')] };
    expect(toolbarSubjectsOf(both)).toMatchObject({ translation: true, romanization: true });
  });
});

describe('搜索结果面板的高度', () => {
  it('栏高扣掉条的上沿、条高、间隔与底部留白，不为负', () => {
    expect(toolbarRoomOf(800, 64)).toBe(800 - 64 - TOOLBAR_HEIGHT - 4 - 16);
    expect(toolbarRoomOf(100, 64)).toBe(0);
  });
});
