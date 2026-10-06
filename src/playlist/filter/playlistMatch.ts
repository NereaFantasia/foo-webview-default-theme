import type { PlaylistRow } from '../playlistRow.ts';

/**
 * 字段范围，按菜单里的先后。`all` 是前六个字段任一命中，文件名与注释不算在里面：注释要另取一列，放进
 * `all` 每次扫描都得多取。
 */
export const FILTER_SCOPES = [
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
export type FilterScope = (typeof FILTER_SCOPES)[number];

/** 注释不在行的投影里，只能经取行的 `formats` 另带一列回来。键是这一列在 `formats` 里的名字。 */
export const COMMENT_FORMAT: Readonly<Record<string, string>> = { comment: '%comment%' };

const ALL_FIELDS = ['title', 'artist', 'albumArtist', 'album', 'genre', 'date'] as const;

/** 行菜单「筛选」加的条件：这个字段的值与给的值整个相同，大小写不计。 */
export type ConditionField = 'artist' | 'album' | 'genre' | 'year';
export const CONDITION_FIELDS: readonly ConditionField[] = ['artist', 'album', 'genre', 'year'];

export interface PlaylistCondition {
  readonly field: ConditionField;
  /** 原样的值，条件行照它写；比的时候折成小写。 */
  readonly value: string;
}

export interface ConditionChoice {
  readonly condition: PlaylistCondition;
  /** 能不能加。值为空、带引号或通配符、流派写了好几个时不能：宿主的查询表达不了。 */
  readonly usable: boolean;
}

/**
 * 过滤框里的词：折成小写，按空白、双引号与逗号切开，重复的只留一个。几个词都要命中，不分先后；
 * 逗号也切，「A, B」这样照抄的署名切开了才找得到各位艺术家。
 */
export function filterWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s",，]+/u))].filter((word) => word !== '');
}

/** 日期里的年份，按第一个四位数认；认不出是空串。 */
export function yearOf(date: string): string {
  return /\d{4}/.exec(date)?.[0] ?? '';
}

/** 文件名，不带目录与扩展名，与 fb2k 的 `%filename%` 相同。 */
export function fileNameOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 这一行在这个范围里要比的几个值。`formats` 是取行时另带的列，注释从那里取。 */
function valuesOf(
  row: PlaylistRow,
  scope: FilterScope,
  formats: Readonly<Record<string, string>>,
): string[] {
  if (scope === 'all') return ALL_FIELDS.map((field) => row[field]);
  if (scope === 'filename') return [fileNameOf(row.path)];
  if (scope === 'comment') return [formats['comment'] ?? ''];
  return [row[scope]];
}

const artistsOf = (row: PlaylistRow) => (row.artists.length > 0 ? row.artists : [row.artist]);

function holds(condition: PlaylistCondition, row: PlaylistRow): boolean {
  const value = condition.value.toLowerCase();
  switch (condition.field) {
    case 'artist':
      return artistsOf(row).some((artist) => artist.toLowerCase() === value);
    case 'album':
      return row.album.toLowerCase() === value;
    case 'genre':
      return row.genre.toLowerCase() === value;
    case 'year':
      return yearOf(row.date) === value;
  }
}

/** 按词、范围与条件认一行：每个词在范围里的某个字段里出现，每个条件都成立。 */
export function rowMatcher(
  words: readonly string[],
  scope: FilterScope,
  conditions: readonly PlaylistCondition[],
): (row: PlaylistRow, formats: Readonly<Record<string, string>>) => boolean {
  return (row, formats) => {
    if (!conditions.every((condition) => holds(condition, row))) return false;
    if (words.length === 0) return true;
    const values = valuesOf(row, scope, formats).map((value) => value.toLowerCase());
    return words.every((word) => values.some((value) => value.includes(word)));
  };
}

export function sameCondition(left: PlaylistCondition, right: PlaylistCondition): boolean {
  return left.field === right.field && left.value.toLowerCase() === right.value.toLowerCase();
}

export function sameConditions(
  left: readonly PlaylistCondition[],
  right: readonly PlaylistCondition[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, at) => {
    const other = right[at];
    return other !== undefined && sameCondition(item, other);
  });
}

/** 值里有这些就不能交给宿主：双引号写不进查询，`*`、`?` 在 `IS` 里是通配符。 */
const UNSAFE = /["*?]/;

/** 右键那一首能加哪些条件：几位艺术家各一项，再是专辑、流派、年份。 */
export function conditionChoices(row: PlaylistRow): ConditionChoice[] {
  const choice = (field: ConditionField, value: string, extra = true): ConditionChoice => ({
    condition: { field, value },
    usable: extra && value !== '' && !UNSAFE.test(value),
  });
  const artists = artistsOf(row).filter((artist) => artist !== '');
  return [
    ...(artists.length > 0 ? artists : ['']).map((artist) => choice('artist', artist)),
    choice('album', row.album),
    // 流派只有拼接串：写了好几个的那一首取不到单个值。
    choice('genre', row.genre, !row.genre.includes(', ')),
    choice('year', yearOf(row.date)),
  ];
}
