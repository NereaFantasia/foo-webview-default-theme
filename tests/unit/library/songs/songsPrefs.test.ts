import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SONGS_PREFS,
  parseSongsPrefs,
  SONGS_STORAGE_KEY,
  songsPrefsAtom,
  startSongsPrefs,
} from '../../../../src/library/songs/songsPrefs.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';

function memory(initial?: string): PrefStorage & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  if (initial !== undefined) saved.set(SONGS_STORAGE_KEY, initial);
  return {
    saved,
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  };
}

describe('读回偏好', () => {
  it('没有存档、坏了都用缺省；坏了哪一项补哪一项', () => {
    expect(parseSongsPrefs(null)).toEqual(DEFAULT_SONGS_PREFS);
    expect(parseSongsPrefs('{oops')).toEqual(DEFAULT_SONGS_PREFS);
    expect(
      parseSongsPrefs(
        JSON.stringify({ sort: { column: 'cover', descending: true }, scope: 'lyrics' }),
      ),
    ).toEqual({ ...DEFAULT_SONGS_PREFS, sort: { column: 'artist', descending: true } });
    expect(
      parseSongsPrefs(
        JSON.stringify({ sort: { column: 'year' }, scope: 'genre', facetsOpen: true }),
      ),
    ).toEqual({
      sort: { column: 'year', descending: false },
      scope: 'genre',
      facetsOpen: true,
      density: 'standard',
    });
  });

  it('疏密只认三档，别的值回标准档', () => {
    expect(parseSongsPrefs(JSON.stringify({ density: 'comfortable' })).density).toBe('comfortable');
    expect(parseSongsPrefs(JSON.stringify({ density: 'roomy' })).density).toBe('standard');
    expect(parseSongsPrefs(JSON.stringify({ density: 32 })).density).toBe('standard');
  });
});

describe('改偏好', () => {
  it('同一列再点换方向，换一列从升序起；改了就落盘', () => {
    const store = createStore();
    const storage = memory();
    const prefs = startSongsPrefs(store, storage);
    prefs.sortBy('artist');
    expect(store.get(songsPrefsAtom).sort).toEqual({ column: 'artist', descending: true });
    prefs.sortBy('year');
    expect(store.get(songsPrefsAtom).sort).toEqual({ column: 'year', descending: false });
    prefs.setFacetsOpen(true);
    expect(JSON.parse(storage.saved.get(SONGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      sort: { column: 'year', descending: false },
      facetsOpen: true,
    });
    prefs.resetSort();
    expect(store.get(songsPrefsAtom).sort).toEqual(DEFAULT_SONGS_PREFS.sort);
  });

  it('换疏密落盘，下次启动读回；同一档不重写', () => {
    const store = createStore();
    const storage = memory();
    const prefs = startSongsPrefs(store, storage);
    prefs.setDensity('compact');
    expect(store.get(songsPrefsAtom).density).toBe('compact');
    const saved = storage.saved.get(SONGS_STORAGE_KEY);
    prefs.setDensity('compact');
    expect(storage.saved.get(SONGS_STORAGE_KEY)).toBe(saved);
    const again = createStore();
    startSongsPrefs(again, storage);
    expect(again.get(songsPrefsAtom).density).toBe('compact');
  });

  it('存储写不进去时照常生效', () => {
    const store = createStore();
    const full: PrefStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('满了');
      },
    };
    startSongsPrefs(store, full).setScope('title');
    expect(store.get(songsPrefsAtom).scope).toBe('title');
  });
});
