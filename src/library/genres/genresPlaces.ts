import { atom, type Atom } from 'jotai/vanilla';
import { historyAtom, type NavHistoryService, type HistoryEntry } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import { genresCatalogAtom } from './genresCatalog.ts';
import { genreEntryOf } from './genresSubject.ts';

const selectedAtom = atom<string | null>(null);
export const selectedGenreAtom: Atom<string | null> = atom((get) => get(selectedAtom));
export interface GenresPlacesService {
  select(key: string): void;
  dispose(): void;
}

export function startGenresPlaces(
  store: Store,
  history: Pick<NavHistoryService, 'navigate' | 'registerSubject' | 'subjectsChanged'>,
): GenresPlacesService {
  store.set(selectedAtom, null);
  let last: string | null = null;
  let entry: HistoryEntry | null = null;
  let awaitingFirst = false;
  let disposed = false;
  const exists = (key: string) => {
    const catalog = store.get(genresCatalogAtom);
    return catalog.generation === 0 || genreEntryOf(catalog.entries, key) !== undefined;
  };
  function chooseFirst(): void {
    const catalog = store.get(genresCatalogAtom);
    if (
      !awaitingFirst ||
      store.get(historyAtom).place.id !== 'genres' ||
      catalog.status !== 'ready'
    )
      return;
    awaitingFirst = false;
    const key = last !== null && exists(last) ? last : (catalog.entries[0]?.key ?? null);
    store.set(selectedAtom, key);
    last = key;
    history.subjectsChanged();
  }
  function enter(): void {
    const current = store.get(historyAtom);
    if (disposed) return;
    if (current.place.id !== 'genres') {
      entry = null;
      awaitingFirst = false;
      return;
    }
    if (entry === current.entry) return;
    entry = current.entry;
    const subject = current.place.subject ?? null;
    store.set(selectedAtom, subject);
    awaitingFirst = subject === null;
    if (subject !== null) last = subject;
    chooseFirst();
  }
  const offSubject = history.registerSubject('genres', {
    current: () => store.get(selectedAtom),
    exists,
    replaceMissing: true,
  });
  const offHistory = store.sub(historyAtom, enter);
  const offCatalog = store.sub(genresCatalogAtom, () => {
    chooseFirst();
    history.subjectsChanged();
  });
  enter();
  return {
    select(key) {
      if (disposed) return;
      awaitingFirst = false;
      store.set(selectedAtom, key);
      last = key;
      history.subjectsChanged();
    },
    dispose() {
      disposed = true;
      offCatalog();
      offHistory();
      offSubject();
    },
  };
}
