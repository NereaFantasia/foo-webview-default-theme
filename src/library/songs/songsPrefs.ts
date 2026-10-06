import type { Atom } from 'jotai/vanilla';
import {
  browserStorage,
  defineLocalPref,
  recordOf,
  storedRecord,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import type { ColumnId } from '../../table/columns/columns.ts';
import { isQueryScope, type QueryScope } from '../../track/trackQuery.ts';
import { isSongsSortColumn } from './songsSort.ts';

/**
 * 歌曲页在这台机器上的偏好：按哪一列排、过滤框的字段范围、分面条开没开、行的疏密。界面偏好，存 localStorage，
 * 不进宿主 config。读回逐项校验，坏了哪一项就用缺省补哪一项。
 */
export const SONGS_STORAGE_KEY = 'default-theme.songs.v1';

export interface SongsSort {
  readonly column: ColumnId;
  readonly descending: boolean;
}

/** 行的疏密，从密到疏。行高与缩略图边长随它走。 */
export const SONGS_DENSITIES = ['compact', 'standard', 'comfortable'] as const;
export type SongsDensity = (typeof SONGS_DENSITIES)[number];

export function isSongsDensity(value: unknown): value is SongsDensity {
  return SONGS_DENSITIES.some((density) => density === value);
}

export interface SongsPrefs {
  readonly sort: SongsSort;
  readonly scope: QueryScope;
  readonly facetsOpen: boolean;
  readonly density: SongsDensity;
}

export const DEFAULT_SONGS_PREFS: SongsPrefs = {
  sort: { column: 'artist', descending: false },
  scope: 'all',
  facetsOpen: false,
  density: 'standard',
};

/** 校验一份存档；不是 JSON、不是对象都当没有存档。 */
export function parseSongsPrefs(raw: string | null): SongsPrefs {
  const source = storedRecord(raw);
  const sort = recordOf(source['sort']);
  const column = sort['column'];
  const scope = source['scope'];
  const density = source['density'];
  return {
    sort: {
      column: isSongsSortColumn(column) ? column : DEFAULT_SONGS_PREFS.sort.column,
      descending: sort['descending'] === true,
    },
    scope: isQueryScope(scope) ? scope : DEFAULT_SONGS_PREFS.scope,
    facetsOpen: source['facetsOpen'] === true,
    density: isSongsDensity(density) ? density : DEFAULT_SONGS_PREFS.density,
  };
}

const PREF = defineLocalPref<SongsPrefs>({
  key: SONGS_STORAGE_KEY,
  fallback: DEFAULT_SONGS_PREFS,
  parse: parseSongsPrefs,
  format: JSON.stringify,
});

export const songsPrefsAtom: Atom<SongsPrefs> = PREF.atom;

export interface SongsPrefsService {
  /** 点了这一列的列头：同一列再点换方向，换一列从升序起。能不能排由调用方先判断。 */
  sortBy(column: ColumnId): void;
  setScope(scope: QueryScope): void;
  setFacetsOpen(open: boolean): void;
  setDensity(density: SongsDensity): void;
  /** 排序回到缺省（艺术家升序）。 */
  resetSort(): void;
}

export function startSongsPrefs(
  store: Store,
  storage: PrefStorage | null = browserStorage(),
): SongsPrefsService {
  PREF.load(store, storage);

  function save(change: Partial<SongsPrefs>): void {
    PREF.set(store, { ...store.get(PREF.atom), ...change }, storage);
  }

  return {
    sortBy(column) {
      const { sort } = store.get(PREF.atom);
      save({
        sort: { column, descending: sort.column === column ? !sort.descending : false },
      });
    },
    setScope(scope) {
      if (store.get(PREF.atom).scope !== scope) save({ scope });
    },
    setFacetsOpen(open) {
      if (store.get(PREF.atom).facetsOpen !== open) save({ facetsOpen: open });
    },
    setDensity(density) {
      if (store.get(PREF.atom).density !== density) save({ density });
    },
    resetSort() {
      save({ sort: DEFAULT_SONGS_PREFS.sort });
    },
  };
}
