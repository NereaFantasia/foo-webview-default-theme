import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import {
  SCENE_PREF_KEYS,
  loadScenePrefs,
  presetOptionsPref,
  startPagePref,
  toolbarCollapsedPref,
} from '../../../../src/immersive/scene/scenePrefs.ts';

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: PrefStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
  return { storage, map };
}

describe('新场景的偏好', () => {
  it('没有存档时全是缺省', () => {
    const { storage } = fakeStorage();
    const store = createStore();
    loadScenePrefs(store, storage);
    expect(store.get(startPagePref.atom)).toBe('lyrics');
    expect(store.get(presetOptionsPref.atom)).toEqual({});
  });

  it('改过的值写回，下次读得到', () => {
    const { storage, map } = fakeStorage();
    const store = createStore();
    expect(startPagePref.set(store, 'history', storage)).toBe(true);
    expect(presetOptionsPref.set(store, { split: { align: 'center' } }, storage)).toBe(true);
    expect(map.get(SCENE_PREF_KEYS.startPage)).toBe('history');

    const next = createStore();
    loadScenePrefs(next, storage);
    expect(next.get(startPagePref.atom)).toBe('history');
    expect(next.get(presetOptionsPref.atom)).toEqual({ split: { align: 'center' } });
  });

  it('起始页签认不出时回缺省', () => {
    const { storage } = fakeStorage({ [SCENE_PREF_KEYS.startPage]: 'settings' });
    expect(startPagePref.read(storage)).toBe('lyrics');
  });

  it('预设可调项的存档坏了或结构不对时，坏的丢掉、好的留着', () => {
    const broken = fakeStorage({ [SCENE_PREF_KEYS.presetOptions]: '{not json' });
    expect(presetOptionsPref.read(broken.storage)).toEqual({});

    const mixed = fakeStorage({
      [SCENE_PREF_KEYS.presetOptions]: JSON.stringify({
        split: { rounded: false },
        bad: 'text',
        list: ['a'],
        none: null,
      }),
    });
    expect(presetOptionsPref.read(mixed.storage)).toEqual({ split: { rounded: false } });

    const notObject = fakeStorage({ [SCENE_PREF_KEYS.presetOptions]: '[1,2]' });
    expect(presetOptionsPref.read(notObject.storage)).toEqual({});
  });

  it('歌词工具条的收起状态：缺省展开，改了写回，下次启动读得到，认不出的按展开', () => {
    const { storage, map } = fakeStorage();
    const store = createStore();
    loadScenePrefs(store, storage);
    expect(store.get(toolbarCollapsedPref.atom)).toBe(false);

    expect(toolbarCollapsedPref.set(store, true, storage)).toBe(true);
    expect(map.get(SCENE_PREF_KEYS.toolbarCollapsed)).toBe('on');
    const next = createStore();
    loadScenePrefs(next, storage);
    expect(next.get(toolbarCollapsedPref.atom)).toBe(true);

    expect(toolbarCollapsedPref.set(next, false, storage)).toBe(true);
    expect(map.get(SCENE_PREF_KEYS.toolbarCollapsed)).toBe('off');

    const garbage = fakeStorage({ [SCENE_PREF_KEYS.toolbarCollapsed]: 'collapsed' });
    expect(toolbarCollapsedPref.read(garbage.storage)).toBe(false);
  });

  it('存储被禁时只在内存里记', () => {
    const store = createStore();
    expect(startPagePref.set(store, 'queue', null)).toBe(true);
    expect(store.get(startPagePref.atom)).toBe('queue');
    expect(startPagePref.read(null)).toBe('lyrics');
  });
});
