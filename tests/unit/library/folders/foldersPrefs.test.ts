import { createStore } from 'jotai/vanilla';
import { expect, it } from 'vitest';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import {
  FOLDERS_FILTER_KEY,
  FOLDERS_PREFS_KEY,
  foldersFilterDockedAtom,
  parseFoldersPrefs,
  startFoldersPrefs,
} from '../../../../src/library/folders/foldersPrefs.ts';
it('偏好只接收已知类型，尺寸按步长约束，损坏存档回默认值', () => {
  expect(parseFoldersPrefs('{')).toMatchObject({
    view: 'list',
    density: 'standard',
    size: 160,
    recursive: true,
    grouped: true,
  });
  expect(
    parseFoldersPrefs(
      JSON.stringify({
        view: 'covers',
        density: 'compact',
        size: 291,
        recursive: false,
        grouped: false,
        pins: [{ key: 'bad', name: '坏路径' }],
      }),
    ),
  ).toMatchObject({
    view: 'covers',
    density: 'compact',
    size: 256,
    recursive: false,
    grouped: false,
    pins: [],
  });
  expect(parseFoldersPrefs('{"size":133}').size).toBe(136);
});

it('筛选形态单独存键：没有存档时按旧的分面展开偏好，选过之后各记各的', () => {
  const saved = new Map<string, string>([
    [FOLDERS_PREFS_KEY, JSON.stringify({ facetsOpen: true })],
  ]);
  const storage: PrefStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  };
  const store = createStore();
  const prefs = startFoldersPrefs(store, storage);
  expect(store.get(foldersFilterDockedAtom)).toBe(true);
  const before = saved.get(FOLDERS_PREFS_KEY);
  prefs.setFilterDocked(false);
  expect(saved.get(FOLDERS_FILTER_KEY)).toBe('popover');
  expect(saved.get(FOLDERS_PREFS_KEY)).toBe(before);
  const again = createStore();
  startFoldersPrefs(again, storage);
  expect(again.get(foldersFilterDockedAtom)).toBe(false);
});
