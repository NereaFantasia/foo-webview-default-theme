import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { albumArtistOf, albumKeyOf, type Album } from '../../host/libraryContract.ts';
import type { ArtistRow } from '../artists/artistIndex.ts';
import { QUERY_SCOPES, wordsQuery, type QueryScope } from '../../track/trackQuery.ts';

/**
 * 搜索结果页字段作用域
 * `any` 对应 fb2k 原生全文检索范围（包含全部标签、技术元数据与路径）；其余项仅比对单一字段
 */
export type SearchScope = 'any' | Exclude<QueryScope, 'all'>;
export const SEARCH_SCOPES: readonly SearchScope[] = [
  'any',
  ...QUERY_SCOPES.filter((scope): scope is Exclude<QueryScope, 'all'> => scope !== 'all'),
];

export interface SearchQuery {
  readonly text: string;
  readonly query: string;
  readonly sort: string;
}

const TITLE = '$lower($meta(title))';
const ARTIST = '$lower($meta(artist))';
const ALBUM_ARTIST = '$lower($meta(album artist))';
const ALBUM = '$lower($meta(album))';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// 查询外层使用双引号，Title Formatting 内层使用单引号；特殊引号均通过字符代码转义
function literal(value: string): string {
  return value
    .split(/(["'\p{Cc}])/u)
    .filter(Boolean)
    .map((part) => {
      if (part.length === 1 && /["'\p{Cc}]/u.test(part)) return `$char(${part.charCodeAt(0)})`;
      return `'${part}'`;
    })
    .join('');
}

// 双引号与控制字符均视为分词边界
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s"\p{Cc}]+/u)
    .filter(Boolean);
}

/**
 * 构造媒体库全文检索与相关度排序查询
 * 检索词拆分为 `* HAS "词"` 子句，匹配全部标签、技术元数据与文件路径；双引号包裹特殊字符，词折叠为小写以实现大小写无关匹配
 *
 * 相关度分七档排序：标题完全相等、标题前缀、标题包含全部词、艺人包含全部词、专辑包含全部词、词分布于核心标签、仅在其他元数据或路径命中；同档内按专辑与曲序聚类
 */
export function searchQuery(text: string, scope: SearchScope = 'any'): SearchQuery | null {
  const trimmed = text.trim();
  const words = wordsOf(trimmed);
  if (!words.length) return null;
  const phrase = literal(trimmed.toLowerCase());
  const contains = (field: string, word: string) => `$strstr(${field},${literal(word)})`;
  const all = (parts: readonly string[]) =>
    parts.length === 1 ? (parts[0] ?? '') : `$and(${parts.join(',')})`;
  const allIn = (field: string) => all(words.map((word) => contains(field, word)));
  const named = words.map(
    (word) =>
      `$or(${[TITLE, ARTIST, ALBUM_ARTIST, ALBUM].map((field) => contains(field, word)).join(',')})`,
  );
  const query =
    scope === 'any'
      ? words.map((word) => `* HAS "${word}"`).join(' AND ')
      : wordsQuery(words, scope);
  const rank =
    `$if($strcmp(${TITLE},${phrase}),0,` +
    `$if($strcmp($left(${TITLE},$len(${phrase})),${phrase}),1,` +
    `$if(${allIn(TITLE)},2,` +
    `$if($or(${allIn(ARTIST)},${allIn(ALBUM_ARTIST)}),3,` +
    `$if(${allIn(ALBUM)},4,` +
    `$if(${all(named)},5,6))))))`;
  return {
    text: trimmed,
    query,
    sort: `${rank}|%album artist%|%album%|%discnumber%|%tracknumber%|%title%|%path%|%subsong%`,
  };
}

export function searchNameRank(name: string, text: string): number {
  const value = name.toLowerCase();
  const phrase = text.trim().toLowerCase();
  if (value === phrase) return 0;
  if (value.startsWith(phrase)) return 1;
  return wordsOf(phrase).every((word) => value.includes(word)) ? 2 : 3;
}

/** 专辑检索比对字段组合；依作用域分别匹配专辑名、专辑艺人或两者，其余字段返回 null */
function albumFields(album: Album, scope: SearchScope): string | null {
  if (scope === 'any') return `${album.name} ${albumArtistOf(album)}`;
  if (scope === 'album') return album.name;
  if (scope === 'artist' || scope === 'albumArtist') return albumArtistOf(album);
  return null;
}

export function searchAlbums(
  albums: readonly Album[],
  text: string,
  scope: SearchScope = 'any',
): readonly Album[] {
  const words = wordsOf(text);
  if (!words.length) return [];
  return albums
    .filter((album) => {
      const fields = albumFields(album, scope)?.toLowerCase();
      return fields !== undefined && words.every((word) => fields.includes(word));
    })
    .sort(
      (a, b) =>
        searchNameRank(a.name, text) - searchNameRank(b.name, text) ||
        collator.compare(a.name, b.name) ||
        collator.compare(albumArtistOf(a), albumArtistOf(b)) ||
        albumKeyOf(a).localeCompare(albumKeyOf(b)),
    );
}

/** 检索名字包含全部关键字的艺人；同相关度档位下按曲目数量降序，非艺人作用域返回空数组 */
export function searchArtists(
  rows: readonly ArtistRow[],
  text: string,
  scope: SearchScope = 'any',
): readonly ArtistRow[] {
  const words = wordsOf(text);
  if (!words.length || !(scope === 'any' || scope === 'artist' || scope === 'albumArtist'))
    return [];
  return rows
    .filter((row) => row.name && words.every((word) => row.name.toLowerCase().includes(word)))
    .sort(
      (a, b) =>
        searchNameRank(a.name, text) - searchNameRank(b.name, text) ||
        b.trackCount - a.trackCount ||
        collator.compare(a.name, b.name),
    );
}

/** 支持起播与上下文菜单的媒体对象命中项 */
export type MediaHit =
  | { readonly kind: 'album'; readonly album: Album }
  | { readonly kind: 'track'; readonly track: LibraryTrackPartial };
export type SearchHit = MediaHit | { readonly kind: 'artist'; readonly artist: ArtistRow };

export function searchHitKey(hit: SearchHit): string {
  if (hit.kind === 'artist') return `artist:${hit.artist.name}`;
  return hit.kind === 'album' ? `album:${albumKeyOf(hit.album)}` : `track:${hit.track.handle}`;
}

/** 从艺人、专辑、曲目首项候选中选取最佳匹配项；同档位下依次优先艺人、专辑 */
export function bestSearchHit(
  albums: readonly Album[],
  tracks: readonly LibraryTrackPartial[],
  text: string,
  artists: readonly ArtistRow[] = [],
): SearchHit | null {
  if (!text.trim()) return null;
  const track = tracks.find((item) => item.handle);
  const candidates: (readonly [SearchHit, string])[] = [];
  if (artists[0]) candidates.push([{ kind: 'artist', artist: artists[0] }, artists[0].name]);
  if (albums[0]) candidates.push([{ kind: 'album', album: albums[0] }, albums[0].name]);
  if (track) candidates.push([{ kind: 'track', track }, track.title ?? '']);
  let best: SearchHit | null = null;
  let rank = Infinity;
  for (const [hit, name] of candidates) {
    const next = searchNameRank(name, text);
    if (next < rank) [best, rank] = [hit, next];
  }
  return best;
}
