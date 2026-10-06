import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_PREFS,
  parseSidebarPrefs,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_WIDTH,
  sidebarPrefsAtom,
  startSidebarPrefs,
} from '../../../../src/nav/sidebar/sidebarPrefs.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';

function memoryStorage(initial?: string): PrefStorage & { saved: () => unknown } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(SIDEBAR_STORAGE_KEY, initial);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    saved: () => JSON.parse(map.get(SIDEBAR_STORAGE_KEY) ?? 'null'),
  };
}

describe('parseSidebarPrefs', () => {
  it('没有存档、不是 JSON、不是对象都用缺省：不隐藏、不是图标态、宽 260、两节都展开', () => {
    for (const raw of [null, '{', '42', '[]', 'null']) {
      expect(parseSidebarPrefs(raw)).toEqual(DEFAULT_SIDEBAR_PREFS);
    }
  });

  it('旧版没有 hidden 的存档原样读回，读成不隐藏', () => {
    const raw = JSON.stringify({
      rail: true,
      width: 300,
      sections: { library: false, playlists: true },
    });
    expect(parseSidebarPrefs(raw)).toEqual({
      hidden: false,
      rail: true,
      width: 300,
      sections: { library: false, playlists: true },
    });
    expect(parseSidebarPrefs(JSON.stringify({ hidden: true })).hidden).toBe(true);
  });

  it('坏了哪一项补哪一项：宽度夹进范围并取整，隐藏、图标态与开合只认布尔', () => {
    const raw = JSON.stringify({
      hidden: 1,
      rail: 'yes',
      width: 1000.4,
      sections: { library: 0, playlists: false },
    });
    expect(parseSidebarPrefs(raw)).toEqual({
      hidden: false,
      rail: false,
      width: SIDEBAR_WIDTH.max,
      sections: { library: true, playlists: false },
    });
    expect(parseSidebarPrefs(JSON.stringify({ width: 199.6 })).width).toBe(SIDEBAR_WIDTH.min);
    expect(parseSidebarPrefs(JSON.stringify({ width: 'wide' })).width).toBe(SIDEBAR_WIDTH.initial);
    expect(parseSidebarPrefs(JSON.stringify({ sections: [] })).sections).toEqual({
      library: true,
      playlists: true,
    });
  });
});

describe('startSidebarPrefs', () => {
  it('开合一节就落盘，图标态与宽度按读回的原样写回', () => {
    const storage = memoryStorage(JSON.stringify({ rail: true, width: 280 }));
    const store = createStore();
    const prefs = startSidebarPrefs(store, storage);
    prefs.toggleSection('playlists');
    expect(store.get(sidebarPrefsAtom).sections).toEqual({ library: true, playlists: false });
    expect(storage.saved()).toEqual({
      hidden: false,
      rail: true,
      width: 280,
      sections: { library: true, playlists: false },
    });
    prefs.toggleSection('playlists');
    expect(store.get(sidebarPrefsAtom).sections.playlists).toBe(true);
  });

  it('换形态就落盘，宽度夹进范围并取整；和此刻一样不写', () => {
    const storage = memoryStorage();
    const writes: string[] = [];
    const store = createStore();
    const prefs = startSidebarPrefs(store, {
      getItem: storage.getItem,
      setItem: (key, value) => {
        writes.push(value);
        storage.setItem(key, value);
      },
    });
    prefs.setShape({ rail: false, width: 300.4 });
    expect(storage.saved()).toMatchObject({ rail: false, width: 300 });
    prefs.setShape({ rail: false, width: 300 });
    expect(writes).toHaveLength(1);
    prefs.setShape({ rail: true, width: 1000 });
    expect(store.get(sidebarPrefsAtom)).toMatchObject({ rail: true, width: SIDEBAR_WIDTH.max });
    expect(writes).toHaveLength(2);
  });

  it('切换图标态：宽度留着，切回来还是原来的宽度，读回来也一样', () => {
    const storage = memoryStorage(JSON.stringify({ width: 320 }));
    const store = createStore();
    const prefs = startSidebarPrefs(store, storage);
    prefs.toggleRail();
    expect(storage.saved()).toMatchObject({ rail: true, width: 320 });
    expect(parseSidebarPrefs(JSON.stringify(storage.saved()))).toMatchObject({
      rail: true,
      width: 320,
    });
    prefs.toggleRail();
    expect(store.get(sidebarPrefsAtom)).toMatchObject({ rail: false, width: 320 });
  });

  it('隐藏与摆回：形态、宽度与开合都留着，摆回来照原样；隐藏着也照样落盘', () => {
    const storage = memoryStorage(
      JSON.stringify({ rail: true, width: 300, sections: { library: false } }),
    );
    const store = createStore();
    const prefs = startSidebarPrefs(store, storage);
    prefs.toggleHidden();
    expect(store.get(sidebarPrefsAtom)).toEqual({
      hidden: true,
      rail: true,
      width: 300,
      sections: { library: false, playlists: true },
    });
    expect(parseSidebarPrefs(JSON.stringify(storage.saved())).hidden).toBe(true);
    prefs.toggleHidden();
    expect(store.get(sidebarPrefsAtom)).toMatchObject({ hidden: false, rail: true, width: 300 });
    expect(storage.saved()).toMatchObject({ hidden: false, rail: true, width: 300 });
  });

  it('存储读写抛错：按缺省起步，开合照样在内存里生效', () => {
    const storage: PrefStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = createStore();
    const prefs = startSidebarPrefs(store, storage);
    expect(store.get(sidebarPrefsAtom)).toEqual(DEFAULT_SIDEBAR_PREFS);
    prefs.toggleSection('library');
    expect(store.get(sidebarPrefsAtom).sections.library).toBe(false);
  });

  it('没有存储也能用', () => {
    const store = createStore();
    startSidebarPrefs(store, null).toggleSection('library');
    expect(store.get(sidebarPrefsAtom).sections.library).toBe(false);
  });
});
