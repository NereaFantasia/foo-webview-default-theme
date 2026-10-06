import { atom, type Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { syncMediaQuery, type MatchMedia } from './mediaQuery.ts';
import type { ColorScheme } from './themes.ts';

const QUERY = '(prefers-color-scheme: dark)';

/** 深浅模式：`system` 跟随系统，另两档由用户定下、不再看系统。 */
export const COLOR_MODES = ['system', 'light', 'dark'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const DEFAULT_COLOR_MODE: ColorMode = 'system';
/**
 * 模式存 localStorage，不进宿主 config：首帧之前就要定下深浅，等宿主应答的话，手选与系统相反的用户
 * 每次启动都会先看到一帧相反的颜色。
 */
export const COLOR_MODE_STORAGE_KEY = 'default-theme.color-mode.v1';

const systemDarkAtom = atom(false);
/** 没有存档、存储被禁或取值不在表里，都回到缺省。 */
const modePref = defineLocalPref<ColorMode>({
  key: COLOR_MODE_STORAGE_KEY,
  fallback: DEFAULT_COLOR_MODE,
  ...choiceCodec(COLOR_MODES),
});

export const colorModeAtom: Atom<ColorMode> = modePref.atom;

/**
 * 界面此刻用哪一档。模式是 `system` 时取系统的深浅色偏好（WebView2 跟随 Windows 的应用模式，切换时
 * 即时生效），否则就是用户定的那一档。
 */
export const colorSchemeAtom: Atom<ColorScheme> = atom((get) => {
  const mode = get(modePref.atom);
  if (mode !== 'system') return mode;
  return get(systemDarkAtom) ? 'dark' : 'light';
});

/**
 * 读回用户定的模式，并让系统那一档跟随系统，返回停止跟随的函数。在首帧之前调。
 * 没有 `matchMedia` 时系统那一档一直是浅色。
 */
export function watchColorScheme(
  store: Store,
  source: MatchMedia | null,
  storage?: PrefStorage | null,
): () => void {
  modePref.load(store, storage);
  return syncMediaQuery(store, systemDarkAtom, QUERY, source);
}

/** 换模式并记住，立即生效。存不下（存储被禁或写满）只影响下次启动。 */
export function chooseColorMode(store: Store, mode: ColorMode, storage?: PrefStorage | null): void {
  modePref.set(store, mode, storage);
}
