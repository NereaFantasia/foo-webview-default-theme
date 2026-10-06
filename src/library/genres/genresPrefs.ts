import type { Atom } from 'jotai/vanilla';
import {
  browserStorage,
  defineLocalPref,
  storedRecord,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import type { GenreSort } from './genresModel.ts';

export const GENRE_GROUPS = [
  'album',
  'albumDisc',
  'albumArtist',
  'artist',
  'directory',
  'none',
] as const;
export type GenreGrouping = (typeof GENRE_GROUPS)[number];
export interface GenresPrefs {
  readonly sort: GenreSort;
  readonly descending: boolean;
  readonly group: GenreGrouping;
}
const DEFAULTS: GenresPrefs = { sort: 'name', descending: false, group: 'album' };

export function isGenreGrouping(value: unknown): value is GenreGrouping {
  return GENRE_GROUPS.some((choice) => choice === value);
}

export function readGenresPrefs(raw: string | null): GenresPrefs {
  const source = storedRecord(raw);
  const sort = source['sort'];
  const descending = source['descending'];
  const group = source['group'];
  return {
    sort: sort === 'name' || sort === 'tracks' || sort === 'albums' ? sort : 'name',
    descending: typeof descending === 'boolean' ? descending : false,
    group: isGenreGrouping(group) ? group : 'album',
  };
}

const PREF = defineLocalPref<GenresPrefs>({
  key: 'default-theme.genres.v1',
  fallback: DEFAULTS,
  parse: readGenresPrefs,
  format: JSON.stringify,
});
export const genresPrefsAtom: Atom<GenresPrefs> = PREF.atom;

export interface GenresPrefsService {
  update(change: Partial<GenresPrefs>): void;
}
export function startGenresPrefs(
  store: Store,
  storage: PrefStorage | null = browserStorage(),
): GenresPrefsService {
  PREF.load(store, storage);
  return {
    update(change) {
      PREF.set(store, { ...store.get(PREF.atom), ...change }, storage);
    },
  };
}
