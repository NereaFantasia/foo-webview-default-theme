import { atom, type Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { syncMediaQuery, type MatchMedia } from '../theme/mediaQuery.ts';

const QUERY = '(prefers-reduced-motion: reduce)';
const systemAtom = atom(false);

/** 动效档位：`system` 跟随系统，`reduce` 不管系统怎么设都减弱。 */
export const MOTION_CHOICES = ['system', 'reduce'] as const;
export type MotionChoice = (typeof MOTION_CHOICES)[number];

export const MOTION_STORAGE_KEY = 'default-theme.motion.v1';

const choicePref = defineLocalPref<MotionChoice>({
  key: MOTION_STORAGE_KEY,
  fallback: 'system',
  ...choiceCodec(MOTION_CHOICES),
});

export const motionChoiceAtom: Atom<MotionChoice> = choicePref.atom;

/** 系统是否要求减弱动效：Windows「设置 → 辅助功能 → 视觉效果 → 动画效果」关掉时为真。 */
export const systemReducedMotionAtom: Atom<boolean> = atom((get) => get(systemAtom));

/**
 * 主题自己的动效要不要减弱：选了减弱，或跟随系统而系统要求减弱。为真时动画直接到终态，时长按
 * `motionDuration` 取。Fluent 组件自带的动效与样式表里的 `prefers-reduced-motion` 只看系统。
 */
export const reducedMotionAtom: Atom<boolean> = atom(
  (get) => get(choicePref.atom) === 'reduce' || get(systemAtom),
);

/** 让系统那一半跟随 `matchMedia`，返回停止跟随的函数。没有 `matchMedia` 时系统一直不要求减弱。 */
export function watchReducedMotion(store: Store, source: MatchMedia | null): () => void {
  return syncMediaQuery(store, systemAtom, QUERY, source);
}

/** 读档位存档写进 `store`。整页在首帧之前调一次。 */
export function loadMotionChoice(store: Store, storage?: PrefStorage | null): void {
  choicePref.load(store, storage);
}

export function chooseMotion(
  store: Store,
  choice: MotionChoice,
  storage?: PrefStorage | null,
): void {
  choicePref.set(store, choice, storage);
}
