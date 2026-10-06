// 改写自 Lyricify Lyrics Helper（https://github.com/WXRIW/Lyricify-Lyrics-Helper，Apache License 2.0，
// Copyright 2023 XY Wang, WXRIW）
// 提交 53a2f81 的 Searchers/Helpers/CompareHelper.cs 及其 MatchHelpers/NameMatch.cs、ArtistMatch.cs、DurationMatch.cs。
// 改动：改写为 TypeScript；繁转简改用 OpenCC 的单字表（原版先过一遍 Microsoft 的繁简转换库）；
// 两处原版永远不中的判断按本意改正：「群星、Various」那条改成与小写后的艺人名比较（原版拿 "Various" 比小写后的名字）；
// 「曲名 - 注记」对「曲名 (注记)」只给改写了破折号的一边补右括号（原版两边都补，括号写法那边多出一个）。
import type { LyricsCandidate, LyricsQuery } from './lyricsSource.ts';
import { TS_CHARACTER_PAIRS } from './tsCharacters.ts';

/** 单项（曲名、艺人、时长）的档，分别记 7、6、5、4、2、0 分。 */
export type PartLevel = 'perfect' | 'veryHigh' | 'high' | 'medium' | 'low' | 'none';

const PART_POINTS: Readonly<Record<PartLevel, number>> = {
  perfect: 7,
  veryHigh: 6,
  high: 5,
  medium: 4,
  low: 2,
  none: 0,
};

/** 整首的档，从高到低。 */
export const MATCH_LEVELS = [
  'perfect',
  'veryHigh',
  'high',
  'prettyHigh',
  'medium',
  'low',
  'veryLow',
  'none',
] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

/** 整首各档的下界（不含）：总分折算到满分 25.2 之后比较。 */
const LEVEL_FLOORS: readonly (readonly [MatchLevel, number])[] = [
  ['perfect', 21],
  ['veryHigh', 19],
  ['high', 17],
  ['prettyHigh', 15],
  ['medium', 11],
  ['low', 8],
  ['veryLow', 3],
];

/** 曲名、艺人各 1 份，专辑 0.4，专辑艺人 0.2，时长 1；每份满 7 分。 */
const FULL_POINTS = (1 + 1 + 0.4 + 0.2 + 1) * 7;

export interface MatchResult {
  readonly level: MatchLevel;
  /** 缺项按剩下的项重新分配权重后的总分，满分 25.2。 */
  readonly points: number;
}

let simplifiedTable: Map<string, string> | null = null;

/** 繁转简，只用来比较，不用来显示。原版在单字表之外还把这四个字换成常用写法。 */
function toSimplified(text: string): string {
  if (!simplifiedTable) {
    const chars = [...TS_CHARACTER_PAIRS];
    simplifiedTable = new Map();
    for (let index = 0; index + 1 < chars.length; index += 2) {
      simplifiedTable.set(chars[index] ?? '', chars[index + 1] ?? '');
    }
  }
  let result = '';
  for (const char of text) result += simplifiedTable.get(char) ?? char;
  return result
    .replaceAll('藉', '借')
    .replaceAll('咀', '嘴')
    .replaceAll('昇', '升')
    .replaceAll('髒', '脏');
}

function removeDuoSpaces(text: string): string {
  let result = text;
  while (result.includes('  ')) result = result.replaceAll('  ', ' ');
  return result;
}

/** 两串的最长公共子序列占较长那串的百分比，保留两位小数。按 UTF-16 码元比较，与原版的 char 一致。 */
function textSame(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let x = 0; x < a.length; x += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let y = 0; y < b.length; y += 1) {
      current[y + 1] =
        a[x] === b[y] ? (previous[y] ?? 0) + 1 : Math.max(previous[y + 1] ?? 0, current[y] ?? 0);
    }
    previous = current;
  }
  const same = ((previous[b.length] ?? 0) / Math.max(a.length, b.length)) * 100;
  return Math.round(same * 100) / 100;
}

function normalizeName(name: string): string {
  const unified = toSimplified(name)
    .toLowerCase()
    .trim()
    .replaceAll('’', "'")
    .replaceAll('，', ',')
    .replaceAll('（', '(')
    .replaceAll('）', ')')
    .replaceAll('[', '(')
    .replaceAll(']', ')');
  return removeDuoSpaces(unified).replaceAll(' (', '(').replaceAll('( ', '(').replaceAll(' )', ')');
}

