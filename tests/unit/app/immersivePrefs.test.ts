import { fb } from 'foo-webview-sdk/bridge';
import { createStore } from 'jotai/vanilla';
import { afterEach, expect, it, vi } from 'vitest';
import { initializeImmersivePrefs } from '../../../src/app/immersivePrefs.ts';
import { paintFpsCap, setPaintFpsCap } from '../../../src/immersive/frame/frameScheduler.ts';
import {
  chooseImmersiveFpsCap,
  chooseImmersiveHostFullscreen,
  chooseImmersiveTerrain,
  chooseImmersiveWash,
  chooseWaveformMode,
  immersiveFpsCapAtom,
  immersiveHostFullscreenAtom,
  immersiveSceneAtom,
  immersiveTerrainAtom,
  immersiveWashAtom,
  waveformModeAtom,
} from '../../../src/immersive/page/immersivePrefs.ts';
import {
  choosePerfOverlay,
  perfOverlayEnabledAtom,
} from '../../../src/immersive/perf/perfOverlay.ts';
import { installPrefStorage } from '../../../src/kit/localPref.ts';
import type { Store } from '../../../src/kit/store.ts';

const saved = {
  'default-theme.immersive.terrain.v1': 'off',
  'default-theme.immersive.wash.v1': 'static',
  'default-theme.immersive.hostFullscreen.v1': 'on',
  'default-theme.immersive.fpsCap.v1': '60',
  'default-theme.immersive.waveformMode.v1': 'lanes',
  'default-theme.immersive.scene.v1': 'paper',
  'default-theme.immersive.perfOverlay.v1': 'on',
};

function prefs(store: Store) {
  return {
    terrain: store.get(immersiveTerrainAtom),
    wash: store.get(immersiveWashAtom),
    fullscreen: store.get(immersiveHostFullscreenAtom),
    fps: store.get(immersiveFpsCapAtom),
    waveform: store.get(waveformModeAtom),
    scene: store.get(immersiveSceneAtom),
    perf: store.get(perfOverlayEnabledAtom),
  };
}

afterEach(() => {
  installPrefStorage(null);
  setPaintFpsCap(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('沿用七个存储键，按 store 初始化一次，新 store 独立加载', () => {
  const map = new Map(Object.entries(saved));
  const getItem = vi.fn((key: string) => map.get(key) ?? null);
  const setItem = vi.fn();
  installPrefStorage({ getItem, setItem });
  const store = createStore();
  initializeImmersivePrefs(store);
  expect(prefs(store)).toEqual({
    terrain: false,
    wash: 'static',
    fullscreen: true,
    fps: 60,
    waveform: 'lanes',
    scene: 'paper',
    perf: true,
  });
  expect(new Set(getItem.mock.calls.map(([key]) => key))).toEqual(new Set(Object.keys(saved)));
  expect(getItem).toHaveBeenCalledTimes(7);
  expect(setItem).not.toHaveBeenCalled();
  expect(paintFpsCap()).toBe(60);
  initializeImmersivePrefs(store);
  expect(getItem).toHaveBeenCalledTimes(7);
  const another = createStore();
  initializeImmersivePrefs(another);
  expect(prefs(another)).toEqual(prefs(store));
  expect(getItem).toHaveBeenCalledTimes(14);
});

it('先改设置但存储写入失败，再初始化不能用旧存档覆盖当前值', () => {
  const map = new Map(Object.entries(saved));
  const getItem = vi.fn((key: string) => map.get(key) ?? null);
  installPrefStorage({
    getItem,
    setItem: () => {
      throw new Error('denied');
    },
  });
  const store = createStore();
  initializeImmersivePrefs(store);
  chooseImmersiveTerrain(store, true);
  chooseImmersiveWash(store, 'off');
  chooseImmersiveHostFullscreen(store, false);
  chooseImmersiveFpsCap(store, 144);
  chooseWaveformMode(store, 'weighted');
  choosePerfOverlay(store, false);
  initializeImmersivePrefs(store);
  expect(prefs(store)).toEqual({
    terrain: true,
    wash: 'off',
    fullscreen: false,
    fps: 144,
    waveform: 'weighted',
    scene: 'paper',
    perf: false,
  });
  expect(getItem).toHaveBeenCalledTimes(7);
  expect(paintFpsCap()).toBe(144);
});

it('存储不可用时仅第一次采用缺省，之后保留本次运行中的修改', () => {
  installPrefStorage(null);
  const store = createStore();
  initializeImmersivePrefs(store);
  chooseImmersiveTerrain(store, false);
  chooseImmersiveHostFullscreen(store, true);
  choosePerfOverlay(store, true);
  const changed = prefs(store);
  initializeImmersivePrefs(store);
  expect(prefs(store)).toEqual(changed);
  expect(changed).toMatchObject({ terrain: false, fullscreen: true, perf: true });
});

it('读取全屏、背景和小窗开关不启动宿主任务、Worker、音频上下文或帧循环', () => {
  installPrefStorage({
    getItem: (key) => new Map(Object.entries(saved)).get(key) ?? null,
    setItem: vi.fn(),
  });
  const full = vi.spyOn(fb.ui, 'enterFullscreen');
  const spectrum = vi.spyOn(fb.audio, 'subscribeSpectrum');
  const stream = vi.spyOn(fb.audio, 'subscribeStream');
  const decode = vi.spyOn(fb.audio, 'decodePcm');
  const waveform = vi.spyOn(fb.audio, 'generateFullWaveform');
  const create = vi.fn(() => {
    throw new Error('不应创建资源');
  });
  for (const name of ['Worker', 'AudioContext', 'OfflineAudioContext', 'requestAnimationFrame']) {
    vi.stubGlobal(name, create);
  }
  vi.stubGlobal('document', { createElement: create });
  initializeImmersivePrefs(createStore());
  expect(create).not.toHaveBeenCalled();
  for (const call of [full, spectrum, stream, decode, waveform])
    expect(call).not.toHaveBeenCalled();
});
