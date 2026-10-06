import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { albumArtistOf, albumKeyOf, type Album } from '../../host/libraryContract.ts';

export interface SearchQuery {
  readonly text: string;
  readonly query: string;
  readonly sort: string;
}

const SEARCH_FIELDS = [
  'title',
  'artist',
  'album artist',
  'album',
  'genre',
  'date',
  'composer',
] as const;
const TITLE = '$lower($meta(title))';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// 查询外层用双引号，Title Formatting 内层用单引号；两种引号都作为字符生成。
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

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/u).filter(Boolean);
}

/**
 * 普通文字始终作为数据进入查询，不识别用户输入的查询操作符或格式串。
 * 相关度在宿主截取 limit 之前计算；标题相等、前缀、标题含各词、其他字段依次排列。
 */
export function searchQuery(text: string): SearchQuery | null {
  const trimmed = text.trim();
  const words = wordsOf(trimmed);
  if (!words.length) return null;
  const phrase = literal(trimmed.toLowerCase());
  const haystack = `$lower(${SEARCH_FIELDS.map((field) => `$meta_sep(${field},' ')`).join("' '")})`;
  const contains = (field: string, word: string) => `$strstr(${field},${literal(word)})`;
  const query = words.map((word) => `"${contains(haystack, word)}" GREATER 0`).join(' AND ');
  const inTitle = words.map((word) => contains(TITLE, word));
  const allTitle = inTitle.length === 1 ? inTitle[0] : `$and(${inTitle.join(',')})`;
  const rank =
    `$if($strcmp(${TITLE},${phrase}),0,` +
    `$if($strcmp($left(${TITLE},$len(${phrase})),${phrase}),1,` +
    `$if(${allTitle},2,3)))`;
  return {
    text: trimmed,
    query,
    sort: `${rank}|%title%|%artist%|%album%|%path%|%subsong%`,
  };
}

export function searchNameRank(name: string, text: string): number {
  const value = name.toLowerCase();
  const phrase = text.trim().toLowerCase();
  if (value === phrase) return 0;
  if (value.startsWith(phrase)) return 1;
  return wordsOf(phrase).every((word) => value.includes(word)) ? 2 : 3;
}

export function searchAlbums(albums: readonly Album[], text: string): readonly Album[] {
  const words = wordsOf(text);
  if (!words.length) return [];
  return albums
    .filter((album) => {
      const fields = `${album.name} ${albumArtistOf(album)}`.toLowerCase();
      return words.every((word) => fields.includes(word));
    })
    .sort(
      (a, b) =>
        searchNameRank(a.name, text) - searchNameRank(b.name, text) ||
        collator.compare(a.name, b.name) ||
        collator.compare(albumArtistOf(a), albumArtistOf(b)) ||
        albumKeyOf(a).localeCompare(albumKeyOf(b)),
    );
}

export type SearchHit =
  | { readonly kind: 'album'; readonly album: Album }
  | { readonly kind: 'track'; readonly track: LibraryTrackPartial };

export function searchHitKey(hit: SearchHit): string {
  return hit.kind === 'album' ? `album:${albumKeyOf(hit.album)}` : `track:${hit.track.handle}`;
}

export function bestSearchHit(
  albums: readonly Album[],
  tracks: readonly LibraryTrackPartial[],
  text: string,
): SearchHit | null {
  if (!text.trim()) return null;
  const album = albums[0];
  const track = tracks.find((item) => item.handle);
  if (
    album &&
    (!track || searchNameRank(album.name, text) <= searchNameRank(track.title ?? '', text))
  )
    return { kind: 'album', album };
  return track ? { kind: 'track', track } : null;
}
