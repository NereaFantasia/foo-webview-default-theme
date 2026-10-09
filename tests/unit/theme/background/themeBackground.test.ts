import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import { chooseColorMode } from '../../../../src/theme/colorScheme.ts';
import {
  loadWindowBackground,
  WINDOW_BACKGROUND_KEY,
} from '../../../../src/theme/background/windowBackground.ts';
import {
  THEME_BACKGROUND_KEY,
  chooseThemeBackgroundTint,
  loadThemeBackground,
  resetThemeBackgroundTint,
  themeBackgroundTintAtom,
} from '../../../../src/theme/background/themeBackground.ts';

test('主题色背景独立保存深浅强度，保留旧背景与材质偏好', () => {
  const values = new Map([
    ['default-theme.backdrop.v1', 'mica'],
    [WINDOW_BACKGROUND_KEY, '{"source":"material"}'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const store = createStore();
  loadWindowBackground(store, storage);
  chooseThemeBackgroundTint(store, 'light', 30, storage);
  chooseThemeBackgroundTint(store, 'dark', 5, storage);
  const restored = createStore();
  loadWindowBackground(restored, storage);
  chooseColorMode(restored, 'light', null);
  expect(restored.get(themeBackgroundTintAtom)).toBe(30);
  chooseColorMode(restored, 'dark', null);
  expect(restored.get(themeBackgroundTintAtom)).toBe(5);
  resetThemeBackgroundTint(restored, 'dark', storage);
  expect(restored.get(themeBackgroundTintAtom)).toBe(10);
  chooseColorMode(restored, 'light', null);
  expect(restored.get(themeBackgroundTintAtom)).toBe(30);
  expect(values.get('default-theme.backdrop.v1')).toBe('mica');
  expect(values.get(WINDOW_BACKGROUND_KEY)).toBe('{"source":"material"}');
  expect(values.has(THEME_BACKGROUND_KEY)).toBe(true);
});

test('主题色背景校验存档并钳位强度，不接受非有限数', () => {
  const store = createStore();
  loadThemeBackground(store, {
    getItem: () => '{"source":"url(x)","light":100,"dark":-5}',
    setItem() {},
  });
  chooseColorMode(store, 'light', null);
  expect(store.get(themeBackgroundTintAtom)).toBe(40);
  chooseThemeBackgroundTint(store, 'light', NaN, null);
  expect(store.get(themeBackgroundTintAtom)).toBe(40);
  chooseColorMode(store, 'dark', null);
  expect(store.get(themeBackgroundTintAtom)).toBe(0);
  loadThemeBackground(store, { getItem: () => '{invalid', setItem() {} });
  expect(store.get(themeBackgroundTintAtom)).toBe(10);
  chooseColorMode(store, 'light', null);
  expect(store.get(themeBackgroundTintAtom)).toBe(18);
});
