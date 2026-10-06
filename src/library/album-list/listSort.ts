import type { LibraryTrack } from 'foo-webview-sdk';
import { collator, parentDirectoryOf, type AlbumSection } from '../albumSections.ts';
import { albumArtistOf, albumKeyOf, albumYearOf, type Album } from '../../host/libraryContract.ts';

// 列表形态的排序：专辑、文件、播放统计三组字段外加随机，各字段怎么取专辑级的值，节按名称还是张数排。
// 入参数组一律不改，返回新数组。

/** 三组字段，按菜单里的先后；取值与 config 里存的一致，改名要写迁移。 */
export const LIST_SORT_GROUPS = {
  album: ['albumArtist', 'name', 'year', 'genre', 'trackCount', 'duration'],
  file: ['folder', 'codec', 'bitrate', 'sampleRate', 'fileSize'],
  stats: ['added', 'lastPlayed', 'firstPlayed', 'playCount', 'rating'],
} as const;

export const LIST_SORT_FIELDS = [
  ...LIST_SORT_GROUPS.album,
  ...LIST_SORT_GROUPS.file,
  ...LIST_SORT_GROUPS.stats,
  'random',
] as const;
export type ListSortField = (typeof LIST_SORT_FIELDS)[number];
/** 要装 foo_playcount 才取得到的那一组（评分放在这一组里，与菜单一致）。 */
export type StatsField = (typeof LIST_SORT_GROUPS.stats)[number];

export function isStatsField(field: ListSortField): field is StatsField {
  return LIST_SORT_GROUPS.stats.some((stats) => stats === field);
}

/** 写成 type 而不是 interface：要直接存进 config，interface 没有隐式的索引签名。 */
export type ListSort = {
  readonly field: ListSortField;
  /** 降序；随机时不看它。 */
  readonly descending: boolean;
};

export const DEFAULT_LIST_SORT: ListSort = { field: 'albumArtist', descending: false };

/** 读存档与用户设值都过它：字段不认得就当没存，方向不是布尔值就当升序。 */
export function parseListSort(raw: unknown): ListSort | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const field: unknown = Reflect.get(raw, 'field');
  const known = LIST_SORT_FIELDS.find((candidate) => candidate === field);
  if (!known) return undefined;
  return { field: known, descending: Reflect.get(raw, 'descending') === true };
}

/** 节的顺序：按名称（中文按拼音），或按张数、多的在前；「未知」节恒在最后。 */
export const SECTION_ORDERS = ['name', 'count'] as const;
export type SectionOrder = (typeof SECTION_ORDERS)[number];

/**
 * 一首曲目的播放统计。时间照 foo_playcount 的写法「YYYY-MM-DD HH:MM:SS」，按字面比就是先后；空串是没有。
 * `added` 在没有添加时间时已换成文件修改时间。
 */
export interface TrackStats {
  readonly added: string;
  readonly lastPlayed: string;
  readonly firstPlayed: string;
  readonly playCount: number;
}

/** 排序时各张专辑要的外部数据。 */
export interface ListSortContext {
  /** 这张专辑的曲目，按碟号、曲号排好；还没取到时为 undefined。 */
  readonly tracksOf: (album: Album) => readonly LibraryTrack[] | undefined;
  /** 一首的播放统计；没取、或没装 foo_playcount 时为 undefined。 */
  readonly statsOf: (track: LibraryTrack) => TrackStats | undefined;
  /** 随机的种子：同一个种子排出同一个顺序，换了种子重洗。 */
  readonly seed: number;
}

type SortValue = number | string | undefined;

