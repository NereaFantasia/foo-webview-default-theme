import { atom } from 'jotai/vanilla';
import { defineLocalPref, storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { colorSchemeAtom } from '../colorScheme.ts';
import type { ColorScheme } from '../themes.ts';

interface ThemeBackgroundPreferences {
  readonly light: number;
  readonly dark: number;
}

export const THEME_BACKGROUND_KEY = 'default-theme.theme-background.v1';
export const THEME_BACKGROUND_TINT_LIMIT = 40;
const DEFAULTS: ThemeBackgroundPreferences = { light: 18, dark: 10 };

function tint(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(THEME_BACKGROUND_TINT_LIMIT, value)))
    : fallback;
}

/** 颜色跟随现有强调色，只将染色强度深浅各存一份；旧窗口背景与材质存档不变。 */
const pref = defineLocalPref<ThemeBackgroundPreferences>({
  key: THEME_BACKGROUND_KEY,
  fallback: DEFAULTS,
  parse(raw) {
    const saved = storedRecord(raw);
    return {
      light: tint(saved.light, DEFAULTS.light),
      dark: tint(saved.dark, DEFAULTS.dark),
    };
  },
  format: (value) => JSON.stringify(value),
});

export const themeBackgroundTintAtom = atom((get) => get(pref.atom)[get(colorSchemeAtom)]);

export function loadThemeBackground(store: Store, storage?: PrefStorage | null): void {
  pref.load(store, storage);
}

export function chooseThemeBackgroundTint(
  store: Store,
  scheme: ColorScheme,
  value: number,
  storage?: PrefStorage | null,
): void {
  if (!Number.isFinite(value)) return;
  pref.set(store, { ...store.get(pref.atom), [scheme]: tint(value, DEFAULTS[scheme]) }, storage);
}

export function resetThemeBackgroundTint(
  store: Store,
  scheme: ColorScheme,
  storage?: PrefStorage | null,
): void {
  pref.set(store, { ...store.get(pref.atom), [scheme]: DEFAULTS[scheme] }, storage);
}
