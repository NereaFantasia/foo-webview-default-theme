import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core';
import type { LyricsDisplay } from './lyricsDisplay.ts';

export interface LyricsCue {
  readonly id: string;
  readonly start: number;
  readonly text: string;
  readonly sub: string;
}

interface TimedLine extends LyricsCue {
  readonly end: number;
  readonly background: boolean;
}

function wordText(word: LyricWord, display: LyricsDisplay): string {
  if (!word.obscene || !display.maskMode) return word.word;
  const letters = Array.from(word.word);
  const ink = letters.flatMap((letter, index) => (/\S/u.test(letter) ? [index] : []));
  const partial = display.maskMode === 'partial-mask' && ink.length > 2;
  return letters
    .map((letter, index) =>
      /\s/u.test(letter) || (partial && (index === ink[0] || index === ink.at(-1)))
        ? letter
        : display.maskChar,
    )
    .join('');
}

/** 按歌词时间轴查询，毫秒；endTime也须先扣除播放校正。保留明确空白，不提前显示下一句。 */
export function createLyricsTimeline(
  source: readonly LyricLine[],
  display: LyricsDisplay,
  endTime: number,
) {
  const sorted = source
    .map((line, index) => ({ line, index }))
    .sort((a, b) => a.line.startTime - b.line.startTime);
  const rows: TimedLine[] = sorted.map(({ line, index }, at) => {
    const next = sorted.slice(at + 1).find((item) => item.line.startTime > line.startTime);
    const raw = line.words.map((word) => wordText(word, display)).join('');
    return {
      id: String(index),
      start: line.startTime,
      end: line.endTime > line.startTime ? line.endTime : (next?.line.startTime ?? endTime),
      background: line.isBG,
      text: (display.optimize.normalizeSpaces ? raw.replace(/[ \t]+/g, ' ') : raw).trim(),
      sub:
        (display.showTranslation && line.translatedLyric.trim()) ||
        (display.showRomanization && line.romanLyric.trim()) ||
        '',
    };
  });
  let end = -Infinity;
  const ends = rows.map((row) => (end = Math.max(end, row.end)));
  return {
    hasSub: rows.some((row) => row.sub !== ''),
    at(time: number): LyricsCue | null {
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if ((rows[middle]?.start ?? Infinity) <= time) low = middle + 1;
        else high = middle;
      }
      const active: TimedLine[] = [];
      for (let index = low - 1; index >= 0 && (ends[index] ?? -Infinity) > time; index--) {
        const row = rows[index];
        if (row && time < row.end) active.push(row);
      }
      const main = active.filter((row) => !row.background);
      const pool = main.length ? main : active;
      const first = pool[0];
      if (!first) return null;
      const group = pool.filter((row) => row.start === first.start).reverse();
      const text = group
        .map((row) => row.text)
        .filter(Boolean)
        .join(' / ');
      if (!text) return null;
      return {
        id: group.map((row) => row.id).join(':'),
        start: first.start,
        text,
        sub: group
          .map((row) => row.sub)
          .filter(Boolean)
          .join(' / '),
      };
    },
  };
}