/** 一边带「(注记」、另一边不带，且注记前的部分与另一边相同。 */
function specialCompare(a: string, b: string, tag: string): boolean {
  const mark = `(${tag}`;
  const inA = a.includes(mark);
  const inB = b.includes(mark);
  if (inA && !inB && a.slice(0, a.indexOf(mark)).trim() === b) return true;
  return inB && !inA && b.slice(0, b.indexOf(mark)).trim() === a;
}

/** 两边都带同一个注记，注记前的部分相同。 */
function singleSpecialCompare(a: string, b: string, tag: string): boolean {
  const mark = `(${tag}`;
  return (
    a.includes(mark) &&
    b.includes(mark) &&
    a.slice(0, a.indexOf(mark)).trim() === b.slice(0, b.indexOf(mark)).trim()
  );
}

/** 两边各带一个不同的注记，注记前的部分相同。 */
function duoSpecialCompare(a: string, b: string, first: string, second: string): boolean {
  const before = (text: string, mark: string) => text.slice(0, text.indexOf(mark)).trim();
  const one = `(${first}`;
  const two = `(${second}`;
  if (a.includes(one) && b.includes(two) && before(a, one) === before(b, two)) return true;
  return a.includes(two) && b.includes(one) && before(a, two) === before(b, one);
}

/** 只有一边带括号，括号前的部分与另一边相同。 */
function bracketsCompare(a: string, b: string): boolean {
  if (a.includes('(') && !b.includes('(') && a.slice(0, a.indexOf('(')).trim() === b) return true;
  return b.includes('(') && !a.includes('(') && b.slice(0, b.indexOf('(')).trim() === a;
}

/** 曲名或专辑名的档；任一边为空答 null。 */
export function compareName(first: string, second: string): PartLevel | null {
  if (!first.trim() || !second.trim()) return null;
  let a = normalizeName(first);
  let b = normalizeName(second);
  if (a === b) return 'perfect';
  a = a.replaceAll('acoustic version', 'acoustic');
  b = b.replaceAll('acoustic version', 'acoustic');
  // 「曲名 - 注记」与「曲名 (注记)」视为同一写法。
  const dashed = (text: string) =>
    (text.includes(' - ') ? `${text.replaceAll(' - ', ' (').trim()})` : text).replaceAll(' ', '');
  if (dashed(a) === dashed(b)) return 'veryHigh';
  for (const tag of ['deluxe', 'explicit', 'special edition', 'bonus track', 'feat', 'with']) {
    if (specialCompare(a, b, tag)) return 'veryHigh';
  }
  if (duoSpecialCompare(a, b, 'feat', 'explicit') || duoSpecialCompare(a, b, 'with', 'explicit')) {
    return 'high';
  }
  if (singleSpecialCompare(a, b, 'feat') || singleSpecialCompare(a, b, 'with')) return 'high';
  if (bracketsCompare(a, b)) return 'medium';
  // 等长时逐位比对，兜住异体字：4 字以上八成相同，或 2、3 字过半相同。
  if (a.length === b.length) {
    let same = 0;
    for (let index = 0; index < a.length; index += 1) if (a[index] === b[index]) same += 1;
    const ratio = same / a.length;
    if ((ratio >= 0.8 && a.length >= 4) || (ratio >= 0.5 && a.length >= 2 && a.length <= 3)) {
      return 'high';
    }
  }
  const same = textSame(a, b);
  if (same > 90) return 'veryHigh';
  if (same > 80) return 'high';
  if (same > 68) return 'medium';
  if (same > 55) return 'low';
  return 'none';
}

/**
 * 艺人的档：`first` 是要找的那一首，`second` 是候选，按交集个数分档。两边各自去掉空名，任一边为空答 null。
 * 名字只转小写、繁转简后整串比较，不再拆分：拆分由取数的一方按各家的写法做。
 */
