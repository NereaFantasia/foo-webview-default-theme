import type { FavoriteEntry } from '../../server/musicFavorites.ts';
import type {
  MusicAlbum,
  MusicArtist,
  MusicPlaylist,
  MusicTrack,
} from '../../server/musicObjects.ts';

/** 曲目表能按哪些字段排；`added` 是收藏时间 */
export const TRACK_SORT_FIELDS = ['added', 'title', 'artist', 'album', 'duration'] as const;
export type TrackSortField = (typeof TRACK_SORT_FIELDS)[number];

/** 封面墙（专辑、艺人、歌单）能按哪些字段排 */
export const WALL_SORT_FIELDS = ['added', 'name'] as const;
export type WallSortField = (typeof WALL_SORT_FIELDS)[number];

export interface FavoriteSort<F extends string> {
  readonly field: F;
  readonly descending: boolean;
}

export interface Keyed {
  readonly item: { readonly ref: { readonly id: string } };
}

const idOf = (entry: Keyed): string => entry.item.ref.id;

/**
 * 本页取消过收藏的条目：上一回读到、这一回不在收藏里的留下来。同一条目留的是第一次的那份，
 * 取消后又收回来时收藏时间变了，页面里这一行仍按原来的时间排，不跳位置
 */
export function keepRemoved<E extends Keyed>(
  before: readonly E[],
  live: readonly E[],
  kept: ReadonlyMap<string, E>,
): ReadonlyMap<string, E> {
  const liveIds = new Set(live.map(idOf));
  let next: Map<string, E> | null = null;
  for (const entry of before) {
    const id = idOf(entry);
    if (liveIds.has(id) || kept.has(id)) continue;
    next ??= new Map(kept);
    next.set(id, entry);
  }
  return next ?? kept;
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * 收藏页显示的条目：此刻的收藏加上本页取消过、还留着的；收回来的用留着的那份。
 * `removed` 是其中此刻已经不在收藏里的那些
 */
export function withKept<E extends Keyed>(
  live: readonly E[],
  kept: ReadonlyMap<string, E>,
): { readonly rows: readonly E[]; readonly removed: ReadonlySet<string> } {
  if (kept.size === 0) return { rows: live, removed: NO_IDS };
  const liveIds = new Set(live.map(idOf));
  const rows = live.map((entry) => kept.get(idOf(entry)) ?? entry);
  const removed = new Set<string>();
  for (const [id, entry] of kept) {
    if (liveIds.has(id)) continue;
    rows.push(entry);
    removed.add(id);
  }
  return { rows, removed };
}

/** 缺省：收藏时间新到旧 */
export const DEFAULT_SORT: FavoriteSort<'added'> = { field: 'added', descending: true };

const artistLine = (credits: readonly { readonly name: string }[]) =>
  credits.map((credit) => credit.name).join(', ');

/** 查找用的文字：标题、别名与译名、署名及其别名、专辑名；只用于匹配，不显示 */
export function trackText(track: MusicTrack): string {
  return [
    track.title,
    track.subtitle ?? '',
    ...(track.aliases ?? []),
    ...track.artists.flatMap((artist) => [artist.name, ...(artist.aliases ?? [])]),
    track.album?.title ?? '',
  ].join('\n');
}

export function albumText(album: MusicAlbum): string {
  return [
    album.title,
    ...album.artists.flatMap((artist) => [artist.name, ...(artist.aliases ?? [])]),
  ].join('\n');
}

export const artistText = (artist: MusicArtist): string =>
  [artist.name, ...(artist.aliases ?? [])].join('\n');

export const playlistText = (playlist: MusicPlaylist): string => playlist.title;

/** 查找词：不分大小写，按空白拆开，每个词都要出现 */
export function queryWords(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function filtered<E extends { readonly item: unknown }>(
  entries: readonly E[],
  words: readonly string[],
  textOf: (item: E['item']) => string,
): readonly E[] {
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const text = textOf(entry.item).toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * 收藏页曲目表显示的行：先按查找筛，再按所选字段排；值相同的按收藏时间新到旧。没有时长的排在升序的最前
 */
export function trackRows(
  entries: readonly FavoriteEntry<'track'>[],
  query: string,
  sort: FavoriteSort<TrackSortField>,
  collator: Intl.Collator,
): readonly FavoriteEntry<'track'>[] {
  const shown = filtered(entries, queryWords(query), trackText);
  const compare = (a: FavoriteEntry<'track'>, b: FavoriteEntry<'track'>): number => {
    switch (sort.field) {
      case 'title':
        return collator.compare(a.item.title, b.item.title);
      case 'artist':
        return collator.compare(artistLine(a.item.artists), artistLine(b.item.artists));
      case 'album':
        return collator.compare(a.item.album?.title ?? '', b.item.album?.title ?? '');
      case 'duration':
        return (a.item.durationMs ?? -1) - (b.item.durationMs ?? -1);
      case 'added':
        return a.addedAt - b.addedAt;
    }
  };
  const sign = sort.descending ? -1 : 1;
  return [...shown].sort((a, b) => sign * compare(a, b) || b.addedAt - a.addedAt);
}

/** 封面墙显示的行：同样先筛再排，名称按各自的名字（专辑与歌单是标题，艺人是名字） */
export function wallRows<
  E extends {
    readonly item: MusicAlbum | MusicArtist | MusicPlaylist;
    readonly addedAt: number;
  },
>(
  entries: readonly E[],
  query: string,
  sort: FavoriteSort<WallSortField>,
  collator: Intl.Collator,
  textOf: (item: E['item']) => string,
  nameOf: (item: E['item']) => string,
): readonly E[] {
  const shown = filtered(entries, queryWords(query), textOf);
  const sign = sort.descending ? -1 : 1;
  return [...shown].sort((a, b) => {
    const order =
      sort.field === 'name'
        ? collator.compare(nameOf(a.item), nameOf(b.item))
        : a.addedAt - b.addedAt;
    return sign * order || b.addedAt - a.addedAt;
  });
}
