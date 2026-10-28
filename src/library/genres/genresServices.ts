import type { Store } from '../../kit/store.ts';
import type { NavHistoryService } from '../../nav/navHistory.ts';
import type { GenreValuesService } from '../genreValues.ts';
import {
  startGenresActions,
  type GenresActionsDeps,
  type GenresActionsService,
} from './genresActions.ts';
import { startGenresCatalog, type GenresCatalogService } from './genresCatalog.ts';
import { startGenresPlaces, selectedGenreAtom, type GenresPlacesService } from './genresPlaces.ts';
import { startGenresPrefs, genresPrefsAtom, type GenresPrefsService } from './genresPrefs.ts';
import { startGenresRows, type GenresRowsService } from './genresRows.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import {
  startGenresTools,
  type GenresToolsService,
  genresToolsPrefsAtom,
  genresTrackQueryAtom,
} from './genresTools.ts';
import { QUERY_DEBOUNCE_MS } from '../../track/queryInput.ts';

export interface GenresDeps extends GenresActionsDeps {
  readonly history: NavHistoryService;
  readonly genreValues: Pick<GenreValuesService, 'want' | 'retry'>;
}
export interface GenresServices {
  readonly catalog: GenresCatalogService;
  readonly places: GenresPlacesService;
  readonly prefs: GenresPrefsService;
  readonly rows: GenresRowsService;
  readonly actions: GenresActionsService;
  readonly tools: GenresToolsService;
  dispose(): void;
}
export function startGenres(store: Store, deps: GenresDeps): GenresServices {
  const prefs = startGenresPrefs(store);
  const catalog = startGenresCatalog(store, deps.genreValues);
  const rows = startGenresRows(store);
  const places = startGenresPlaces(store, deps.history);
  const actions = startGenresActions(store, deps);
  const sync = (typing = false) =>
    rows.select(
      store.get(selectedGenreAtom),
      store.get(genresPrefsAtom).group,
      store.get(genresTrackQueryAtom).query,
      store.get(genresToolsPrefsAtom).sort,
      typing ? QUERY_DEBOUNCE_MS : 0,
      store.get(genresPrefsAtom).groupDescending,
    );
  const tools = startGenresTools(store, sync);
  const offSelection = store.sub(selectedGenreAtom, sync);
  const offPrefs = store.sub(genresPrefsAtom, sync);
  sync();
  return {
    prefs,
    catalog,
    rows,
    places,
    actions,
    tools,
    dispose() {
      offPrefs();
      offSelection();
      actions.dispose();
      tools.dispose();
      places.dispose();
      rows.dispose();
      catalog.dispose();
    },
  };
}

export const genresKey = serviceKey<GenresServices>('genres');
