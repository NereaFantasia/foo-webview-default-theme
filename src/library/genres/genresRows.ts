import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import type { QueryFill } from '../libraryQueryFill.ts';
import { libraryTracksAtom, TRACK_LIMIT } from '../libraryTracks.ts';
import { genresCatalogAtom } from './genresCatalog.ts';
import { GENRES_SORT } from './genresGroups.ts';
import { genresQuery } from './genresModel.ts';
import type { GenreGrouping } from './genresPrefs.ts';
import { genreEntryOf, genreKeys } from './genresSubject.ts';

export interface GenresRowsState {
  readonly key: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly tracks: readonly LibraryTrack[];
  readonly fill: QueryFill | null;
  readonly stamp: number;
  readonly generation: number;
}
const EMPTY: GenresRowsState = {
  key: null,
  status: 'idle',
  tracks: [],
  fill: null,
  stamp: 0,
  generation: 0,
};
const stateAtom = atom<GenresRowsState>(EMPTY);
export const genresRowsAtom: Atom<GenresRowsState> = atom((get) => get(stateAtom));
export interface GenresRowsFace {
  library: Pick<typeof fb.library, 'query'>;
}
export interface GenresRowsService {
  select(key: string | null, group: GenreGrouping): void;
  retry(): Promise<void>;
  dispose(): void;
}

/** 选中不同流派时立即撤掉旧表；同一流派重取失败可保留旧表，但动作不能使用未确认的新顺序。 */
export function startGenresRows(store: Store, host: GenresRowsFace = fb): GenresRowsService {
  store.set(stateAtom, EMPTY);
  let key: string | null = null;
  let group: GenreGrouping = 'album';
  let serial = 0;
  let disposed = false;
  const update = (change: Partial<GenresRowsState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });
  async function load(): Promise<void> {
    const mine = ++serial;
    if (disposed || key === null) return;
    const target = key;
    const catalog = store.get(genresCatalogAtom);
    if (catalog.status !== 'ready') {
      update({ status: catalog.status === 'failed' ? 'failed' : 'loading', fill: null });
      return;
    }
    const entry = genreEntryOf(catalog.entries, target);
    if (!entry) {
      update({ status: 'ready', tracks: [], fill: null });
      return;
    }
    const query = genresQuery(genreKeys(target));
    const library = store.get(libraryTracksAtom);
    if (query === null) {
      update({
        status: 'ready',
        tracks: entry.tracks,
        fill: null,
        stamp: library.stamp,
        generation: store.get(stateAtom).generation + 1,
      });
      return;
    }
    const fill = { query, sort: GENRES_SORT[group], descending: false };
    update({ status: 'loading' });
    const answer = await settle(() =>
      host.library.query(fill.query, fill.sort, TRACK_LIMIT, ['handle']),
    );
    if (
      disposed ||
      mine !== serial ||
      store.get(libraryTracksAtom).generation !== library.generation
    )
      return;
    if (!answer || answer.success === false) {
      update({ status: 'failed' });
      return;
    }
    const tracks: LibraryTrack[] = [];
    for (const row of answer.tracks) {
      const track = row.handle ? library.byHandle.get(row.handle) : undefined;
      if (!track) {
        update({ status: 'failed' });
        return;
      }
      tracks.push(track);
    }
    update({
      status: 'ready',
      tracks,
      fill,
      stamp: library.stamp,
      generation: store.get(stateAtom).generation + 1,
    });
  }
  const off = store.sub(genresCatalogAtom, () => {
    serial += 1;
    void load();
  });
  return {
    select(next, grouping) {
      if (disposed || (next === key && group === grouping)) return;
      key = next;
      group = grouping;
      serial += 1;
      store.set(stateAtom, { ...EMPTY, key: next, status: next === null ? 'idle' : 'loading' });
      void load();
    },
    retry: load,
    dispose() {
      disposed = true;
      serial += 1;
      off();
    },
  };
}
