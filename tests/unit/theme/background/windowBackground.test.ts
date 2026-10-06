import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import { chooseColorMode } from '../../../../src/theme/colorScheme.ts';
import {
  BACKGROUND_DEFAULTS,
  backgroundParametersAtom,
  backgroundPreferencesAtom,
  backgroundSourceAtom,
  chooseBackgroundParameter,
  chooseBackgroundSource,
  loadWindowBackground,
  WINDOW_BACKGROUND_KEY,
} from '../../../../src/theme/background/windowBackground.ts';

test('深浅参数独立保存，首帧恢复自绘来源且不改旧材质键', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const store = createStore();
  loadWindowBackground(store, storage);
  chooseBackgroundSource(store, 'cover', storage);
  chooseBackgroundParameter(store, 'dark', 'shade', 35, storage);
  expect(store.get(backgroundPreferencesAtom).light).toEqual(BACKGROUND_DEFAULTS.light);
  const restored = createStore();
  loadWindowBackground(restored, storage);
  chooseColorMode(restored, 'dark', null);
  expect(restored.get(backgroundSourceAtom)).toBe('cover');
  expect(restored.get(backgroundParametersAtom).shade).toBe(35);
  expect([...values.keys()]).toEqual([WINDOW_BACKGROUND_KEY]);
});

test('参数钳位与坏存档回退，不接受非有限数或 CSS 注入', () => {
  const store = createStore();
  loadWindowBackground(store, {
    getItem: () =>
      JSON.stringify({ source: 'url(x)', dark: { blur: 999, shade: 'bad', inactive: -1 } }),
    setItem() {},
  });
  expect(store.get(backgroundSourceAtom)).toBe('material');
  expect(store.get(backgroundPreferencesAtom).dark).toEqual({
    blur: 120,
    shade: 25,
    inactive: 0,
    content: 70,
  });
  chooseBackgroundParameter(store, 'dark', 'shade', NaN, null);
  expect(store.get(backgroundPreferencesAtom).dark.shade).toBe(25);
  loadWindowBackground(store, { getItem: () => '{broken', setItem() {} });
  expect(store.get(backgroundPreferencesAtom)).toEqual(BACKGROUND_DEFAULTS);
});

test('存储抛错仍可本次选择背景', () => {
  const storage = {
    getItem(): string | null {
      throw new Error();
    },
    setItem() {
      throw new Error();
    },
  };
  const store = createStore();
  loadWindowBackground(store, storage);
  chooseBackgroundSource(store, 'palette', storage);
  expect(store.get(backgroundSourceAtom)).toBe('palette');
});
