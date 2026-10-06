import type { LibraryTrack, PlaycountGetBatchSuccess } from 'foo-webview-sdk';
import {
  albumKeyOf,
  trackAlbumKeyOf,
  trackPathOf,
  type Album,
} from '../../host/libraryContract.ts';

export type HomeMode = 'albums' | 'gems';
export type HomeGemMode = 'forgotten' | 'unplayed';
export type HomeDuration = 0 | 30 | 60;
export type HomePlaycountRow = PlaycountGetBatchSuccess['results'][number];

export interface HomeTrack {
  readonly track: LibraryTrack;
  readonly lastPlayed: string;
}

export interface HomeStatistics {
  readonly recent: readonly Album[];
  readonly added: readonly Album[];
  readonly forgotten: readonly HomeTrack[];
  readonly unplayed: readonly HomeTrack[];
}

export const EMPTY_HOME_STATISTICS: HomeStatistics = {
  recent: [],
  added: [],
  forgotten: [],
  unplayed: [],
};
export const HOME_ALBUM_COUNT = 6;
export const HOME_EXPLORE_COUNT = 3;
export const HOME_TRACK_COUNT = 6;
const HALF_YEAR_MS = 26 * 7 * 24 * 60 * 60 * 1000;

/** 按专辑等概率抽样，时长单位为分钟；未知时长不进入限时结果。 */
export function sampleHomeAlbums(
  albums: readonly Album[],
  duration: HomeDuration,
  count = HOME_EXPLORE_COUNT,
  random: () => number = Math.random,
): Album[] {
  const chosen: Album[] = [];
  let seen = 0;
  for (const album of albums) {
    if (duration && (album.duration <= 0 || album.duration > duration * 60)) continue;
    seen += 1;
    if (chosen.length < count) chosen.push(album);
    else {
      const index = Math.floor(random() * seen);
      if (index < count) chosen[index] = album;
    }
  }
  return chosen;
}

function timestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 0;
  const time = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(time) && time > 0 ? time : 0;
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
      forgotten.push({ track, lastPlayed: row.lastPlayed ?? '' });
    if (addedAt && row.playCount === 0 && !playedAt) unplayed.push({ track, lastPlayed: '' });
  }
  const rank = (times: ReadonlyMap<string, number>) =>
    albums
      .filter((album) => times.has(albumKeyOf(album)))
      .sort(
        (a, b) =>
          (times.get(albumKeyOf(b)) ?? 0) - (times.get(albumKeyOf(a)) ?? 0) ||
          albumKeyOf(a).localeCompare(albumKeyOf(b)),
      )
      .slice(0, HOME_ALBUM_COUNT);
  forgotten.sort(
    (a, b) =>
      timestamp(a.lastPlayed) - timestamp(b.lastPlayed) ||
      a.track.handle.localeCompare(b.track.handle),
  );
  unplayed.sort((a, b) => a.track.handle.localeCompare(b.track.handle));
  return {
    recent: rank(recent),
    added: rank(added),
    forgotten,
    unplayed,
  };
}
