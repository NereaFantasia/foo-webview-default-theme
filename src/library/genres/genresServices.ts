import type { Store } from '../../kit/store.ts';
import type { NavHistoryService } from '../../nav/navHistory.ts';
import type { LibraryTracksService } from '../libraryTracks.ts';
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

export interface GenresDeps extends GenresActionsDeps {
  readonly history: NavHistoryService;
  readonly tracks: Pick<LibraryTracksService, 'want' | 'retry'>;
}
export interface GenresServices {
  readonly catalog: GenresCatalogService;
  readonly places: GenresPlacesService;
  readonly prefs: GenresPrefsService;
  readonly rows: GenresRowsService;
  readonly actions: GenresActionsService;
  dispose(): void;
}
export function startGenres(store: Store, deps: GenresDeps): GenresServices {
  const prefs = startGenresPrefs(store);
  const catalog = startGenresCatalog(store, deps.tracks);
  const rows = startGenresRows(store);
  const places = startGenresPlaces(store, deps.history);
  const actions = startGenresActions(store, deps);
  const sync = () => rows.select(store.get(selectedGenreAtom), store.get(genresPrefsAtom).group);
  const offSelection = store.sub(selectedGenreAtom, sync);
  const offPrefs = store.sub(genresPrefsAtom, sync);
  sync();
  return {
    prefs,
    catalog,
    rows,
    places,
    actions,
    dispose() {
      offPrefs();
      offSelection();
      actions.dispose();
      places.dispose();
      rows.dispose();
      catalog.dispose();
    },
  };
}

export const genresKey = serviceKey<GenresServices>('genres');
