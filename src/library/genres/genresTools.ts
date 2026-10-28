import { atom } from 'jotai/vanilla';
import { defineLocalPref, recordOf, storedRecord } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { EMPTY_TRACK_FILTER, trackQueryOf } from '../../track/trackFilter.ts';
import { startTrackFilter, type TrackFilterService } from '../../track/trackFilterState.ts';
import { isQueryScope, type QueryScope } from '../../track/trackQuery.ts';
import { isTrackSortColumn } from '../../track/trackSort.ts';

interface GenresToolsPrefs {
  readonly scope: QueryScope;
  readonly sort: TableSort | null;
}
const PREF = defineLocalPref<GenresToolsPrefs>({
  key: 'default-theme.genres-tools.v1',
  fallback: { scope: 'all', sort: null },
  parse(raw) {
    const source = storedRecord(raw);
    const sort = recordOf(source['sort']);
    return {
      scope: isQueryScope(source['scope']) ? source['scope'] : 'all',
      sort: isTrackSortColumn(sort['column'])
        ? { column: sort['column'], descending: sort['descending'] === true }
        : null,
    };
  },
  format: JSON.stringify,
});
export const genresToolsPrefsAtom = PREF.atom;
const filterAtom = atom(EMPTY_TRACK_FILTER);
export const genresFilterAtom = atom((get) => get(filterAtom));
export const genresTrackQueryAtom = atom((get) =>
  trackQueryOf(get(filterAtom), get(PREF.atom).scope),
);

export interface GenresToolsService {
  readonly filter: TrackFilterService;
  setScope(scope: QueryScope): void;
  setSort(sort: TableSort | null): void;
  dispose(): void;
}

/** 流派右侧曲目表的筛选与排序；`changed` 在条件变了之后叫，输入途中 `typing` 为真，由调用方去抖 */
export function startGenresTools(
  store: Store,
  changed: (typing: boolean) => void,
): GenresToolsService {
  PREF.load(store);
  const filter = startTrackFilter(store, filterAtom, changed);
  return {
    filter,
    setScope(scope) {
      PREF.set(store, { ...store.get(PREF.atom), scope });
      changed(false);
    },
    setSort(sort) {
      PREF.set(store, { ...store.get(PREF.atom), sort });
      changed(false);
    },
    dispose: filter.dispose,
  };
}
