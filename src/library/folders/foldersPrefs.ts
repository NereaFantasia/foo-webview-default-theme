import type { Atom } from 'jotai/vanilla';
import { defineLocalPref, recordOf, storedRecord } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { isQueryScope, type QueryScope } from '../../track/trackQuery.ts';
import { foldersAddress, type FolderNode } from './tree/foldersModel.ts';

export interface FolderPin {
  readonly key: string;
  readonly name: string;
}
export interface FoldersPrefs {
  readonly view: 'list' | 'covers';
  readonly density: 'compact' | 'standard' | 'comfortable';
  readonly size: number;
  readonly scope: QueryScope;
  readonly facetsOpen: boolean;
  readonly recursive: boolean;
  readonly coverColumnReady: boolean;
  readonly pins: readonly FolderPin[];
}
const DEFAULT: FoldersPrefs = {
  view: 'list',
  density: 'standard',
  size: 160,
  scope: 'all',
  facetsOpen: false,
  recursive: true,
  coverColumnReady: false,
  pins: [],
};
export const FOLDERS_PREFS_KEY = 'default-theme.folders.v1';
export function parseFoldersPrefs(raw: string | null): FoldersPrefs {
  const { view, density, size, scope, facetsOpen, recursive, coverColumnReady, pins } =
    storedRecord(raw);
  return {
    view: view === 'covers' ? view : 'list',
    density: density === 'compact' || density === 'comfortable' ? density : 'standard',
    size:
      typeof size === 'number' && Number.isFinite(size)
        ? Math.max(128, Math.min(256, Math.round(size / 8) * 8))
        : 160,
    scope: isQueryScope(scope) ? scope : 'all',
    facetsOpen: facetsOpen === true,
    recursive: recursive !== false,
    coverColumnReady: coverColumnReady === true,
    pins: Array.isArray(pins)
      ? pins.flatMap((pin: unknown) => {
          const { key, name } = recordOf(pin);
          return typeof key === 'string' && foldersAddress(key) && typeof name === 'string'
            ? [{ key, name }]
            : [];
        })
      : [],
  };
}
const PREF = defineLocalPref<FoldersPrefs>({
  key: FOLDERS_PREFS_KEY,
  fallback: DEFAULT,
  parse: parseFoldersPrefs,
  format: JSON.stringify,
});
export const foldersPrefsAtom: Atom<FoldersPrefs> = PREF.atom;
export interface FoldersPrefsService {
  change(patch: Partial<Omit<FoldersPrefs, 'pins'>>): void;
  pin(node: FolderPin): void;
}
export function startFoldersPrefs(store: Store): FoldersPrefsService {
  PREF.load(store);
  function save(patch: Partial<FoldersPrefs>) {
    PREF.set(store, { ...store.get(PREF.atom), ...patch });
  }
  return {
    change: save,
    pin(node: Pick<FolderNode, 'key' | 'name'>) {
      const { pins } = store.get(PREF.atom);
      save({
        pins: pins.some((pin) => pin.key === node.key)
          ? pins.filter((pin) => pin.key !== node.key)
          : [...pins, { key: node.key, name: node.name }],
      });
    },
  };
}
