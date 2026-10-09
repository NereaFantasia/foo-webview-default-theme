import { atom } from 'jotai/vanilla';
import { Hct, hexFromArgb } from '@material/material-color-utilities';
import { defineLocalPref, recordOf, storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { colorSchemeAtom } from '../colorScheme.ts';
import type { CoverTone } from '../coverPalette.ts';
import type { ColorScheme } from '../themes.ts';

export const BACKGROUND_APPEARANCE_KEY = 'default-theme.background-appearance.v1';

export interface BackgroundAppearance {
  readonly saturation: number;
  readonly brightness: number;
  readonly tint: number;
  readonly surfaceBlur: number;
  readonly grain: number;
  /** 保留浓度存档，供仍读取该字段的版本使用。 */
  readonly capsule: number;
}

export const APPEARANCE_LIMITS: Readonly<
  Record<keyof BackgroundAppearance, readonly [number, number]>
> = {
  saturation: [0, 200],
  brightness: [20, 160],
  tint: [0, 40],
  surfaceBlur: [0, 60],
  grain: [0, 10],
  capsule: [0, 100],
};

export const APPEARANCE_DEFAULTS: Readonly<Record<ColorScheme, BackgroundAppearance>> = {
  light: {
    saturation: 130,
    brightness: 100,
    tint: 18,
    surfaceBlur: 24,
    grain: 2,
    capsule: 45,
  },
  dark: {
    saturation: 110,
    brightness: 100,
    tint: 10,
    surfaceBlur: 24,
    grain: 3,
    capsule: 45,
  },
};

const KEYS = Object.keys(APPEARANCE_LIMITS).filter(
  (key): key is keyof BackgroundAppearance => key in APPEARANCE_DEFAULTS.light,
);

function parameters(value: unknown, fallback: BackgroundAppearance): BackgroundAppearance {
  const saved = recordOf(value);
  const result = { ...fallback };
  for (const key of KEYS) {
    const value = saved[key];
    const [min, max] = APPEARANCE_LIMITS[key];
    if (typeof value === 'number' && Number.isFinite(value))
      result[key] = Math.round(Math.max(min, Math.min(max, value)));
  }
  return result;
}

// 颜色与表面的新偏好单独存储，旧版的背景来源和参数仍可原样读取。
const appearancePref = defineLocalPref<Readonly<Record<ColorScheme, BackgroundAppearance>>>({
  key: BACKGROUND_APPEARANCE_KEY,
  fallback: APPEARANCE_DEFAULTS,
  parse(raw) {
    const saved = storedRecord(raw);
    return {
      light: parameters(saved.light, APPEARANCE_DEFAULTS.light),
      dark: parameters(saved.dark, APPEARANCE_DEFAULTS.dark),
    };
  },
  format: (value) => JSON.stringify(value),
});

export const backgroundAppearanceAtom = atom(
  (get) => get(appearancePref.atom)[get(colorSchemeAtom)],
);

export function loadBackgroundAppearance(store: Store, storage?: PrefStorage | null): void {
  appearancePref.load(store, storage);
}

export function chooseBackgroundAppearance(
  store: Store,
  scheme: ColorScheme,
  key: keyof BackgroundAppearance,
  value: number,
  storage?: PrefStorage | null,
): void {
  if (!Number.isFinite(value)) return;
  const current = store.get(appearancePref.atom);
  const [min, max] = APPEARANCE_LIMITS[key];
  appearancePref.set(
    store,
    {
      ...current,
      [scheme]: { ...current[scheme], [key]: Math.round(Math.max(min, Math.min(max, value))) },
    },
    storage,
  );
}

export function resetBackgroundAppearance(
  store: Store,
  scheme: ColorScheme,
  storage?: PrefStorage | null,
): void {
  appearancePref.set(
    store,
    { ...store.get(appearancePref.atom), [scheme]: APPEARANCE_DEFAULTS[scheme] },
    storage,
  );
}

/** 高浓度阅读面也保留少量封面色相；灰图不染色，图片来源由调用方传 null。 */
export function tintedSurface(
  neutral: string,
  color: CoverTone | null,
  scheme: ColorScheme,
  appearance: Pick<BackgroundAppearance, 'tint' | 'saturation'>,
): string {
  if (!color || color.chroma < 8 || !appearance.tint || !appearance.saturation) return neutral;
  const tint = Hct.from(
    color.hue,
    Math.min(60, (color.chroma * appearance.saturation) / 100),
    scheme === 'dark' ? 12 : 78,
  );
  return `color-mix(in srgb, ${hexFromArgb(tint.toInt())} ${appearance.tint}%, ${neutral})`;
}
