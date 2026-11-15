import type { LibraryTrackPartial } from 'foo-webview-sdk';
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../server/musicObjects.ts';
import type { SearchHit } from './searchQuery.ts';
import { searchHitKey } from './searchQuery.ts';

type AlbumHit = Extract<SearchHit, { kind: 'album' }>;
type TrackHit = Extract<SearchHit, { kind: 'track' }>;

export type SearchSuggestion =
  | { readonly key: string; readonly group: 'recent'; readonly text: string }
  | { readonly key: string; readonly group: 'best' | 'albums' | 'tracks'; readonly hit: SearchHit }
  | { readonly key: string; readonly group: 'onlineArtists'; readonly artist: MusicArtist }
  | { readonly key: string; readonly group: 'onlineAlbums'; readonly album: MusicAlbum }
  | { readonly key: string; readonly group: 'onlineTracks'; readonly track: MusicTrack };

export type SuggestionGroup = SearchSuggestion['group'];

/** 有搜索词时各组最多几行；键的顺序就是下拉里的先后，也是按高度加行的轮次顺序 */
const LIMITS = {
  best: 1,
  albums: 3,
  tracks: 4,
  onlineArtists: 2,
  onlineAlbums: 3,
  onlineTracks: 4,
} as const;

/**
 * 下拉里各部分的高度，像素，按它把条数收进可用高度：行与组头取 `SearchFlyout.module.css` 等处的固定高度，
 * 区标题取两个区标题（第二个带分隔线与上边距）的平均高度
 */
export const SUGGESTION_METRICS = { row: 56, groupHead: 32, sectionHead: 41 } as const;

export interface LocalSuggestions {
  readonly recent: readonly string[];
  readonly albums: readonly AlbumHit[];
  /** 媒体库已取到的全部曲目；下拉只列前几首，同歌去重拿全部来比 */
  readonly tracks: readonly TrackHit[];
  readonly best: SearchHit | null;
}

/** 下拉里在线音乐一区 */
export interface OnlineSuggestions {
  /** 这个来源能搜的类别；三类结果到齐前按它们的上限预留高度 */
  readonly kinds: readonly ('artist' | 'album' | 'track')[];
  /** 三类到齐前为 null */
  readonly result: {
    readonly artists: readonly MusicArtist[];
    readonly albums: readonly MusicAlbum[];
    readonly tracks: readonly MusicTrack[];
  } | null;
}

/** 媒体库曲目里的艺人字段按这些写法拆成几位 */
const ARTIST_SEPARATORS = /[,&;/]| feat\.? /i;

/** 同一首歌：曲名相同（不分大小写），媒体库的艺人至少一位出现在在线曲目的艺人里，时长相差不到 2 秒 */
export function sameSong(local: LibraryTrackPartial, online: MusicTrack): boolean {
  const title = (local.title ?? '').toLowerCase();
  if (!title || title !== online.title.toLowerCase() || online.durationMs === null) return false;
  if (Math.abs((local.duration ?? 0) * 1000 - online.durationMs) >= 2000) return false;
  const credited = online.artists.map((artist) => artist.name.toLowerCase()).join('\n');
  return (local.artist ?? '')
    .toLowerCase()
    .split(ARTIST_SEPARATORS)
    .some((part) => part.trim() !== '' && credited.includes(part.trim()));
}

/**
 * 每组先给 1 行，再按组的先后一轮一组加 1 行，到各组上限或放不下为止；一行都放不下时仍各给 1 行，由下拉滚动。
 * `sizes` 是各组能列的行数（已按上限截过），`spent` 是不属于这些组的固定高度。`budget` 为 null 时不收
 */
