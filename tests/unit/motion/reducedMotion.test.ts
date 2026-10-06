import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  chooseMotion,
  loadMotionChoice,
  MOTION_STORAGE_KEY,
  motionChoiceAtom,
  reducedMotionAtom,
  systemReducedMotionAtom,
  watchReducedMotion,
} from '../../../src/motion/reducedMotion.ts';
import { fakeMedia } from '../../fixtures/fakeMedia.ts';

const REDUCE = '(prefers-reduced-motion: reduce)';

describe('reducedMotionAtom', () => {
  it('没有 matchMedia 时不减弱', () => {
    const store = createStore();
    watchReducedMotion(store, null)();
    expect(store.get(reducedMotionAtom)).toBe(false);
  });

  it('跟随系统的开关，停止后不再跟', () => {
    const store = createStore();
    const media = fakeMedia({ [REDUCE]: true });
    const stop = watchReducedMotion(store, media.matchMedia);
    expect(store.get(reducedMotionAtom)).toBe(true);
    media.set(REDUCE, false);
    expect(store.get(reducedMotionAtom)).toBe(false);

    stop();
    expect(media.listenerCount(REDUCE)).toBe(0);
    media.set(REDUCE, true);
    expect(store.get(reducedMotionAtom)).toBe(false);
  });
});

describe('动效档位', () => {
  function memoryStorage(initial: string | null = null) {
    const saved = new Map<string, string>();
    if (initial !== null) saved.set(MOTION_STORAGE_KEY, initial);
    return {
      saved,
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
    };
  }

  it('缺省跟随系统；存档认不出也按跟随', () => {
    for (const storage of [null, memoryStorage(), memoryStorage('off')]) {
      const store = createStore();
      loadMotionChoice(store, storage);
      expect(store.get(motionChoiceAtom)).toBe('system');
    }
  });

  it('选了减弱，系统不要求时也减弱；选回跟随又看系统', () => {
    const store = createStore();
    const storage = memoryStorage();
    const media = fakeMedia({ [REDUCE]: false });
    watchReducedMotion(store, media.matchMedia);
    loadMotionChoice(store, storage);
    expect(store.get(reducedMotionAtom)).toBe(false);

    chooseMotion(store, 'reduce', storage);
    expect(store.get(reducedMotionAtom)).toBe(true);
    expect(store.get(systemReducedMotionAtom)).toBe(false);
    expect(storage.saved.get(MOTION_STORAGE_KEY)).toBe('reduce');

    chooseMotion(store, 'system', storage);
    expect(store.get(reducedMotionAtom)).toBe(false);
    media.set(REDUCE, true);
    expect(store.get(reducedMotionAtom)).toBe(true);
  });

  it('存档里的减弱下次启动读回', () => {
    const store = createStore();
    loadMotionChoice(store, memoryStorage('reduce'));
    expect(store.get(reducedMotionAtom)).toBe(true);
  });
});
