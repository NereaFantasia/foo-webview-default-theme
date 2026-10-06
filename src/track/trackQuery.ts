// 把过滤框里写的东西拼成交给宿主求值的 fb2k 查询串。宿主的规则（在运行的实例上核过）：查询里的小写字母两种
// 大小写都匹配，大写字母只配大写；`HAS` 是子串、`IS` 比整个值，多值字段按单个值比；`IS` 里的 `*`、`?` 是通配符；
// 引号串里写不进引号，也没有转义写法；写错的查询答 `INVALID_PARAMS`，有些错写法不报错、只是一首也不命中。

/**
 * 字段范围，按菜单里的先后。`all` 是前六个字段任一命中；文件名与注释不在 `all` 里，另成一节，与播放列表页的
 * 过滤框同一套。
 */
export const QUERY_SCOPES = [
  'all',
  'title',
  'artist',
  'albumArtist',
  'album',
  'genre',
  'date',
  'filename',
  'comment',
] as const;
export type QueryScope = (typeof QUERY_SCOPES)[number];

export function isQueryScope(value: unknown): value is QueryScope {
  return QUERY_SCOPES.some((scope) => scope === value);
}

/** 每档在查询里比哪几个字段；带空格的字段名要加引号。 */
const SCOPE_FIELDS: Readonly<Record<QueryScope, readonly string[]>> = {
  all: ['title', 'artist', '"album artist"', 'album', 'genre', 'date'],
  title: ['title'],
  artist: ['artist'],
  albumArtist: ['"album artist"'],
  album: ['album'],
  genre: ['genre'],
  date: ['date'],
  filename: ['%filename%'],
  comment: ['comment'],
};

/** 什么都不筛时交给宿主的查询：整个媒体库。 */
export const ALL_QUERY = 'ALL';

/**
 * 过滤框里的词：折成小写，按空白、双引号与逗号切开，重复的只留一个。折小写是为了两种大小写都命中；逗号也切，
 * 多值字段按单个值比，「A, B」照抄的署名整串一首也命中不了。
 */
export function queryWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s",，]+/u))].filter((word) => word !== '');
}

/** 词拼成的查询：每个词在范围的几个字段上 `HAS`，用 OR 连；词与词之间 AND。没有词时是空串。 */
export function wordsQuery(words: readonly string[], scope: QueryScope): string {
  const fields = SCOPE_FIELDS[scope];
  return words
    .map((word) => {
      const one = fields.map((field) => `${field} HAS "${word}"`);
      return one.length > 1 ? `(${one.join(' OR ')})` : (one[0] ?? '');
    })
    .join(' AND ');
}

/** 值里有这些就写不进 `IS`：双引号写不进查询，`*`、`?` 会被当成通配符。 */
const UNSAFE_VALUE = /["*?]/;

/** 这个值能不能原样写进 `字段 IS "值"`。空值也不能：空串要用 `NOT 字段 PRESENT` 表达。 */
export function isQueryableValue(value: string): boolean {
  return value !== '' && !UNSAFE_VALUE.test(value);
}

/** 几个值任一相等：`(field IS "a" OR field IS "b")`；一个值时不加括号。值要先过 `isQueryableValue`。 */
export function anyIs(field: string, values: readonly string[]): string {
  const terms = values.map((value) => `${field} IS "${value}"`);
  return terms.length > 1 ? `(${terms.join(' OR ')})` : (terms[0] ?? '');
}

/** 几段查询都要成立；每段加括号，免得段里的 OR 越过 AND。一段都没有时是整个媒体库。 */
export function allOf(parts: readonly string[]): string {
  const kept = parts.map((part) => part.trim()).filter((part) => part !== '');
  if (kept.length === 0) return ALL_QUERY;
  if (kept.length === 1) return kept[0] ?? ALL_QUERY;
  return kept.map((part) => `(${part})`).join(' AND ');
}
