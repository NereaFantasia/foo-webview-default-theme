import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { EMPTY_TRACK_FILTER, type TrackFilter } from '../../track/trackFilter.ts';
import { startTrackFilter, type TrackFilterService } from '../../track/trackFilterState.ts';

export const EMPTY_SONGS_FILTER = EMPTY_TRACK_FILTER;
const filterAtom = atom<TrackFilter>(EMPTY_SONGS_FILTER);
export const songsFilterAtom: Atom<TrackFilter> = atom((get) => get(filterAtom));
export type SongsFilterService = TrackFilterService;

export function startSongsFilter(store: Store): SongsFilterService {
  return startTrackFilter(store, filterAtom);
}
