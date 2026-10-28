import { defineLocalPref, storedRecord, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';

interface SurfaceTint {
  readonly menus: boolean;
  readonly panels: boolean;
}

export const SURFACE_TINT_KEY = 'default-theme.surface-tint.v1';
const DEFAULTS: SurfaceTint = { menus: true, panels: true };

const pref = defineLocalPref<SurfaceTint>({
  key: SURFACE_TINT_KEY,
  fallback: DEFAULTS,
  parse(raw) {
    const saved = storedRecord(raw);
    return {
      menus: typeof saved.menus === 'boolean' ? saved.menus : DEFAULTS.menus,
      panels: typeof saved.panels === 'boolean' ? saved.panels : DEFAULTS.panels,
    };
  },
  format: (value) => JSON.stringify(value),
});

export const surfaceTintAtom = pref.atom;

export function loadSurfaceTint(store: Store, storage?: PrefStorage | null): void {
  pref.load(store, storage);
}

export function chooseSurfaceTint(
  store: Store,
  surface: keyof SurfaceTint,
  enabled: boolean,
  storage?: PrefStorage | null,
): void {
  const current = store.get(pref.atom);
  if (current[surface] === enabled) return;
  pref.set(store, { ...current, [surface]: enabled }, storage);
}
