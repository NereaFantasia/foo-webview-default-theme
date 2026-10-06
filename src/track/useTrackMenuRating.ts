import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import type { Translate } from '../i18n/translate.ts';
import type { RatedTrack } from './ratingLedger.ts';
import { ratingsVersionAtom, type TrackRatingsService } from './trackRatings.ts';
import { trackRatingEntries } from './trackMenuEntries.ts';
import { menuRatingOf, rateMenuTracks } from './trackMenuRating.ts';

export function useTrackMenuRating(
  t: Translate,
  ratings: Pick<TrackRatingsService, 'watch' | 'ratingOf' | 'canRate' | 'setRating'>,
  tracks: readonly RatedTrack[],
  stamps: number | readonly number[],
  active: boolean,
) {
  useAtomValueRawSync(ratingsVersionAtom);
  useEffect(
    () => (active ? ratings.watch(tracks, stamps) : undefined),
    [ratings, tracks, stamps, active],
  );
  const enabled = tracks.length > 0 && tracks.every((track) => ratings.canRate(track));
  const entry = trackRatingEntries(
    t,
    menuRatingOf(ratings, tracks, stamps),
    (value) => void rateMenuTracks(ratings, tracks, value),
    !enabled,
  );
  return {
    ...entry,
    reason: !enabled
      ? t(tracks.length ? 'context.ratingUnavailable' : 'context.ratingUnknown')
      : undefined,
  };
}
