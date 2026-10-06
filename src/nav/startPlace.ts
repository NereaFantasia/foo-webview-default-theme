import type { Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import type { Place, PlaceId } from './places.ts';

/**
 * 打开窗口时落在哪个地点：侧边栏里已经上线的一级地点之一，不带主体。存 localStorage，启动时同步读，
 * 交给历史当第一条记录；换了只影响下次打开窗口。后退退不回去时的去处仍是 `START_PLACE`，不跟这一项。
 */
export const START_PLACE_CHOICES = [
  'home',
  'artists',
  'albums',
  'songs',
  'genres',
  'folders',
] as const satisfies readonly PlaceId[];
export type StartPlaceChoice = (typeof START_PLACE_CHOICES)[number];

export const START_PLACE_STORAGE_KEY = 'default-theme.start-place.v1';

// 缺省与 `START_PLACE` 一致。
const pref = defineLocalPref<StartPlaceChoice>({
  key: START_PLACE_STORAGE_KEY,
  fallback: 'albums',
  ...choiceCodec(START_PLACE_CHOICES),
});

export const startPlaceAtom: Atom<StartPlaceChoice> = pref.atom;

/** 读存档写进 `store`，答这次启动落在哪里。整页在建历史之前调一次。 */
export function loadStartPlace(store: Store, storage?: PrefStorage | null): Place {
  return { id: pref.load(store, storage) };
}

export function chooseStartPlace(
  store: Store,
  choice: StartPlaceChoice,
  storage?: PrefStorage | null,
): void {
  pref.set(store, choice, storage);
}
