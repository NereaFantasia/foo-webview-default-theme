import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  choosePlayerBarStyle,
  loadPlayerBarStyle,
  PLAYER_BAR_STORAGE_KEY,
  playerBarStyleAtom,
  playerShellOf,
} from '../../../src/theme/playerBarStyle.ts';
import type { PrefStorage } from '../../../src/kit/localPref.ts';

function storageWith(value: string | null) {
  const saved = new Map<string, string>();
  if (value !== null) saved.set(PLAYER_BAR_STORAGE_KEY, value);
  return {
    saved,
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, next: string) => void saved.set(key, next),
  };
}

const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError');
  },
  setItem(): void {
    throw new Error('QuotaExceededError');
  },
};

/** 从一个新 store 读回存档里的形态。 */
function readPlayerBarStyle(storage: PrefStorage | null) {
  const store = createStore();
  loadPlayerBarStyle(store, storage);
  return store.get(playerBarStyleAtom);
}

describe('读存档', () => {
  it('没有存档时是底部通栏', () => {
    expect(readPlayerBarStyle(storageWith(null))).toBe('bottom');
  });

  it('认得的三种原样读回', () => {
    expect(readPlayerBarStyle(storageWith('titlebar'))).toBe('titlebar');
    expect(readPlayerBarStyle(storageWith('bottom'))).toBe('bottom');
    expect(readPlayerBarStyle(storageWith('capsule'))).toBe('capsule');
  });

  it('取值不认得时回到缺省', () => {
    expect(readPlayerBarStyle(storageWith('"titlebar"'))).toBe('bottom');
    expect(readPlayerBarStyle(storageWith('floating'))).toBe('bottom');
    expect(readPlayerBarStyle(storageWith(''))).toBe('bottom');
  });

  it('存储被禁、读的时候抛错都回到缺省', () => {
    expect(readPlayerBarStyle(null)).toBe('bottom');
    expect(readPlayerBarStyle(throwing)).toBe('bottom');
  });
});

describe('loadPlayerBarStyle', () => {
  it('读到的形态写进 store', () => {
    const store = createStore();
    expect(store.get(playerBarStyleAtom)).toBe('bottom');
    loadPlayerBarStyle(store, storageWith('titlebar'));
    expect(store.get(playerBarStyleAtom)).toBe('titlebar');
  });
});

describe('playerShellOf', () => {
  it('底部通栏：导航键在标题栏，各档都是通栏', () => {
    for (const wide of [true, false]) {
      expect(playerShellOf('bottom', wide)).toEqual({
        inTitlebar: false,
        capsule: false,
        bottom: true,
        navRow: false,
      });
    }
  });

  it('标题栏：宽窗放进标题栏，窄窗换成胶囊；导航行都在', () => {
    expect(playerShellOf('titlebar', true)).toEqual({
      inTitlebar: true,
      capsule: false,
      bottom: false,
      navRow: true,
    });
    expect(playerShellOf('titlebar', false)).toEqual({
      inTitlebar: false,
      capsule: true,
      bottom: false,
      navRow: true,
    });
  });

  it('胶囊：各档都是胶囊，导航键在标题栏、没有导航行', () => {
    for (const wide of [true, false]) {
      expect(playerShellOf('capsule', wide)).toEqual({
        inTitlebar: false,
        capsule: true,
        bottom: false,
        navRow: false,
      });
    }
  });
});

describe('choosePlayerBarStyle', () => {
  it('换形态立即生效并落盘，下次启动读回的是它', () => {
    const store = createStore();
    const storage = storageWith(null);
    loadPlayerBarStyle(store, storage);
    choosePlayerBarStyle(store, 'titlebar', storage);
    expect(store.get(playerBarStyleAtom)).toBe('titlebar');
    expect(storage.saved.get(PLAYER_BAR_STORAGE_KEY)).toBe('titlebar');

    const next = createStore();
    loadPlayerBarStyle(next, storage);
    expect(next.get(playerBarStyleAtom)).toBe('titlebar');
  });

  it('和此刻一样就不写存档', () => {
    const store = createStore();
    const storage = storageWith(null);
    choosePlayerBarStyle(store, 'bottom', storage);
    expect(storage.saved.has(PLAYER_BAR_STORAGE_KEY)).toBe(false);
  });

  it('存储被禁或写满时这一次照常生效', () => {
    const store = createStore();
    choosePlayerBarStyle(store, 'titlebar', throwing);
    expect(store.get(playerBarStyleAtom)).toBe('titlebar');
    choosePlayerBarStyle(store, 'bottom', null);
    expect(store.get(playerBarStyleAtom)).toBe('bottom');
  });
});
