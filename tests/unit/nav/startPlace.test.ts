import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { PLACES, START_PLACE } from '../../../src/nav/places.ts';
import { SIDEBAR_ITEMS } from '../../../src/nav/sidebar/sidebarNav.ts';
import {
  chooseStartPlace,
  loadStartPlace,
  START_PLACE_CHOICES,
  START_PLACE_STORAGE_KEY,
  startPlaceAtom,
} from '../../../src/nav/startPlace.ts';

function memoryStorage(initial: string | null = null) {
  const saved = new Map<string, string>();
  if (initial !== null) saved.set(START_PLACE_STORAGE_KEY, initial);
  return {
    saved,
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
  };
}

describe('startPlace', () => {
  it('没有存档、存档无法识别或读取出错时落在首页，与没有可后退记录时的去处一致', () => {
    for (const storage of [null, memoryStorage(), memoryStorage('album'), memoryStorage('home ')]) {
      expect(loadStartPlace(createStore(), storage)).toEqual({ id: 'home' });
    }
    const broken = {
      getItem(): string | null {
        throw new Error('storage disabled');
      },
      setItem() {},
    };
    expect(loadStartPlace(createStore(), broken)).toEqual({ id: 'home' });
    expect(START_PLACE).toEqual({ id: 'home' });
  });

  it('读回存档里的那一项，store 里同时记下', () => {
    const store = createStore();
    expect(loadStartPlace(store, memoryStorage('songs'))).toEqual({ id: 'songs' });
    expect(store.get(startPlaceAtom)).toBe('songs');
  });

  it('改了立即记进 store 并落盘，下次启动读回的是它', () => {
    const storage = memoryStorage();
    const store = createStore();
    loadStartPlace(store, storage);
    chooseStartPlace(store, 'genres', storage);
    expect(store.get(startPlaceAtom)).toBe('genres');
    expect(storage.saved.get(START_PLACE_STORAGE_KEY)).toBe('genres');
    expect(loadStartPlace(createStore(), storage)).toEqual({ id: 'genres' });
  });

  it('可选的都是侧边栏里已上线的一级地点', () => {
    for (const choice of START_PLACE_CHOICES) {
      expect(PLACES[choice].level).toBe(1);
      expect(SIDEBAR_ITEMS.find((item) => item.place === choice)?.ready).toBe(true);
    }
  });
});