export function compareArtist(
  first: readonly string[],
  second: readonly string[],
): PartLevel | null {
  const one = first.filter((name) => name.trim()).map((name) => toSimplified(name.toLowerCase()));
  const two = second.filter((name) => name.trim()).map((name) => toSimplified(name.toLowerCase()));
  const [lead = ''] = two;
  if (one.length === 0 || two.length === 0) return null;
  const count = two.filter((name) => one.includes(name)).length;
  if (count === one.length && one.length === two.length) return 'perfect';
  if (
    (count + 1 >= one.length && one.length >= 2) ||
    (one.length > 6 && count / one.length > 0.8)
  ) {
    return 'veryHigh';
  }
  if (count === 1 && one.length === 1 && two.length === 2) return 'high';
  if (one.length > 5 && (lead.includes('various') || lead.includes('群星'))) return 'veryHigh';
  if (one.length > 7 && two.length > 7 && count / one.length > 0.66) return 'high';
  const single = one.length === 1 && two.length > 1 ? (one[0] ?? '') : null;
  if (single !== null && single.startsWith(lead)) return 'high';
  if (single !== null && lead.length > 3 && single.includes(lead)) return 'high';
  if (single !== null && lead.length > 1 && single.includes(lead)) return 'medium';
  if (count === 1 && one.length === 1 && two.length >= 3) return 'medium';
  if (count >= 2) return 'low';
  return 'none';
}

/** 时长（毫秒）的档；任一边未知（0）答 null。 */
export function compareDuration(first: number, second: number): PartLevel | null {
  if (first <= 0 || second <= 0) return null;
  const diff = Math.abs(Math.round(first) - Math.round(second));
  if (diff === 0) return 'perfect';
  if (diff < 300) return 'veryHigh';
  if (diff < 700) return 'high';
  if (diff < 1500) return 'medium';
  if (diff < 3500) return 'low';
  return 'none';
}

/** 要找的那一首的艺人栏按「, 」再拆一次，同原版对本地曲目的处理。 */
const splitQueryArtists = (names: readonly string[]) => names.flatMap((name) => name.split(', '));

const pointsOf = (level: PartLevel | null) => (level === null ? 0 : PART_POINTS[level]);

/**
 * 候选与要找的那一首有多像。曲名与艺人总是计入（缺了按 0 分）；专辑、专辑艺人、时长缺了不计，
 * 按剩下的项把总分折算回满分。
 */
export function compareTrack(query: LyricsQuery, candidate: LyricsCandidate): MatchResult {
  const album = compareName(query.album, candidate.album);
  const albumArtist = compareArtist(
    splitQueryArtists(query.albumArtists),
    candidate.albumArtists ?? [],
  );
  const duration = compareDuration(query.durationMs, candidate.durationMs);
  const total =
    pointsOf(compareName(query.title, candidate.title)) +
    pointsOf(compareArtist(splitQueryArtists(query.artists), candidate.artists)) +
    pointsOf(album) * 0.4 +
    pointsOf(albumArtist) * 0.2 +
    pointsOf(duration);
  let available = (1 + 1) * 7;
  if (album !== null) available += 0.4 * 7;
  if (albumArtist !== null) available += 0.2 * 7;
  if (duration !== null) available += 7;
  const points = (total * FULL_POINTS) / available;
  const level = LEVEL_FLOORS.find(([, floor]) => points > floor)?.[0] ?? 'none';
  return { level, points };
}

/**
 * 缺省门槛。翻唱（同名不同艺人）即使时长恰好相同也只到 prettyHigh；同名同艺人、时长差 40 秒的另一首
 * 是 16.9 分，也在门槛下。代价是专辑不同且时长差 1.5 到 3.5 秒的同一首会被挡掉。
 */
export const DEFAULT_MINIMUM: MatchLevel = 'high';

/** 档的高低：数字越小越好。 */
export const levelRank = (level: MatchLevel) => MATCH_LEVELS.indexOf(level);

/** 达到 `minimum` 的候选，按档从高到低；档相同保留来源自己的排序，同原版取第一条的做法。 */
export function rankCandidates(
  query: LyricsQuery,
  candidates: readonly LyricsCandidate[],
  minimum: MatchLevel,
): { readonly candidate: LyricsCandidate; readonly match: MatchResult }[] {
  return candidates
    .map((candidate) => ({ candidate, match: compareTrack(query, candidate) }))
    .filter((item) => levelRank(item.match.level) <= levelRank(minimum))
    .sort((a, b) => levelRank(a.match.level) - levelRank(b.match.level));
}
