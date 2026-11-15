import type { LibraryTrack, PlaycountGetBatchSuccess } from 'foo-webview-sdk';
import {
  albumKeyOf,
  trackAlbumArtistOf,
  trackAlbumKeyOf,
  trackPathOf,
  type Album,
  type AlbumKey,
} from '../../host/libraryContract.ts';

export type HomeGemMode = 'forgotten' | 'unplayed';
export type HomePlaycountRow = PlaycountGetBatchSuccess['results'][number];

export interface HomeTrack {
  readonly track: LibraryTrack;
  /** 最近一次播放的时间，Unix 毫秒；没播放过是 0 */
  readonly playedAt: number;
}

export interface HomeRecentAlbum {
  readonly album: Album;
  /** 专辑里最近一次播放的时间，Unix 毫秒 */
  readonly playedAt: number;
}

/** 按累计播放次数排的一张榜 */
export interface HomeRank<T> {
  /** 次数最多的 `HOME_RANK_COUNT` 个，从高到低；没播放过的不在其中 */
  readonly top: readonly { readonly item: T; readonly plays: number }[];
  /** 播放过的条目总数 */
  readonly played: number;
}

export interface HomeArtistPlays {
  /** 专辑艺人署名，没有时取艺人 */
  readonly name: string;
  /** 这位艺人名下播放过的专辑数 */
  readonly albums: number;
  /** 其中播放最多的一张，头像取它的封面；专辑清单里没有时为 null */
  readonly cover: Album | null;
}

export interface HomeMostPlayed {
  readonly tracks: HomeRank<LibraryTrack>;
  readonly albums: HomeRank<Album>;
  readonly artists: HomeRank<HomeArtistPlays>;
  /** 全库累计播放次数 */
  readonly plays: number;
}

export interface HomeStatistics {
  readonly recent: readonly HomeRecentAlbum[];
  readonly added: readonly Album[];
  readonly forgotten: readonly HomeTrack[];
  readonly unplayed: readonly HomeTrack[];
  readonly mostPlayed: HomeMostPlayed;
  /** 最近 12 个自然月每月添加的曲目数，从早到晚，最后一项是本月 */
  readonly addedByMonth: readonly number[];
  /** 最近 30 天添加的曲目数 */
  readonly addedRecently: number;
}

const EMPTY_RANK = { top: [], played: 0 };
export const EMPTY_HOME_STATISTICS: HomeStatistics = {
  recent: [],
  added: [],
  forgotten: [],
  unplayed: [],
  mostPlayed: { tracks: EMPTY_RANK, albums: EMPTY_RANK, artists: EMPTY_RANK, plays: 0 },
  addedByMonth: Array.from({ length: 12 }, () => 0),
  addedRecently: 0,
};
export const HOME_ALBUM_COUNT = 12;
export const HOME_RANK_COUNT = 10;
const MONTH_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** 重听遗珠一批的曲目数：三列，每列四行 */
export const HOME_TRACK_COUNT = 12;
const HALF_YEAR_MS = 26 * 7 * 24 * 60 * 60 * 1000;

function timestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 0;
  const time = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(time) && time > 0 ? time : 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 距今多久的说法，如「昨天」「上周」「去年」：按隔了几个自然日取天、周、月、年里的一档
 * 时刻晚于现在的按今天算
 */
export function homeAgo(at: number, now: number, locale: string): string {
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((midnight(now) - midnight(at)) / DAY_MS));
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (days < 7) return format.format(-days, 'day');
  if (days < 30) return format.format(-Math.round(days / 7), 'week');
  if (days < 365) return format.format(-Math.round(days / 30), 'month');
  return format.format(-Math.floor(days / 365), 'year');
}

export function homeGemQuery(mode: HomeGemMode): string {
  return mode === 'forgotten'
    ? '%rating% GREATER 3 AND %last_played% PRESENT AND NOT %last_played% DURING LAST 26 WEEKS'
    : '%added% PRESENT AND NOT %play_count% GREATER 0 AND NOT %last_played% PRESENT';
}

