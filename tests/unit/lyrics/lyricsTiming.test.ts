import type { LyricLine } from '@applemusic-like-lyrics/core';
import { describe, expect, it } from 'vitest';
import { lyricsVersion, readSavedLyrics } from '../../../src/lyrics/lyricsArchive.ts';
import { parseLyricsText } from '../../../src/lyrics/lyricsText.ts';
import { prepareLyricsLines } from '../../../src/lyrics/lyricsTiming.ts';

function parse(text: string): readonly LyricLine[] {
  const content = parseLyricsText(text);
  if (content?.kind !== 'synced') throw new Error('缺少同步歌词');
  return content.lines;
}

const MISSING_END = [
  '[00:23.65]<00:23.61>前半句<00:25.12>末词',
  '[00:23.65]译文',
  '[00:24.82]<00:26.27>下一句<00:29.00>',
].join('\n');

describe('prepareLyricsLines', () => {
  it.each([
    ['[00:23.65]<00:23.61>甲<00:25.12>乙\n[00:24.82]<00:26.27>丙<00:29.00>', 25120, 26270],
    ['[01:07.13]<01:07.41>甲<01:09.09>乙\n[01:09.06]<01:09.53>丙<01:11.00>', 69090, 69530],
    ['[01:13.21]<01:14.31>甲<01:16.97>乙\n[01:16.89]<01:17.38>丙<01:20.00>', 76970, 77380],
    ['[01:29.18]<01:29.28>甲<01:33.18>乙\n[01:32.11]<01:33.51>丙<01:36.00>', 93180, 93510],
  ])('缺失的末词结束时间使用下一行有效首词时间：%s', (text, start, end) => {
    const lines = parse(text);
    const original = structuredClone(lines);
    const prepared = prepareLyricsLines(lines);
    expect(prepared?.[0]?.words.at(-1)).toMatchObject({ startTime: start, endTime: end });
    expect(prepared?.[0]?.endTime).toBe(end);
    expect(prepared?.[1]).toEqual(lines[1]);
    expect(lines).toEqual(original);
  });

  it('保留译文和存档版本身份，显示副本的修改不回写原数据', () => {
    const stored = {
      status: 'ready',
      key: 'song',
      source: 'embedded',
      content: { kind: 'synced', lines: parse(MISSING_END) },
    };
    const original = JSON.stringify(stored);
    const restored = readSavedLyrics(original);
    if (!restored || restored.content.kind !== 'synced') throw new Error('存档未恢复');
    const identity = lyricsVersion(restored);
    const prepared = prepareLyricsLines(restored.content.lines);
    expect(prepared?.[0]?.translatedLyric).toBe('译文');
    expect(prepared?.[0]?.words.at(-1)?.endTime).toBe(26270);
    expect(lyricsVersion(restored)).toBe(identity);
    expect(JSON.stringify(stored)).toBe(original);
    const word = prepared?.[0]?.words[0];
    if (!word) throw new Error('缺少词');
    word.word = '显示副本';
    expect(restored.content.lines[0]?.words[0]?.word).toBe('前半句');
  });

  it('正常时间、行首与首词不同、明确间奏以及零时长均保持原样', () => {
    for (const text of [
      '[00:09]<00:10>甲<00:11>乙<00:12>\n[00:20]丙',
      '[00:10.50]<00:10>甲<00:11>乙<00:12>',
      '[00:10]<00:10>甲<00:10>乙<00:10>',
      '[00:01]前奏\n[00:04]\n[00:09]下一句\n[00:12]',
    ]) {
      const source = parse(text);
      expect(prepareLyricsLines(source)).toEqual(source);
    }
  });

  it('合法重叠、背景人声、对唱与注音保持原样，并深拷贝注音', () => {
    const source = structuredClone(parse('[00:01]<00:01>甲<00:03>乙<00:05>\n[00:04]丙'));
    const line = source[0];
    const word = line?.words[0];
    if (!line || !word) throw new Error('缺少词');
    line.isBG = true;
    line.isDuet = true;
    word.ruby = [{ startTime: 1000, endTime: 3000, word: '注音' }];
    word.romanWord = 'jia';
    word.obscene = true;
    const prepared = prepareLyricsLines(source);
    expect(prepared).toEqual(source);
    expect(prepared?.[0]?.words[0]?.ruby).not.toBe(word.ruby);
  });

  it('只有行的起止倒序时，从有效的首末词恢复行边界', () => {
    const prepared = prepareLyricsLines(parse('[00:15]<00:10>甲<00:11>乙<00:12>'));
    expect(prepared?.[0]).toMatchObject({ startTime: 10000, endTime: 12000 });
  });

  it('不跨人声角色猜末词结束时间', () => {
    for (const flag of ['isBG', 'isDuet'] as const) {
      const source = structuredClone(parse(MISSING_END));
      const next = source[1];
      if (!next) throw new Error('缺少下一行');
      next[flag] = true;
      expect(prepareLyricsLines(source)).toBeNull();
    }
  });

  it('词内倒序或下一行不能提供更晚边界时显示文字', () => {
    expect(prepareLyricsLines(parse('[00:10]<00:10>甲<00:09>乙<00:12>'))).toBeNull();
    expect(prepareLyricsLines(parse('[00:10]<00:10>甲<00:15>乙\n[00:12]丙'))).toBeNull();
  });

  it.each([NaN, Infinity, -1])('拒绝非有限或负时间：%s', (time) => {
    const source = structuredClone(parse('[00:01]正文\n[00:04]尾声'));
    const line = source[0];
    if (!line) throw new Error('缺少行');
    line.startTime = time;
    expect(prepareLyricsLines(source)).toBeNull();
  });

  it('拒绝注音倒序和优化后会倒序的首末词', () => {
    const source = structuredClone(parse('[00:01]<00:01>甲<00:02>乙<00:03>'));
    const word = source[0]?.words[0];
    if (!word) throw new Error('缺少词');
    word.ruby = [{ startTime: 3000, endTime: 2000, word: '注音' }];
    expect(prepareLyricsLines(source)).toBeNull();
    word.ruby = [];
    word.startTime = 4000;
    word.endTime = 5000;
    expect(prepareLyricsLines(source)).toBeNull();
  });
});
