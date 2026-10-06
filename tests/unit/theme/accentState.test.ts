import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import {
  accentRampAtom,
  coverRampAtom,
  coverProfileAtom,
  initializeAccent,
  chooseCoverAccentEnabled,
  publishCoverProfile,
  saveCoverProfile,
  COVER_PROFILE_STORAGE_KEY,
  COVER_ACCENT_STORAGE_KEY,
} from '../../../src/theme/accentState.ts';
import { tealBrand } from '../../../src/theme/brand.ts';
import { profileFromPixels } from '../../../src/theme/coverPalette.ts';

const PROFILE = profileFromPixels(new Uint8ClampedArray([40, 90, 200, 255]));

test('首帧前同步恢复完整档案，全局 off 不影响沉浸色与背景档案', () => {
  const store = createStore();
  const values = new Map([
    [COVER_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, profile: PROFILE })],
    [COVER_ACCENT_STORAGE_KEY, 'off'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  initializeAccent(store, storage);
  expect(store.get(coverProfileAtom)).toEqual(PROFILE);
  expect(store.get(accentRampAtom)).toBe(tealBrand);
  expect(store.get(coverRampAtom)).not.toBe(tealBrand);
  chooseCoverAccentEnabled(store, true, storage);
  expect(store.get(accentRampAtom)).toBe(store.get(coverRampAtom));
  publishCoverProfile(store, null);
  initializeAccent(store, storage);
  expect(store.get(coverProfileAtom)).toBeNull();
});

test.each([
  'broken',
  '{}',
  '{"version":2,"profile":{}}',
  '{"version":1,"profile":{"accent":true}}',
])('坏存档 %s 回到基础色', (saved) => {
  const store = createStore();
  initializeAccent(store, { getItem: () => saved, setItem: () => {} });
  expect(store.get(accentRampAtom)).toBe(tealBrand);
  expect(store.get(coverProfileAtom)).toBeNull();
});

test('存储抛错不阻断初始化、偏好修改或结果发布；停止存档不会复活旧颜色', () => {
  const store = createStore();
  const denied = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  initializeAccent(store, denied);
  publishCoverProfile(store, PROFILE);
  expect(() => saveCoverProfile(PROFILE, denied)).not.toThrow();
  chooseCoverAccentEnabled(store, false, denied);
  expect(store.get(accentRampAtom)).toBe(tealBrand);
  let saved = '';
  saveCoverProfile(null, {
    getItem: () => null,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  const next = createStore();
  initializeAccent(next, { getItem: () => saved, setItem: () => {} });
  expect(next.get(coverProfileAtom)).toBeNull();
});
