import type { LyricLine } from '@applemusic-like-lyrics/core';
import { parseLrcLike, parseTTML } from '@applemusic-like-lyrics/lyric';

/** 一首歌整理好的歌词：带时间轴的交给 AMLL 播放器，没有时间轴的按纯文本排。 */
export type LyricsContent =
  | { readonly kind: 'synced'; readonly lines: readonly LyricLine[] }
  | { readonly kind: 'plain'; readonly lines: readonly string[] };

/** 元数据标签：方括号里是字母键加冒号，与时间码的数字键区分开。 */
const META_TAG = /^\[[a-z#]+:[^\]]*\]$/i;
/** 行首的时间码；只有时间码、没有字的行，纯文本里不留。 */
const TIME_TAGS = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;

const lineText = (line: LyricLine): string =>
  line.words
    .map((word) => word.word)
    .join('')
    .trim();

/**
 * 把同一时间码的几行并成一行：双语 LRC 把译文写成与原文同码的下一行，AMLL 的解析器照样拆成两行，
 * 不并的话译文会被当成紧跟的下一句。组里第一条有字的行是正文，第二条进译文，第三条进音译，再往后不认。
 */
function mergeSameTime(lines: readonly LyricLine[]): LyricLine[] {
  const merged: LyricLine[] = [];
  let extras = 0;
  for (const line of lines) {
    const last = merged.at(-1);
    if (!last || last.startTime !== line.startTime) {
      merged.push({ ...line });
      extras = 0;
      continue;
    }
    const text = lineText(line);
    if (!text) continue;
    if (!lineText(last)) {
      // 同码的第一条是空行（间奏记号），有字的那条才是正文。
      merged[merged.length - 1] = { ...line };
      continue;
    }
    extras += 1;
    if (extras === 1 && !last.translatedLyric) last.translatedLyric = text;
    else if (extras === 2 && !last.romanLyric) last.romanLyric = text;
  }
  return merged;
}

function plainLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !META_TAG.test(line))
    .map((line) => line.replace(TIME_TAGS, '').trim())
    .filter((line) => line !== '');
}

function parseTtml(text: string): LyricLine[] {
  try {
    return parseTTML(text).lines;
  } catch {
    return [];
  }
}

/**
 * 整理一份歌词原文：TTML 按 TTML 解析；其余按 LRC 一族（普通、增强、ESLyric 逐字）解析，通篇没有时间码
 * 就当纯文本。`[offset:]` 不应用：它的正负号各家播放器理解不一，照原码显示与别处看到的时间一致。
 * 解析不出一行字时答 null。
 */
export function parseLyricsText(text: string): LyricsContent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('<') && /<tt[\s>]/.test(trimmed)) return syncedContent(parseTtml(trimmed));
  const timed = syncedContent(mergeSameTime(parseLrcLike(trimmed).lines));
  if (timed) return timed;
  return plainContent(trimmed);
}

/** 带时间轴的行里至少一行有字才算数，否则答 null。 */
export function syncedContent(lines: readonly LyricLine[]): LyricsContent | null {
  return lines.some((line) => lineText(line)) ? { kind: 'synced', lines } : null;
}

/** 当纯文本排；只剩空行与元数据行时答 null。 */
export function plainContent(text: string): LyricsContent | null {
  const lines = plainLines(text);
  return lines.length > 0 ? { kind: 'plain', lines } : null;
}

/** 逐字词：至少一行带不止一个字的时间。逐行词每行只有一个「字」，就是整行。 */
export function isWordLevel(content: LyricsContent): boolean {
  return content.kind === 'synced' && content.lines.some((line) => line.words.length > 1);
}

/** 译文与正文行首时间相差在这之内才配得上，毫秒。 */
const ATTACH_TOLERANCE_MS = 1000;

/**
 * 把另给的一份逐行 LRC（译文或音译）并进歌词行：每条配给开始时间离它最近、相差不超过 1 秒、还没配过的行。
 * 网易云的译文按逐行词的时间码写，逐字词的行首与它常差几十毫秒，所以按最近配，不要求相等。
 * 网易云用「//」占位表示这一行没有译文，不并。
 */
export function attachLineTexts(
  lines: readonly LyricLine[],
  extra: string,
  slot: 'translatedLyric' | 'romanLyric',
): LyricLine[] {
  const result = lines.map((line) => ({ ...line }));
  const taken = new Set<number>();
  for (const row of parseLrcLike(extra).lines) {
    const value = lineText(row);
    if (!value || value === '//') continue;
    let best = -1;
    let bestGap = ATTACH_TOLERANCE_MS + 1;
    result.forEach((line, index) => {
      const gap = Math.abs(line.startTime - row.startTime);
      if (!taken.has(index) && gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    });
    const target = result[best];
    if (!target) continue;
    taken.add(best);
    target[slot] = value;
  }
  return result;
}
