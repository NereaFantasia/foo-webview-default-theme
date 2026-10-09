import { atom, type Atom } from 'jotai/vanilla';
import type { PageTransitionKind } from '../motion/pageTransition.ts';
import type { Store } from '../kit/store.ts';
import { defaultTransition, samePlace, START_PLACE, type Place } from './places.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import {
  startHistory,
  type HistoryArrival,
  type HistoryState,
  type HistoryService,
} from './historyStack.ts';

export { createSnapshotSlot } from './historyStack.ts';
export type { HistoryEntry, SnapshotSlot, SnapshotHooks, SubjectHooks } from './historyStack.ts';
export type Arrival = HistoryArrival<PageTransitionKind>;
export type NavHistoryState = HistoryState<Place, PageTransitionKind>;
export type NavHistoryService = Omit<HistoryService<Place, PageTransitionKind>, 'replace'>;

export const NAV_HISTORY_LIMIT = 50;

const stateAtom = atom<NavHistoryState>({
  entry: { key: 0 },
  place: START_PLACE,
  previous: null,
  next: null,
  arrival: null,
});

export const historyAtom: Atom<NavHistoryState> = atom((get) => get(stateAtom));

/** 主视图历史不落盘；页面、主体与快照属于本次打开窗口的导航。 */
export function startNavHistory(
  store: Store,
  start: Place = START_PLACE,
  limit: number = NAV_HISTORY_LIMIT,
): NavHistoryService {
  return startHistory(store, stateAtom, start, {
    same: samePlace,
    transition: (place) => defaultTransition(place.id),
    limit,
  });
}

export const historyKey = serviceKey<NavHistoryService>('history');
