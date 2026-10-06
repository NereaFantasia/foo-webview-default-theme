import { describe, expect, it } from 'vitest';
import {
  attachLineTexts,
  isWordLevel,
  parseLyricsText,
  type LyricsContent,
} from '../../../src/lyrics/lyricsText.ts';

/** 带时间轴的结果摊成「开始时间、正文、译文、音译」四元组，便于逐行比对。 */
function rows(content: LyricsContent | null) {
  if (content?.kind !== 'synced') return content;
  return content.lines.map((line) => [
    line.startTime,
    line.words.map((word) => word.word).join(''),
    line.translatedLyric,
    line.romanLyric,
  ]);
}

describe('parseLyricsText', () => {
  it('重复时间码展开、乱序排序，秒与小数精度保留，支持一百分钟', () => {
    const content = parseLyricsText(
      '[00:20.00][00:05.50]副歌\n[00:10]主歌\n[01:02]a\n[01:02.5]b\n[01:02.125]c\n[100:00.00]d',
    );
    expect(content?.kind).toBe('synced');
    if (content?.kind !== 'synced') return;
    expect(content.lines.map((line) => line.startTime)).toEqual([
      5500, 10000, 20000, 62000, 62125, 62500, 6000000,
    ]);
  });

  it('间奏空行记为前一句结束时间，没有时间码的夹杂行不进同步词', () => {
    const content = parseLyricsText('作词：某人\n[00:01]一\n[00:04]\n[00:09]二\n[00:12]');
    if (content?.kind !== 'synced') throw new Error('缺少同步歌词');
    expect(content.lines.map((line) => [line.startTime, line.endTime])).toEqual([
      [1000, 4000],
      [9000, 12000],
    ]);
  });

  it('同一时间码的第二行并进译文，第三行进音译，再往后不认', () => {
    const text = [
      '[00:01.00]Hello',
      '[00:01.00]你好',
      '[00:01.00]ni hao',
      '[00:01.00]多出来的一行',
      '[00:04.00]Bye',
    ].join('\n');
    expect(rows(parseLyricsText(text))).toStrictEqual([
      [1000, 'Hello', '你好', 'ni hao'],
      [4000, 'Bye', '', ''],
    ]);
  });

  it('同码第一条是空行时，有字的那条才是正文', () => {
    const text = '[00:01.00]\n[00:01.00]正文\n[00:01.00]译文';
    expect(rows(parseLyricsText(text))).toStrictEqual([[1000, '正文', '译文', '']]);
  });

  it('增强 LRC 留着逐字时间', () => {
    const content = parseLyricsText('[00:01.00]<00:01.00>Hel<00:01.40>lo<00:02.00>');
    expect(content?.kind).toBe('synced');
    if (content?.kind !== 'synced') return;
    expect(content.lines[0]?.words.map((word) => [word.startTime, word.word])).toStrictEqual([
      [1000, 'Hel'],
      [1400, 'lo'],
    ]);
  });

  it('[offset:] 不应用，元数据行不进歌词', () => {
    const text = '[ti:标题]\n[offset:500]\n[00:02.00]一';
    expect(rows(parseLyricsText(text))).toStrictEqual([[2000, '一', '', '']]);
  });

  it('通篇没有时间码按纯文本，跳过空行与元数据行', () => {
    expect(parseLyricsText('[ar:某人]\n第一行\n\n  第二行  \n')).toStrictEqual({
      kind: 'plain',
      lines: ['第一行', '第二行'],
    });
  });

  it('解析不出一行字时答 null', () => {
    for (const text of ['', '   \n\n', '[ar:某人]\n[ti:标题]', '[00:01.00]\n[00:02.00]'])
      expect(parseLyricsText(text)).toBeNull();
  });
});

describe('attachLineTexts', () => {
  const synced = (text: string) => {
    const content = parseLyricsText(text);
    return content?.kind === 'synced' ? content.lines : [];
  };

  it('译文配给行首时间最近、相差不超过 1 秒的行，每行只配一次', () => {
    const lines = synced('[00:01.00]一\n[00:05.00]二\n[00:09.00]三');
    const merged = attachLineTexts(
      lines,
      '[00:01.03]one\n[00:05.00]two\n[00:05.20]extra',
      'translatedLyric',
    );
    expect(merged.map((line) => line.translatedLyric)).toStrictEqual(['one', 'two', '']);
  });

  it('差过 1 秒的不配，「//」占位不并，原数组不改', () => {
    const lines = synced('[00:01.00]一\n[00:05.00]二');
    const merged = attachLineTexts(lines, '[00:03.00]far\n[00:05.00]//', 'romanLyric');
    expect(merged.map((line) => line.romanLyric)).toStrictEqual(['', '']);
    expect(lines.every((line) => line.romanLyric === '')).toBe(true);
  });
});

describe('isWordLevel', () => {
  it('至少一行带不止一个字的时间才算逐字', () => {
    const line = parseLyricsText('[00:01.00]整行');
    const word = parseLyricsText('[00:01.00]<00:01.00>逐<00:01.50>字<00:02.00>');
    const plain = parseLyricsText('纯文本');
    expect(
      [line, word, plain].map((content) => content !== null && isWordLevel(content)),
    ).toStrictEqual([false, true, false]);
  });
});
