import type { WindowBackdropPolicyPatch } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startBackdrop, type BackdropFace } from '../../../src/theme/backdrop.ts';
import {
  chooseColorMode,
  COLOR_MODE_STORAGE_KEY,
  colorModeAtom,
  colorSchemeAtom,
  watchColorScheme,
} from '../../../src/theme/colorScheme.ts';
import type { PrefStorage } from '../../../src/kit/localPref.ts';
import { fakeMedia } from '../../fixtures/fakeMedia.ts';

const DARK = '(prefers-color-scheme: dark)';

/** 内存里的存档；`broken` 为真时读写都抛错，当存储被禁。 */
function fakeStorage(saved: string | null = null, broken = false) {
  const values = new Map<string, string>();
  if (saved !== null) values.set(COLOR_MODE_STORAGE_KEY, saved);
  const storage: PrefStorage = {
    getItem: (key) => {
      if (broken) throw new Error('存储被禁');
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (broken) throw new Error('存储被禁');
      values.set(key, value);
    },
  };
  return { storage, saved: () => values.get(COLOR_MODE_STORAGE_KEY) ?? null };
}

describe('colorSchemeAtom', () => {
  it('没有 matchMedia 时是浅色', () => {
    const store = createStore();
    watchColorScheme(store, null, null)();
    expect(store.get(colorSchemeAtom)).toBe('light');
  });

  it('起步就取系统当前的深浅', () => {
    const store = createStore();
    watchColorScheme(store, fakeMedia({ [DARK]: true }).matchMedia, null);
    expect(store.get(colorSchemeAtom)).toBe('dark');
  });

  it('系统切换深浅时跟着变，停止后不再跟', () => {
    const store = createStore();
    const media = fakeMedia();
    const stop = watchColorScheme(store, media.matchMedia, null);
    media.set(DARK, true);
    expect(store.get(colorSchemeAtom)).toBe('dark');
    media.set(DARK, false);
    expect(store.get(colorSchemeAtom)).toBe('light');

    stop();
    expect(media.listenerCount(DARK)).toBe(0);
    media.set(DARK, true);
    expect(store.get(colorSchemeAtom)).toBe('light');
  });
});

describe('深浅模式', () => {
  it('没有存档时跟随系统', () => {
    const store = createStore();
    watchColorScheme(store, fakeMedia({ [DARK]: true }).matchMedia, fakeStorage().storage);
    expect(store.get(colorModeAtom)).toBe('system');
    expect(store.get(colorSchemeAtom)).toBe('dark');
  });

  it('读回用户定的那一档，不看系统', () => {
    const store = createStore();
    const media = fakeMedia({ [DARK]: true });
    watchColorScheme(store, media.matchMedia, fakeStorage('light').storage);
    expect(store.get(colorModeAtom)).toBe('light');
    expect(store.get(colorSchemeAtom)).toBe('light');

    media.set(DARK, false);
    media.set(DARK, true);
    expect(store.get(colorSchemeAtom)).toBe('light');
  });

  it('存档里的值不在表里时回到跟随系统', () => {
    const store = createStore();
    watchColorScheme(store, fakeMedia().matchMedia, fakeStorage('sepia').storage);
    expect(store.get(colorModeAtom)).toBe('system');
  });

  it('换档立即生效并落盘，换回跟随系统后取系统此刻的深浅', () => {
    const store = createStore();
    const media = fakeMedia();
    const { storage, saved } = fakeStorage();
    watchColorScheme(store, media.matchMedia, storage);

    chooseColorMode(store, 'dark', storage);
    expect(store.get(colorSchemeAtom)).toBe('dark');
    expect(saved()).toBe('dark');

    media.set(DARK, true);
    chooseColorMode(store, 'light', storage);
    expect(store.get(colorSchemeAtom)).toBe('light');

    chooseColorMode(store, 'system', storage);
    expect(store.get(colorSchemeAtom)).toBe('dark');
    expect(saved()).toBe('system');
  });

  it('存储读写都抛错时照常生效，只是记不住', () => {
    const store = createStore();
    const { storage } = fakeStorage(null, true);
    watchColorScheme(store, fakeMedia().matchMedia, storage);
    expect(store.get(colorModeAtom)).toBe('system');

    chooseColorMode(store, 'dark', storage);
    expect(store.get(colorSchemeAtom)).toBe('dark');
  });

  it('换档后材质服务按新的深浅重发一次', async () => {
    const store = createStore();
    watchColorScheme(store, fakeMedia().matchMedia, null);
    const sent: WindowBackdropPolicyPatch[] = [];
    const host: BackdropFace = {
      isAvailable: () => true,
      ready: () => Promise.resolve(),
      on: () => () => {},
      ui: {
        getCurrentWindowId: () => Promise.resolve({ success: true, windowId: 'main' }),
        setBackdropPolicy: (patch) => {
          sent.push(patch);
          return Promise.resolve({ success: false, error: 'hidden', code: 'OPERATION_FAILED' });
        },
      },
    };
    const backdrop = startBackdrop(store, host, null);
    await backdrop.ready;
    expect(sent.map((patch) => patch.darkMode)).toEqual([false]);

    chooseColorMode(store, 'dark', null);
    expect(sent.map((patch) => patch.darkMode)).toEqual([false, true]);
    backdrop.dispose();
  });
});