export function homeStatistics(
  albums: readonly Album[],
  tracks: readonly LibraryTrack[],
  statistics: ReadonlyMap<string, HomePlaycountRow>,
  now = Date.now(),
): HomeStatistics {
  const recent = new Map<string, number>();
  const added = new Map<string, number>();
  const forgotten: HomeTrack[] = [];
  const unplayed: HomeTrack[] = [];
  const trackPlays: { item: LibraryTrack; plays: number }[] = [];
  const albumPlays = new Map<string, number>();
  const artistPlays = new Map<string, { plays: number; albums: Map<AlbumKey, number> }>();
  const addedByMonth = Array.from({ length: 12 }, () => 0);
  const today = new Date(now);
  const thisMonth = today.getFullYear() * 12 + today.getMonth();
  let addedRecently = 0;
  let plays = 0;
  for (const track of tracks) {
    const row = statistics.get(trackPathOf(track));
    if (!row?.success) continue;
    const playedAt = timestamp(row.lastPlayed);
    const addedAt = timestamp(row.added);
    const key = trackAlbumKeyOf(track);
    if (key) {
      if (playedAt) recent.set(key, Math.max(recent.get(key) ?? 0, playedAt));
      if (addedAt) added.set(key, Math.max(added.get(key) ?? 0, addedAt));
    }
    if ((row.rating ?? track.rating) >= 4 && playedAt && playedAt < now - HALF_YEAR_MS)
      forgotten.push({ track, playedAt });
    if (addedAt && row.playCount === 0 && !playedAt) unplayed.push({ track, playedAt: 0 });
    if (addedAt) {
      const at = new Date(addedAt);
      const monthsAgo = thisMonth - (at.getFullYear() * 12 + at.getMonth());
      if (monthsAgo >= 0 && monthsAgo < 12)
        addedByMonth[11 - monthsAgo] = (addedByMonth[11 - monthsAgo] ?? 0) + 1;
      if (addedAt > now - MONTH_DAYS_MS && addedAt <= now) addedRecently += 1;
    }
    const count = row.playCount ?? 0;
    if (count <= 0) continue;
    plays += count;
    trackPlays.push({ item: track, plays: count });
    if (key) albumPlays.set(key, (albumPlays.get(key) ?? 0) + count);
    const artist = trackAlbumArtistOf(track).trim();
    if (!artist) continue;
    const entry = artistPlays.get(artist) ?? { plays: 0, albums: new Map<AlbumKey, number>() };
    entry.plays += count;
    if (key) entry.albums.set(key, (entry.albums.get(key) ?? 0) + count);
    artistPlays.set(artist, entry);
  }
  const latest = (times: ReadonlyMap<string, number>) =>
    albums
      .filter((album) => times.has(albumKeyOf(album)))
      .sort(
        (a, b) =>
          (times.get(albumKeyOf(b)) ?? 0) - (times.get(albumKeyOf(a)) ?? 0) ||
          albumKeyOf(a).localeCompare(albumKeyOf(b)),
      )
      .slice(0, HOME_ALBUM_COUNT);
  const catalog = new Map(albums.map((album) => [albumKeyOf(album), album]));
  const favorite = (plays: ReadonlyMap<AlbumKey, number>): Album | null => {
    const [key] = [...plays].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    return (key !== undefined && catalog.get(key)) || null;
  };
  const rank = <T>(
    entries: { item: T; plays: number }[],
    tieBreak: (item: T) => string,
  ): HomeRank<T> => ({
    top: entries
      .sort((a, b) => b.plays - a.plays || tieBreak(a.item).localeCompare(tieBreak(b.item)))
      .slice(0, HOME_RANK_COUNT),
    played: entries.length,
  });
  forgotten.sort((a, b) => a.playedAt - b.playedAt || a.track.handle.localeCompare(b.track.handle));
  unplayed.sort((a, b) => a.track.handle.localeCompare(b.track.handle));
  return {
    recent: latest(recent).map((album) => ({
      album,
      playedAt: recent.get(albumKeyOf(album)) ?? 0,
    })),
    added: latest(added),
    forgotten,
    unplayed,
    mostPlayed: {
      tracks: rank(trackPlays, (track) => track.handle),
      albums: rank(
        albums.flatMap((album) => {
          const count = albumPlays.get(albumKeyOf(album));
          return count ? [{ item: album, plays: count }] : [];
        }),
        albumKeyOf,
      ),
      artists: rank(
        [...artistPlays].map(([name, entry]) => ({
          item: { name, albums: entry.albums.size, cover: favorite(entry.albums) },
          plays: entry.plays,
        })),
        (artist) => artist.name,
      ),
      plays,
    },
    addedByMonth,
    addedRecently,
  };
}
