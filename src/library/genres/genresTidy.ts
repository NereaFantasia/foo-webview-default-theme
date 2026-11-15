import { EMPTY_GENRE } from '../../nav/places.ts';

/** 判断「需要整理」要的那一点：流派名与带这个名字的曲目数（合并目标取曲目多的那个写法） */
export interface TidyGenre {
  readonly key: string;
  readonly trackCount: number;
}

export type GenreIssue =
  /** 与 `others` 规范化后相同；`target` 是缺省的合并目标，可能就是它自己 */
  | { readonly kind: 'duplicate'; readonly others: readonly string[]; readonly target: string }
  /** 一个值里写了几个流派，`parts` 是拆出来的名字 */
  | { readonly kind: 'combined'; readonly parts: readonly string[] };

/** 没有连接词的缩写，并到带连接词的写法上 */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['rnb', 'r&b'],
  ['dnb', 'drum&bass'],
  ['d&b', 'drum&bass'],
]);

/**
 * 判断重复用的键：去掉变音符号、统一全半角与大小写；`&`、`and`、`'n'` 当同一个连接词；
 * 再去掉空白、连字符与撇号。别的标点（如斜杠）是名字的一部分
 */
export function genreKey(name: string): string {
  const folded = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']n[’']|\s+n\s+|\band\b/g, '&')
    .replace(/[\s\-‐‑‒–—―_'’`]+/g, '');
  return ALIASES.get(folded) ?? folded;
}

/**
 * 名字里本来就带分隔符的单个流派，取自通行的分类体系：不算写了几个
 * 其中 `Folk, World, & Country` 的逗号、`R&B/Soul` 这类的斜杠，不列在这里就会被拆开
 */
const KNOWN_SINGLE: ReadonlySet<string> = new Set(
  [
    'R&B',
    'R&B/Soul',
    'Rhythm & Blues',
    'Rock & Roll',
    'Drum & Bass',
    'Hip-Hop/Rap',
    'Funk / Soul',
    'Pop/Funk',
    'Singer/Songwriter',
    'Folk, World, & Country',
    'Stage & Screen',
    'Brass & Military',
  ].map(genreKey),
);

/** 流派名里不会出现的分隔，出现就算写了几个（全角的逗号与分号已随兼容归一变成半角） */
const DEFINITE = /\s*[,;、|\\]\s*/;
/** 流派名里常见的分隔，由宽到严各试一级：拆出的每一段都是库里已有或通行的单个流派才算 */
const AMBIGUOUS = [/\s*\/\s*/, /\s*&\s*/];

function partsOf(text: string, pattern: RegExp): readonly string[] {
  return text
    .split(pattern)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** `known` 是库里各流派的 `genreKey`；返回拆出的名字，写的是单个流派时为 null */
function combinedParts(name: string, known: ReadonlySet<string>): readonly string[] | null {
  if (KNOWN_SINGLE.has(genreKey(name))) return null;
  const text = name.normalize('NFKC');
  const definite = partsOf(text, DEFINITE);
  if (definite.length > 1) return definite;
  const exists = (part: string) => known.has(genreKey(part)) || KNOWN_SINGLE.has(genreKey(part));
  for (const pattern of AMBIGUOUS) {
    const parts = partsOf(text, pattern);
    if (parts.length > 1 && parts.every(exists)) return parts;
  }
  return null;
}

/** 整份清单里每个流派的整理提示。`ignored` 是用户点过「忽略」的名字 */
export function findGenreIssues(
  genres: readonly TidyGenre[],
  ignored: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, readonly GenreIssue[]> {
  const named = genres.filter((genre) => genre.key !== EMPTY_GENRE);
  const byKey = new Map<string, TidyGenre[]>();
  for (const genre of named) {
    const key = genreKey(genre.key);
    byKey.set(key, [...(byKey.get(key) ?? []), genre]);
  }
  const issues = new Map<string, GenreIssue[]>();
  const add = (name: string, issue: GenreIssue) => {
    if (!ignored.has(name)) issues.set(name, [...(issues.get(name) ?? []), issue]);
  };
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const target = group.reduce((best, item) => (item.trackCount > best.trackCount ? item : best));
    for (const genre of group) {
      const others = group.filter((item) => item !== genre).map((item) => item.key);
      add(genre.key, { kind: 'duplicate', others, target: target.key });
    }
  }
  const known = new Set(byKey.keys());
  for (const genre of named) {
    const parts = combinedParts(genre.key, known);
    if (parts) add(genre.key, { kind: 'combined', parts });
  }
  return issues;
}
