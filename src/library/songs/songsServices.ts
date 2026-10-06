import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { NavHistoryService } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import { isQueryableValue } from '../../track/trackQuery.ts';
import { QUERY_DEBOUNCE_MS, queryInputText } from '../../track/queryInput.ts';
import type { QueryFill } from '../libraryQueryFill.ts';
import {
  startSongsActions,
  type SongsActionsDeps,
  type SongsActionsFace,
  type SongsActionsService,
} from './songsActions.ts';
import {
  songsFilterAtom,
  EMPTY_SONGS_FILTER,
  songsQueryOf,
  startSongsFilter,
  type SongsFilterService,
  type SongsQuery,
} from './songsFilter.ts';
import { songsPrefsAtom, startSongsPrefs, type SongsPrefsService } from './songsPrefs.ts';
import { startSongsRows, type SongsRowsFace, type SongsRowsService } from './songsRows.ts';
import { songsSortPattern } from './songsSort.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/** 打字到问宿主之间的静默期，毫秒；勾预设、点分面、换排序不等。 */
export const TYPING_DEBOUNCE_MS = QUERY_DEBOUNCE_MS;

/** 此刻的筛选拼成的查询。 */
export const songsQueryAtom: Atom<SongsQuery> = atom((get) =>
  songsQueryOf(get(songsFilterAtom), get(songsPrefsAtom).scope),
);

/** 此刻交给宿主的那一份：查询、排序串与方向。表格的顺序与填表起播都按它。 */
export const songsFillAtom: Atom<QueryFill> = atom((get) => {
  const { sort } = get(songsPrefsAtom);
  return {
    query: get(songsQueryAtom).query,
    sort: songsSortPattern(sort.column),
    descending: sort.descending,
  };
});

export type SongsFace = SongsRowsFace & SongsActionsFace;

export interface SongsServices {
  readonly prefs: SongsPrefsService;
  readonly filter: SongsFilterService;
  readonly rows: SongsRowsService;
  readonly actions: SongsActionsService;
  /** 打开歌曲页，仅保留指定流派（栏内或）；值不能写成精确查询时不改变筛选或地点，答假。 */
  openWithGenres(names: readonly string[]): boolean;
  dispose(): void;
}

export interface SongsDeps extends SongsActionsDeps {
  readonly history: Pick<NavHistoryService, 'navigate'>;
}

/**
 * 歌曲页的服务：偏好、筛选、宿主排好的顺序与成批命令。筛选或排序一变就按新的查询向顺序服务要一次；只改了框里的字
 * 时等 `TYPING_DEBOUNCE_MS`，回车由页面调 `rows.flush()`。
 */
export function startSongs(store: Store, deps: SongsDeps, host: SongsFace = fb): SongsServices {
  const prefs = startSongsPrefs(store);
  const filter = startSongsFilter(store);
  const rows = startSongsRows(store, host);
  const actions = startSongsActions(store, deps, host);
  let disposed = false;
  let previous = store.get(songsFilterAtom);
  const sync = () => {
    const next = store.get(songsFilterAtom);
    const typing = next.mode === previous.mode && queryInputText(next) !== queryInputText(previous);
    previous = next;
    rows.request(store.get(songsFillAtom), typing ? TYPING_DEBOUNCE_MS : 0);
  };
  sync();
  const offFilter = store.sub(songsFilterAtom, sync);
  const offPrefs = store.sub(songsPrefsAtom, sync);
  return {
    prefs,
    filter,
    rows,
    actions,
    openWithGenres(names) {
      if (disposed || names.length === 0 || !names.every(isQueryableValue)) return false;
      // 先离开旧记录，让它捕获原筛选；新记录只带调用方指定的流派。
      deps.history.navigate({ id: 'songs' });
      filter.restore({
        ...EMPTY_SONGS_FILTER,
        facets: { ...EMPTY_SONGS_FILTER.facets, genre: new Set(names) },
      });
      rows.flush();
      return true;
    },
    dispose() {
      disposed = true;
      offPrefs();
      offFilter();
      actions.dispose();
      rows.dispose();
    },
  };
}

export const songsKey = serviceKey<SongsServices>('songs');
