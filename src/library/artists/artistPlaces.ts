import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { historyAtom, type HistoryEntry, type NavHistoryService } from '../../nav/navHistory.ts';
import type { ArtistRow } from './artistIndex.ts';
import type { ArtistPrefsService } from './artistPrefs.ts';
import { filterArtists } from './artistCatalog.ts';

export interface ArtistPlacesDeps {
  readonly history: Pick<NavHistoryService, 'navigate' | 'registerSubject' | 'subjectsChanged'>;
  readonly own: Atom<readonly ArtistRow[]>;
  readonly all: Atom<readonly ArtistRow[]>;
  readonly loaded: Atom<boolean>;
  readonly prefs: ArtistPrefsService;
  readonly locale?: Atom<string>;
  readonly complete?: Atom<boolean>;
}

/** 列表选择改写当前记录，外部深入才新增记录；历史中的无主体记录始终保留无主体。 */
export function startArtistPlaces(
  store: ReturnType<typeof createStore>,
  deps: ArtistPlacesDeps,
  selected = atom<string | null>(null),
  temporary = atom(false),
) {
  const seen = new WeakSet<HistoryEntry>();
  let entry: HistoryEntry | null = null;
  let awaitingFirst = false;
  let last: string | null = null;
  let disposed = false;
  const own = (name: string) => store.get(deps.own).some((row) => row.name === name);
  const exists = (name: string) =>
    !store.get(deps.complete ?? deps.loaded) ||
    store.get(deps.all).some((row) => row.name === name);
  function assign(name: string | null): void {
    store.set(selected, name);
    store.set(
      temporary,
      name !== null && store.get(deps.prefs.state).basis === 'albumArtist' && !own(name),
    );
    if (name !== null) last = name;
  }
  function chooseFirst(): void {
    if (!awaitingFirst || !store.get(deps.loaded)) return;
    awaitingFirst = false;
    const rows =
      store.get(deps.prefs.state).basis === 'credited' ? store.get(deps.all) : store.get(deps.own);
    const ordered = filterArtists(
      rows,
      '',
      store.get(deps.prefs.state),
      deps.locale ? store.get(deps.locale) : 'en',
    );
    const name =
      last !== null && rows.some((row) => row.name === last) ? last : (ordered[0]?.name ?? null);
    assign(name);
    deps.history.subjectsChanged();
  }
  function enter(): void {
    if (disposed) return;
    const current = store.get(historyAtom);
    if (current.place.id !== 'artists') {
      entry = null;
      awaitingFirst = false;
      return;
    }
    if (entry === current.entry) return;
    entry = current.entry;
    const restored = seen.has(entry);
    seen.add(entry);
    assign(current.place.subject ?? null);
    awaitingFirst = !restored && current.place.subject === undefined;
    chooseFirst();
  }
  const offSubject = deps.history.registerSubject('artists', {
    current: () => (store.get(historyAtom).place.id === 'artists' ? store.get(selected) : null),
    exists,
    replaceMissing: true,
  });
  const stops = [
    offSubject,
    store.sub(historyAtom, enter),
    store.sub(deps.loaded, chooseFirst),
    store.sub(deps.all, () => {
      chooseFirst();
      deps.history.subjectsChanged();
    }),
    store.sub(deps.prefs.state, () => {
      const name = store.get(selected);
      if (name !== null) assign(name);
    }),
  ];
  enter();
  return {
    selected: atom((get) => get(selected)),
    temporary: atom((get) => get(temporary)),
    select(name: string) {
      if (disposed) return;
      awaitingFirst = false;
      assign(name);
      deps.history.subjectsChanged();
    },
    open(name: string) {
      if (!disposed) deps.history.navigate({ id: 'artists', subject: name }, 'drill');
    },
    resetTemporary() {
      if (disposed) return;
      store.set(temporary, false);
      const name = store.get(deps.own)[0]?.name ?? null;
      assign(name);
      if (name === null) {
        deps.history.navigate({ id: 'artists' });
        return;
      }
      deps.history.subjectsChanged();
    },
    dispose() {
      disposed = true;
      stops.forEach((stop) => stop());
    },
  };
}
export type ArtistPlacesService = ReturnType<typeof startArtistPlaces>;
