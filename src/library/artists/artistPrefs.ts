import {
  browserStorage,
  defineLocalPref,
  recordOf,
  storedRecord,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';

export type ArtistBasis = 'albumArtist' | 'credited';
export type ArtistSort = 'name' | 'albums' | 'tracks';
export interface ArtistPrefs {
  readonly basis: ArtistBasis;
  readonly sort: ArtistSort;
  readonly descending: boolean;
  readonly highlight: 'played' | 'popular';
  readonly portraits: Readonly<Record<string, string>>;
}
const DEFAULTS: ArtistPrefs = {
  basis: 'albumArtist',
  sort: 'name',
  descending: false,
  highlight: 'played',
  portraits: {},
};

export function readArtistPrefs(text: string | null): ArtistPrefs {
  const { basis, sort, descending, highlight, portraits } = storedRecord(text);
  return {
    basis: basis === 'credited' ? basis : 'albumArtist',
    sort: sort === 'albums' || sort === 'tracks' ? sort : 'name',
    descending: descending === true,
    highlight: highlight === 'popular' ? 'popular' : 'played',
    portraits: Object.fromEntries(
      Object.entries(recordOf(portraits)).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  };
}

const PREF = defineLocalPref<ArtistPrefs>({
  key: 'default-theme.artists.v1',
  fallback: DEFAULTS,
  parse: readArtistPrefs,
  format: JSON.stringify,
});

export function startArtistPrefs(store: Store, storage: PrefStorage | null = browserStorage()) {
  PREF.load(store, storage);
  return {
    state: PREF.atom,
    update(change: Partial<ArtistPrefs>) {
      PREF.set(store, { ...store.get(PREF.atom), ...change }, storage);
    },
  };
}
export type ArtistPrefsService = ReturnType<typeof startArtistPrefs>;
