import { atom, type Atom } from 'jotai/vanilla';
import {
  choiceCodec,
  defineLocalPref,
  type LocalPref,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import {
  BACKDROP_CHOICES,
  type BackdropChoice,
  type BackdropRendererId,
} from './backdropChoice.ts';

export const BACKDROP_PREF_KEY = 'default-theme.immersive.backdrop.v1';

const choice: LocalPref<BackdropChoice> = defineLocalPref({
  key: BACKDROP_PREF_KEY,
  fallback: 'mesh',
  ...choiceCodec(BACKDROP_CHOICES),
});

export const backdropChoiceAtom: Atom<BackdropChoice> = choice.atom;
export const chooseBackdrop = choice.set;

/** 从持久化存储载入背景效果偏好 */
export function loadBackdropPrefs(store: Store, storage?: PrefStorage | null): void {
  choice.load(store, storage);
}

const unavailableAtom = atom<ReadonlySet<BackdropRendererId>>(new Set<BackdropRendererId>());
const degradedAtom = atom(false);

/** 本次运行中初始化失败的渲染器集合；记录后不再重复尝试以防连续崩溃 */
export const backdropUnavailableAtom: Atom<ReadonlySet<BackdropRendererId>> = atom((get) =>
  get(unavailableAtom),
);

export function markBackdropUnavailable(store: Store, id: BackdropRendererId): void {
  const current = store.get(unavailableAtom);
  if (!current.has(id)) store.set(unavailableAtom, new Set<BackdropRendererId>([...current, id]));
}

/** 性能守门降级状态原子；帧率不足时为真，背景在动效过渡后冻结，并在视口重新激活时重置尝试 */
export const backdropDegradedAtom: Atom<boolean> = atom((get) => get(degradedAtom));

export function markBackdropDegraded(store: Store): void {
  store.set(degradedAtom, true);
}

/** 重置背景性能降级状态，允许下一次负载探测 */
export function clearBackdropDegraded(store: Store): void {
  store.set(degradedAtom, false);
}