function fitRows(budget: number | null, sizes: readonly number[], spent = 0): number[] {
  if (budget === null) return [...sizes];
  const { row, groupHead } = SUGGESTION_METRICS;
  const counts = sizes.map((size) => Math.min(size, 1));
  let used = spent + counts.reduce((sum, count) => sum + (count ? groupHead + row : 0), 0);
  for (let grew = true; grew;) {
    grew = false;
    counts.forEach((count, at) => {
      if (count < (sizes[at] ?? 0) && used + row <= budget) {
        counts[at] = count + 1;
        used += row;
        grew = true;
      }
    });
  }
  return counts;
}

const heightOf = (counts: readonly number[]) =>
  counts.reduce(
    (sum, count) =>
      sum + (count ? SUGGESTION_METRICS.groupHead + count * SUGGESTION_METRICS.row : 0),
    0,
  );

/**
 * 下拉的各行：没有搜索词时是最近搜索；有搜索词时先是媒体库的最佳匹配、专辑、曲目，`online` 给了时接着是在线的
 * 艺人、专辑、曲目，在线曲目里与媒体库同一首的去掉。`budget` 是列表可用的高度，按 `fitRows` 收条数。
 * 媒体库各组的条数只看在线一区预留的高度、不看在线结果，在线结果到了不会改动已显示的媒体库行
 */
export function searchSuggestions(
  text: string,
  local: LocalSuggestions,
  online: OnlineSuggestions | null,
  budget: number | null,
): readonly SearchSuggestion[] {
  if (!text.trim())
    return local.recent.map((word) => ({ key: `recent:${word}`, group: 'recent', text: word }));
  const bestKey = local.best ? searchHitKey(local.best) : null;
  const albums = local.albums.filter((hit) => searchHitKey(hit) !== bestKey);
  const tracks = local.tracks.filter((hit) => searchHitKey(hit) !== bestKey);
  const localSizes = [
    local.best ? 1 : 0,
    Math.min(albums.length, LIMITS.albums),
    Math.min(tracks.length, LIMITS.tracks),
  ];
  const sections = online ? 2 * SUGGESTION_METRICS.sectionHead : 0;
  const reserve = online
    ? [
        online.kinds.includes('artist') ? LIMITS.onlineArtists : 0,
        online.kinds.includes('album') ? LIMITS.onlineAlbums : 0,
        online.kinds.includes('track') ? LIMITS.onlineTracks : 0,
      ]
    : [];
  const [bestCount = 0, albumCount = 0, trackCount = 0] = fitRows(
    budget,
    [...localSizes, ...reserve],
    sections,
  );
  const rows: SearchSuggestion[] = [];
  if (local.best && bestCount) rows.push({ key: bestKey ?? '', group: 'best', hit: local.best });
  for (const hit of albums.slice(0, albumCount))
    rows.push({ key: searchHitKey(hit), group: 'albums', hit });
  for (const hit of tracks.slice(0, trackCount))
    rows.push({ key: searchHitKey(hit), group: 'tracks', hit });
  const result = online?.result;
  if (!result) return rows;
  const onlineTracks = result.tracks.filter(
    (track) => !local.tracks.some((hit) => sameSong(hit.track, track)),
  );
  const left =
    budget === null ? null : budget - sections - heightOf([bestCount, albumCount, trackCount]);
  const [artistRows = 0, albumRows = 0, trackRows = 0] = fitRows(left, [
    Math.min(result.artists.length, LIMITS.onlineArtists),
    Math.min(result.albums.length, LIMITS.onlineAlbums),
    Math.min(onlineTracks.length, LIMITS.onlineTracks),
  ]);
  for (const artist of result.artists.slice(0, artistRows))
    rows.push({ key: `online-artist:${artist.ref.id}`, group: 'onlineArtists', artist });
  for (const album of result.albums.slice(0, albumRows))
    rows.push({ key: `online-album:${album.ref.id}`, group: 'onlineAlbums', album });
  for (const track of onlineTracks.slice(0, trackRows))
    rows.push({ key: `online:${track.ref.id}`, group: 'onlineTracks', track });
  return rows;
}

export function searchOptionId(key: string): string {
  return `search-option-${encodeURIComponent(key)}`;
}
