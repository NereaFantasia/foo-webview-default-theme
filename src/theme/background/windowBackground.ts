import { atom } from 'jotai/vanilla';
import { defineLocalPref, recordOf, storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { colorSchemeAtom } from '../colorScheme.ts';
import type { CoverProfile } from '../coverPalette.ts';
import type { ColorScheme } from '../themes.ts';

export const WINDOW_BACKGROUND_KEY = 'default-theme.window-background.v1';
export const BACKGROUND_SOURCES = ['material', 'cover', 'palette', 'image'] as const;
export type BackgroundSource = (typeof BACKGROUND_SOURCES)[number];
export interface BackgroundParameters {
  readonly shade: number;
  readonly blur: number;
  readonly content: number;
  readonly inactive: number;
}
export interface BackgroundPreferences {
  readonly source: BackgroundSource;
  readonly imageName: string;
  readonly light: BackgroundParameters;
  readonly dark: BackgroundParameters;
}
export const BACKGROUND_DEFAULTS: BackgroundPreferences = {
  source: 'material',
  imageName: '',
  light: { shade: 65, blur: 48, content: 85, inactive: 6 },
  dark: { shade: 25, blur: 64, content: 70, inactive: 18 },
};
export const BACKGROUND_LIMITS: Readonly<
  Record<keyof BackgroundParameters, readonly [number, number]>
> = {
  shade: [0, 100],
  blur: [0, 120],
  content: [0, 100],
  inactive: [0, 50],
};
export const backgroundCoverAtom = atom<{
  readonly url: string;
  readonly profile: CoverProfile | null;
}>({
  url: '',
  profile: null,
});
export const backgroundTransportAtom = atom<'pending' | 'playing' | 'paused' | 'stopped'>(
  'pending',
);

function parameters(value: unknown, fallback: BackgroundParameters): BackgroundParameters {
  const saved = recordOf(value);
  const result = { ...fallback };
  for (const key of ['shade', 'blur', 'content', 'inactive'] as const) {
    const candidate = saved[key];
    const [min, max] = BACKGROUND_LIMITS[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate))
      result[key] = Math.round(Math.max(min, Math.min(max, candidate)));
  }
  return result;
}

/** 存档逐项校验，坏了哪一项补哪一项；不是 JSON 对象的整份按缺省。 */
const backgroundPref = defineLocalPref<BackgroundPreferences>({
  key: WINDOW_BACKGROUND_KEY,
  fallback: BACKGROUND_DEFAULTS,
  parse(raw) {
    const saved = storedRecord(raw);
    const name = saved.imageName;
    return {
      source: BACKGROUND_SOURCES.find((entry) => entry === saved.source) ?? 'material',
      imageName: typeof name === 'string' && name.length <= 256 ? name : '',
      light: parameters(saved.light, BACKGROUND_DEFAULTS.light),
      dark: parameters(saved.dark, BACKGROUND_DEFAULTS.dark),
    };
  },
  format: (value) => JSON.stringify(value),
});

export const backgroundPreferencesAtom = backgroundPref.atom;
export const backgroundSourceAtom = atom((get) => get(backgroundPref.atom).source);
export const backgroundParametersAtom = atom(
  (get) => get(backgroundPref.atom)[get(colorSchemeAtom)],
);

/** 在首帧之前调。读不了或存档坏了用缺省材质。 */
export function loadWindowBackground(store: Store, storage?: PrefStorage | null): void {
  backgroundPref.load(store, storage);
}

export function chooseBackgroundSource(
  store: Store,
  source: BackgroundSource,
  storage?: PrefStorage | null,
): void {
  backgroundPref.set(store, { ...store.get(backgroundPref.atom), source }, storage);
}

export function chooseBackgroundParameter(
  store: Store,
  scheme: ColorScheme,
  key: keyof BackgroundParameters,
  value: number,
  storage?: PrefStorage | null,
): void {
  if (!Number.isFinite(value)) return;
  const current = store.get(backgroundPref.atom);
  const [min, max] = BACKGROUND_LIMITS[key];
  backgroundPref.set(
    store,
    {
      ...current,
      [scheme]: { ...current[scheme], [key]: Math.round(Math.max(min, Math.min(max, value))) },
    },
    storage,
  );
}

export function saveBackgroundImageName(
  store: Store,
  imageName: string,
  storage?: PrefStorage | null,
): void {
  backgroundPref.set(store, { ...store.get(backgroundPref.atom), imageName }, storage);
}
