import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { historyAtom, type HistoryEntry, type NavHistoryService } from '../../nav/navHistory.ts';
import type { ArtistRow } from './artistIndex.ts';
import type { ArtistPrefsService } from './artistPrefs.ts';

export interface ArtistPlacesDeps {
  readonly history: Pick<NavHistoryService, 'navigate' | 'registerSubject' | 'subjectsChanged'>;
  readonly own: Atom<readonly ArtistRow[]>;
  readonly all: Atom<readonly ArtistRow[]>;
  readonly loaded: Atom<boolean>;
  readonly prefs: ArtistPrefsService;
  readonly complete?: Atom<boolean>;
}

/** 没有主体的记录是封面墙，有主体的是那位艺人的详情；打开一位艺人新增一条记录 */
export function startArtistPlaces(
  store: ReturnType<typeof createStore>,
  deps: ArtistPlacesDeps,
  selected = atom<string | null>(null),
  temporary = atom(false),
) {
  let entry: HistoryEntry | null = null;
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
  }
  function enter(): void {
    if (disposed) return;
    const current = store.get(historyAtom);
    if (current.place.id !== 'artists') {
      entry = null;
      return;
    }
    if (entry === current.entry) return;
    entry = current.entry;
    const subject = current.place.subject;
    // 回到墙上不清主体：后退时离场的详情层还要接着画上一位，墙按自己记录的地点画
    if (subject === undefined) store.set(temporary, false);
    else assign(subject);
  }
  // 不登记 current：墙与详情各是一条记录，页面不再原地换主体；登记了，在详情页点侧边栏「艺人」会被补成这位艺人
  // ponytail: 列表形态（select 原地改写主体）回来时要重新登记 current，并区分墙与列表
  const offSubject = deps.history.registerSubject('artists', {
    exists,
    replaceMissing: true,
  });
  const stops = [
    offSubject,
    store.sub(historyAtom, enter),
    store.sub(deps.all, () => deps.history.subjectsChanged()),
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
      assign(name);
      deps.history.subjectsChanged();
    },
    open(name: string) {
      if (!disposed) deps.history.navigate({ id: 'artists', subject: name }, 'drill');
    },
    resetTemporary() {
      if (disposed) return;
      store.set(temporary, false);
      deps.history.navigate({ id: 'artists' });
    },
    dispose() {
      disposed = true;
      stops.forEach((stop) => stop());
    },
  };
}
export type ArtistPlacesService = ReturnType<typeof startArtistPlaces>;
