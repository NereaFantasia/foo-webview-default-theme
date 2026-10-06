import type { RatedTrack } from './ratingLedger.ts';
import type { TrackRatingsService } from './trackRatings.ts';

export type MenuRating = number | 'mixed' | null;

export function menuRatingOf(
  ratings: Pick<TrackRatingsService, 'ratingOf'>,
  tracks: readonly RatedTrack[],
  stamps: number | readonly number[],
): MenuRating {
  const values = new Set(
    tracks.map((track, index) =>
      ratings.ratingOf(track, typeof stamps === 'number' ? stamps : (stamps[index] ?? 0)),
    ),
  );
  return values.size > 1 ? 'mixed' : (values.values().next().value ?? null);
}

export async function rateMenuTracks(
  ratings: Pick<TrackRatingsService, 'setRating'>,
  tracks: readonly RatedTrack[],
  value: number,
): Promise<boolean> {
  const unique = new Map(tracks.map((track) => [track.handle, track]));
  // 首次失败就停下，避免后续成功写入清掉失败提示；已成功的曲目由评分账本保留。
  for (const track of unique.values()) {
    if (!(await ratings.setRating(track, value))) return false;
  }
  return unique.size > 0;
}
