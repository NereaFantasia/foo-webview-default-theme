import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { backdropFlowSpeed } from '../../../../src/immersive/backdrop/backdropOptions.ts';
import {
  BACKDROP_OPTIONS_KEY,
  BACKDROP_PREF_KEY,
  backdropChoiceAtom,
  backdropDegradedAtom,
  backdropOptionsAtom,
  backdropUnavailableAtom,
  chooseBackdrop,
  chooseBackdropFlowSpeed,
  chooseBackdropOption,
  clearBackdropDegraded,
  loadBackdropPrefs,
  markBackdropDegraded,
  markBackdropUnavailable,
  resetBackdropOptions,
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

describe('背景可调项的存档', () => {
  const OPTIONS_KEY = 'default-theme.immersive.backdropOptions.v1';

  it('键名固定，没有存档时是空存档，流动速度是原速', () => {
    expect(BACKDROP_OPTIONS_KEY).toBe(OPTIONS_KEY);
    const store = createStore();
    loadBackdropPrefs(store, memoryStorage().storage);
    expect(store.get(backdropOptionsAtom)).toEqual({
      titanium: {},
      isolation: {},
      mesh: {},
      flow: {},
    });
    expect(backdropFlowSpeed(store.get(backdropOptionsAtom))).toBe(100);
  });

  it('读得到存档，坏存档与不合法的项丢掉', () => {
    const store = createStore();
    loadBackdropPrefs(
      store,
      memoryStorage({ [OPTIONS_KEY]: '{"flowSpeed":130,"titanium":{"grain":50,"palette":"pixi"}}' })
        .storage,
    );
    expect(store.get(backdropOptionsAtom)).toEqual({
      flowSpeed: 130,
      titanium: { grain: 50 },
      isolation: {},
      mesh: {},
      flow: {},
    });
    loadBackdropPrefs(store, memoryStorage({ [OPTIONS_KEY]: '{broken' }).storage);
    expect(store.get(backdropOptionsAtom)).toEqual({
      titanium: {},
      isolation: {},
      mesh: {},
      flow: {},
    });
  });

  it('改一项立即生效并写回；改回缺省不再写那一项；同值不重写', () => {
    const store = createStore();
    const { storage, map } = memoryStorage();
    expect(chooseBackdropOption(store, 'titanium', 'grain', 50, storage)).toBe(true);
    expect(map.get(OPTIONS_KEY)).toBe('{"titanium":{"grain":50}}');
    expect(chooseBackdropOption(store, 'titanium', 'grain', 50, storage)).toBe(false);
    expect(chooseBackdropFlowSpeed(store, 150, storage)).toBe(true);
    expect(map.get(OPTIONS_KEY)).toBe('{"flowSpeed":150,"titanium":{"grain":50}}');
    expect(chooseBackdropOption(store, 'titanium', 'grain', 70, storage)).toBe(true);
    expect(map.get(OPTIONS_KEY)).toBe('{"flowSpeed":150}');
    expect(chooseBackdropOption(store, 'titanium', 'lightWave', true, storage)).toBe(false);
  });

  it('恢复默认清掉所选渲染器的项与流动速度，别的渲染器的项留着', () => {
    const store = createStore();
    const { storage, map } = memoryStorage();
    chooseBackdropOption(store, 'titanium', 'grain', 50, storage);
    chooseBackdropOption(store, 'isolation', 'lightWave', true, storage);
    chooseBackdropFlowSpeed(store, 150, storage);
    expect(resetBackdropOptions(store, 'titanium', storage)).toBe(true);
    expect(map.get(OPTIONS_KEY)).toBe('{"isolation":{"lightWave":true}}');
    expect(resetBackdropOptions(store, 'titanium', storage)).toBe(false);
  });

  it('可调项与所选渲染器分开存，换渲染器不丢', () => {
    const store = createStore();
    const { storage, map } = memoryStorage();
    chooseBackdropOption(store, 'titanium', 'grain', 50, storage);
    chooseBackdrop(store, 'isolation', storage);
    expect(map.get('default-theme.immersive.backdrop.v1')).toBe('isolation');
    expect(store.get(backdropOptionsAtom).titanium).toEqual({ grain: 50 });
  });
});