/** 把各首的值折成一个：取不到的首不算，一首都取不到时为 undefined。 */
function fold<T extends number | string>(
  tracks: readonly LibraryTrack[] | undefined,
  pick: (track: LibraryTrack) => T | undefined,
  merge: (values: readonly T[]) => T,
): T | undefined {
  const values = (tracks ?? []).flatMap((track) => {
    const value = pick(track);
    return value === undefined ? [] : [value];
  });
  return values.length > 0 ? merge(values) : undefined;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const average = (values: readonly number[]) => sum(values) / values.length;
const highest = (values: readonly number[]) => Math.max(...values);
const latest = (values: readonly string[]) => values.reduce((a, b) => (b > a ? b : a));
const earliest = (values: readonly string[]) => values.reduce((a, b) => (b < a ? b : a));

/** 种子与专辑键合成的一个 32 位数：FNV-1a 再过一遍 murmur3 的收尾，相近的键也散得开。 */
export function shuffleRank(seed: number, key: string): number {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let at = 0; at < key.length; at += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(at), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * 一张专辑在某个字段上的值。总时长、文件大小、播放次数求和；评分取评过分的曲目的平均；添加时间、最近播放
 * 取最新，首次播放取最早；比特率取平均、采样率取最高；格式与文件夹路径取第一首。取不到为 undefined。
 */
export function albumSortValue(
  field: ListSortField,
  album: Album,
  context: ListSortContext,
): SortValue {
  const tracks = context.tracksOf(album);
  const stats = (pick: (stats: TrackStats) => string) => (track: LibraryTrack) => {
    const value = context.statsOf(track);
    return value && pick(value) ? pick(value) : undefined;
  };
  const values: Record<ListSortField, () => SortValue> = {
    albumArtist: () => albumArtistOf(album) || undefined,
    name: () => album.name || undefined,
    year: () => albumYearOf(album) || undefined,
    genre: () => album.genre || undefined,
    trackCount: () => album.trackCount,
    duration: () => (album.duration > 0 ? album.duration : undefined),
    folder: () => parentDirectoryOf(album.firstTrackPath) || undefined,
    codec: () => tracks?.[0]?.codec || undefined,
    bitrate: () => fold(tracks, (track) => track.bitrate || undefined, average),
    sampleRate: () => fold(tracks, (track) => track.sampleRate || undefined, highest),
    fileSize: () =>
      fold(tracks, (track) => (track.fileSize >= 0 ? track.fileSize : undefined), sum),
    added: () =>
      fold(
        tracks,
        stats((value) => value.added),
        latest,
      ),
    lastPlayed: () =>
      fold(
        tracks,
        stats((value) => value.lastPlayed),
        latest,
      ),
    firstPlayed: () =>
      fold(
        tracks,
        stats((value) => value.firstPlayed),
        earliest,
      ),
    playCount: () => fold(tracks, (track) => context.statsOf(track)?.playCount, sum),
    rating: () => fold(tracks, (track) => track.rating || undefined, average),
    random: () => shuffleRank(context.seed, albumKeyOf(album)),
  };
  return values[field]();
}

/**
 * 按字段排一节里的专辑。取不到值的恒排最后，升降序都一样；值相同再按专辑名、专辑艺术家，都相同时保持入参
 * 顺序。随机只看种子。
 */
export function sortListAlbums(
  albums: readonly Album[],
  sort: ListSort,
  context: ListSortContext,
): Album[] {
  const values = new Map(
    albums.map((album) => [album, albumSortValue(sort.field, album, context)]),
  );
  const flip = sort.descending && sort.field !== 'random' ? -1 : 1;
  const compareValues = (a: SortValue, b: SortValue): number => {
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
    const order =
      typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(`${a}`, `${b}`);
    return order * flip;
  };
  return [...albums].sort(
    (a, b) =>
      compareValues(values.get(a), values.get(b)) ||
      collator.compare(a.name, b.name) ||
      collator.compare(albumArtistOf(a), albumArtistOf(b)),
  );
}

/** 节的顺序。按名称时沿用分节给的顺序（它已按名称排好）；按张数时多的在前，张数相同按名称。 */
export function orderSections(
  sections: readonly AlbumSection[],
  order: SectionOrder,
): AlbumSection[] {
  if (order === 'name') return [...sections];
  const known = sections.filter((section) => section.key !== null);
  const unknown = sections.filter((section) => section.key === null);
  return [...known.sort((a, b) => b.albums.length - a.albums.length), ...unknown];
}
