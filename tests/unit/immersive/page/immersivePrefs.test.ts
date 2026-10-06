import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, test } from 'vitest';
import { paintFpsCap, setPaintFpsCap } from '../../../../src/immersive/frame/frameScheduler.ts';
import {
  chooseImmersiveFpsCap,
  chooseImmersiveHostFullscreen,
  chooseImmersiveScene,
  chooseImmersiveTerrain,
  chooseImmersiveWash,
  chooseWaveformMode,
  DEFAULT_SCENE,
  FPS_CAPS,
  immersiveFpsCapAtom,
  immersiveHostFullscreenAtom,
  immersiveSceneAtom,
  immersiveTerrainAtom,
  immersiveWashAtom,
  loadImmersivePrefs,
  readImmersiveFpsCap,
  readImmersiveHostFullscreen,
  readImmersiveScene,
  readImmersiveTerrain,
  readImmersiveWash,
  readWaveformMode,
  waveformModeAtom,
} from '../../../../src/immersive/page/immersivePrefs.ts';
import { WAVEFORM_MODES } from '../../../../src/immersive/waveform/waveformModes.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import type { Store } from '../../../../src/kit/store.ts';

/** 沉浸视图六项偏好的存档：缺省、读回、坏值、写入与存储被禁，以及帧率上限交给重画调度。 */
const KEYS = {
  terrain: 'default-theme.immersive.terrain.v1',
  wash: 'default-theme.immersive.wash.v1',
  hostFullscreen: 'default-theme.immersive.hostFullscreen.v1',
  fpsCap: 'default-theme.immersive.fpsCap.v1',
  waveformMode: 'default-theme.immersive.waveformMode.v1',
  scene: 'default-theme.immersive.scene.v1',
};

const DEFAULTS = {
  terrain: true,
  wash: 'flow',
  hostFullscreen: false,
  fpsCap: 0,
  waveformMode: 'rms',
  scene: 'paper',
};

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  let writes = 0;
  const storage: PrefStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      map.set(key, value);
    },
  };
  return { storage, map, writes: () => writes };
}

const broken: PrefStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

function prefsOf(store: Store) {
  return {
    terrain: store.get(immersiveTerrainAtom),
    wash: store.get(immersiveWashAtom),
    hostFullscreen: store.get(immersiveHostFullscreenAtom),
    fpsCap: store.get(immersiveFpsCapAtom),
    waveformMode: store.get(waveformModeAtom),
    scene: store.get(immersiveSceneAtom),
  };
}

afterEach(() => setPaintFpsCap(null));

