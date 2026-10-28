import { atom, type Atom } from 'jotai/vanilla';
import {
  browserStorage,
  defineLocalPref,
  recordOf,
  storedRecord,
  type PrefStorage,
} from '../../kit/localPref.ts';
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
  /** 列表视图按目录分组；关掉后曲目平铺，排序作用于整份曲目。封面视图本来就按目录出卡片，不看它 */
  readonly grouped: boolean;
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
  grouped: true,
  coverColumnReady: false,
  pins: [],
};
export const FOLDERS_PREFS_KEY = 'default-theme.folders.v1';
export function parseFoldersPrefs(raw: string | null): FoldersPrefs {
  const { view, density, size, scope, facetsOpen, recursive, grouped, coverColumnReady, pins } =
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
    grouped: grouped !== false,
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

/** 筛选是嵌入页面还是弹出浮层，单独一个键；没有存档时按旧的分面展开偏好定 */
export const FOLDERS_FILTER_KEY = 'default-theme.folders-filter.v1';
const DOCK = defineLocalPref<boolean | null>({
  key: FOLDERS_FILTER_KEY,
  fallback: null,
  parse: (raw) => (raw === 'docked' ? true : raw === 'popover' ? false : undefined),
  format: (docked) => (docked ? 'docked' : 'popover'),
});
export const foldersFilterDockedAtom: Atom<boolean> = atom(
  (get) => get(DOCK.atom) ?? get(PREF.atom).facetsOpen,
);
export interface FoldersPrefsService {
  change(patch: Partial<Omit<FoldersPrefs, 'pins'>>): void;
  pin(node: FolderPin): void;
  setFilterDocked(docked: boolean): void;
}
export function startFoldersPrefs(
  store: Store,
  storage: PrefStorage | null = browserStorage(),
): FoldersPrefsService {
  PREF.load(store, storage);
  DOCK.load(store, storage);
  function save(patch: Partial<FoldersPrefs>) {
    PREF.set(store, { ...store.get(PREF.atom), ...patch }, storage);
  }
  return {
    change: save,
    setFilterDocked(docked) {
      DOCK.set(store, docked, storage);
    },
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
