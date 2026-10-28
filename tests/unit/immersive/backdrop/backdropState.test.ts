import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  BACKDROP_PREF_KEY,
  backdropChoiceAtom,
  backdropDegradedAtom,
  backdropUnavailableAtom,
  chooseBackdrop,
  clearBackdropDegraded,
  loadBackdropPrefs,
  markBackdropDegraded,
  markBackdropUnavailable,
} from '../../../../src/immersive/backdrop/backdropState.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: PrefStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
  return { storage, map };
}

describe('背景渲染器的选择', () => {
  it('没有存档时缺省 mesh', () => {
    const store = createStore();
    loadBackdropPrefs(store, memoryStorage().storage);
    expect(store.get(backdropChoiceAtom)).toBe('mesh');
  });

  it('读得到存档，认不出的取值回缺省', () => {
    const store = createStore();
    loadBackdropPrefs(store, memoryStorage({ [BACKDROP_PREF_KEY]: 'titanium' }).storage);
    expect(store.get(backdropChoiceAtom)).toBe('titanium');
    loadBackdropPrefs(store, memoryStorage({ [BACKDROP_PREF_KEY]: 'pixi' }).storage);
    expect(store.get(backdropChoiceAtom)).toBe('mesh');
  });

  it('改了立即生效并写回，键名不变', () => {
    const store = createStore();
    const { storage, map } = memoryStorage();
    expect(chooseBackdrop(store, 'off', storage)).toBe(true);
    expect(store.get(backdropChoiceAtom)).toBe('off');
    expect(map.get('default-theme.immersive.backdrop.v1')).toBe('off');
    expect(chooseBackdrop(store, 'off', storage)).toBe(false);
  });
});

describe('这次运行里的状态', () => {
  it('建失败过的渲染器累积记下，各 store 互不影响', () => {
    const store = createStore();
    const other = createStore();
    markBackdropUnavailable(store, 'titanium');
    markBackdropUnavailable(store, 'titanium');
    markBackdropUnavailable(store, 'mesh');
    expect([...store.get(backdropUnavailableAtom)]).toEqual(['titanium', 'mesh']);
    expect(other.get(backdropUnavailableAtom).size).toBe(0);
  });

  it('守门判定扛不住后为真，撤销后回到假', () => {
    const store = createStore();
    expect(store.get(backdropDegradedAtom)).toBe(false);
    markBackdropDegraded(store);
    expect(store.get(backdropDegradedAtom)).toBe(true);
    clearBackdropDegraded(store);
    expect(store.get(backdropDegradedAtom)).toBe(false);
  });
});