describe('loadImmersivePrefs', () => {
  test('缺省：山脊图开、封面底色流动、进入不全屏、帧率不封顶、画法全频、场景图纸；读进来时按缺省设一次重画上限', () => {
    const store = createStore();
    expect(prefsOf(store)).toStrictEqual(DEFAULTS);
    setPaintFpsCap(30);
    loadImmersivePrefs(store, fakeStorage().storage);
    expect(prefsOf(store)).toStrictEqual(DEFAULTS);
    expect(paintFpsCap()).toBeNull();

    const detached = createStore();
    setPaintFpsCap(30);
    loadImmersivePrefs(detached, null);
    expect(prefsOf(detached)).toStrictEqual(DEFAULTS);
    expect(paintFpsCap()).toBeNull();
  });

  test('改了写进存档并回读；帧率上限一改就交给重画调度，0 交 null', () => {
    const { storage, map } = fakeStorage();
    const store = createStore();
    const caps: (number | null)[] = [];
    setPaintFpsCap(30);
    loadImmersivePrefs(store, storage);
    caps.push(paintFpsCap());
    chooseImmersiveTerrain(store, false, storage);
    chooseImmersiveWash(store, 'off', storage);
    chooseImmersiveHostFullscreen(store, true, storage);
    chooseImmersiveFpsCap(store, 60, storage);
    caps.push(paintFpsCap());
    chooseImmersiveFpsCap(store, 0, storage);
    caps.push(paintFpsCap());
    chooseWaveformMode(store, 'lanes', storage);
    expect(Object.fromEntries(map)).toStrictEqual({
      [KEYS.terrain]: 'off',
      [KEYS.wash]: 'off',
      [KEYS.hostFullscreen]: 'on',
      [KEYS.fpsCap]: '0',
      [KEYS.waveformMode]: 'lanes',
    });
    expect(caps).toStrictEqual([null, 60, null]);

    const again = createStore();
    loadImmersivePrefs(again, storage);
    expect(prefsOf(again)).toStrictEqual({
      terrain: false,
      wash: 'off',
      hostFullscreen: true,
      fpsCap: 0,
      waveformMode: 'lanes',
      scene: 'paper',
    });
  });

  test('坏值与读不了的存储回缺省；写不进时这一次照样生效', () => {
    const bad = fakeStorage({
      [KEYS.terrain]: 'yes',
      [KEYS.wash]: 'blur',
      [KEYS.hostFullscreen]: 'true',
      [KEYS.fpsCap]: '45',
      [KEYS.waveformMode]: 'bars',
      [KEYS.scene]: 'nope',
    }).storage;
    const store = createStore();
    loadImmersivePrefs(store, bad);
    expect(prefsOf(store)).toStrictEqual(DEFAULTS);
    expect(readImmersiveTerrain(bad)).toBe(true);
    expect(readImmersiveWash(bad)).toBe('flow');
    expect(readImmersiveHostFullscreen(bad)).toBe(false);
    expect(readImmersiveFpsCap(bad)).toBe(0);

    const muted = createStore();
    loadImmersivePrefs(muted, broken);
    expect(prefsOf(muted)).toStrictEqual(DEFAULTS);
    chooseImmersiveTerrain(muted, false, broken);
    chooseImmersiveWash(muted, 'static', broken);
    chooseImmersiveHostFullscreen(muted, true, broken);
    chooseImmersiveFpsCap(muted, 144, broken);
    chooseWaveformMode(muted, 'weighted', broken);
    expect(prefsOf(muted)).toStrictEqual({
      terrain: false,
      wash: 'static',
      hostFullscreen: true,
      fpsCap: 144,
      waveformMode: 'weighted',
      scene: 'paper',
    });
    expect(paintFpsCap()).toBe(144);

    expect(readImmersiveFpsCap(fakeStorage({ [KEYS.fpsCap]: '120' }).storage)).toBe(120);
    expect(readImmersiveFpsCap(fakeStorage({ [KEYS.fpsCap]: '240' }).storage)).toBe(240);
  });

  test('和此刻一样就不写存档', () => {
    const { storage, writes } = fakeStorage({
      [KEYS.terrain]: 'off',
      [KEYS.wash]: 'static',
      [KEYS.fpsCap]: '60',
    });
    const store = createStore();
    loadImmersivePrefs(store, storage);
    chooseImmersiveTerrain(store, false, storage);
    chooseImmersiveWash(store, 'static', storage);
    chooseImmersiveHostFullscreen(store, false, storage);
    chooseImmersiveFpsCap(store, 60, storage);
    chooseWaveformMode(store, 'rms', storage);
    chooseImmersiveScene(store, 'paper', storage);
    expect(writes()).toBe(0);
    chooseImmersiveWash(store, 'flow', storage);
    expect(writes()).toBe(1);
  });
});

describe('帧率上限', () => {
  test('每一档都原样读回，读进来就设成重画上限，0 设成不封顶', () => {
    for (const cap of FPS_CAPS) {
      const storage = fakeStorage({ [KEYS.fpsCap]: String(cap) }).storage;
      expect(readImmersiveFpsCap(storage)).toBe(cap);
      setPaintFpsCap(30);
      const store = createStore();
      loadImmersivePrefs(store, storage);
      expect(store.get(immersiveFpsCapAtom)).toBe(cap);
      expect(paintFpsCap(), String(cap)).toBe(cap === 0 ? null : cap);
    }
  });

  test('不在表里的写法都回不封顶', () => {
    for (const raw of ['060', '60.0', ' 60', '-1', '', 'Infinity']) {
      const storage = fakeStorage({ [KEYS.fpsCap]: raw }).storage;
      expect(readImmersiveFpsCap(storage), raw).toBe(0);
      setPaintFpsCap(30);
      loadImmersivePrefs(createStore(), storage);
      expect(paintFpsCap(), raw).toBeNull();
    }
  });
});

describe('整轨波形画法', () => {
  test('没存过或存的不认：全频', () => {
    expect(readWaveformMode(fakeStorage().storage)).toBe('rms');
    expect(readWaveformMode(fakeStorage({ [KEYS.waveformMode]: 'bars' }).storage)).toBe('rms');
    expect(readWaveformMode(fakeStorage({ [KEYS.waveformMode]: 'RMS' }).storage)).toBe('rms');
    expect(readWaveformMode(null)).toBe('rms');
    for (const mode of WAVEFORM_MODES) {
      expect(readWaveformMode(fakeStorage({ [KEYS.waveformMode]: mode }).storage)).toBe(mode);
    }
  });

  test('读回上次选的，换了就记下', () => {
    const { storage, map } = fakeStorage({ [KEYS.waveformMode]: 'lanes' });
    const store = createStore();
    loadImmersivePrefs(store, storage);
    expect(store.get(waveformModeAtom)).toBe('lanes');
    chooseWaveformMode(store, 'midHigh', storage);
    expect(store.get(waveformModeAtom)).toBe('midHigh');
    expect(map.get(KEYS.waveformMode)).toBe('midHigh');
  });

  test('存储读写抛错：照样能换，只是不记得', () => {
    const store = createStore();
    loadImmersivePrefs(store, broken);
    expect(store.get(waveformModeAtom)).toBe('rms');
    chooseWaveformMode(store, 'layers', broken);
    expect(store.get(waveformModeAtom)).toBe('layers');
  });
});

describe('场景存档', () => {
  test('只有图纸一档，同值不重写；读的是同一个键，旧存档的 terrain、坏值、无存档与坏存储都回缺省', () => {
    const empty = fakeStorage();
    const store = createStore();
    loadImmersivePrefs(store, empty.storage);
    expect(store.get(immersiveSceneAtom)).toBe(DEFAULT_SCENE);
    chooseImmersiveScene(store, 'paper', empty.storage);
    expect(empty.writes()).toBe(0);

    const saved = fakeStorage({ [KEYS.scene]: 'paper' });
    expect(readImmersiveScene(saved.storage)).toBe('paper');
    const again = createStore();
    loadImmersivePrefs(again, saved.storage);
    expect(again.get(immersiveSceneAtom)).toBe('paper');
    chooseImmersiveScene(again, 'paper', saved.storage);
    expect(saved.writes()).toBe(0);

    // 旧存档里可能还有已不再用的场景名 terrain：不在表里，回图纸而不是报错。
    expect(readImmersiveScene(fakeStorage({ [KEYS.scene]: 'terrain' }).storage)).toBe(
      DEFAULT_SCENE,
    );
    expect(readImmersiveScene(fakeStorage({ [KEYS.scene]: 'nope' }).storage)).toBe(DEFAULT_SCENE);
    expect(readImmersiveScene(null)).toBe(DEFAULT_SCENE);
    expect(readImmersiveScene(broken)).toBe(DEFAULT_SCENE);
    const muted = createStore();
    loadImmersivePrefs(muted, broken);
    expect(muted.get(immersiveSceneAtom)).toBe(DEFAULT_SCENE);
    expect(() => chooseImmersiveScene(muted, 'paper', broken)).not.toThrow();
  });
});
