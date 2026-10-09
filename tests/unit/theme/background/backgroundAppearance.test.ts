import { createStore } from 'jotai/vanilla';
import { argbFromRgb, Hct } from '@material/material-color-utilities';
import { expect, test } from 'vitest';
import {
  APPEARANCE_DEFAULTS,
  BACKGROUND_APPEARANCE_KEY,
  backgroundAppearanceAtom,
  chooseBackgroundAppearance,
  loadBackgroundAppearance,
  tintedSurface,
} from '../../../../src/theme/background/backgroundAppearance.ts';
import { chooseColorMode } from '../../../../src/theme/colorScheme.ts';
import {
  backgroundPreferencesAtom,
  chooseBackgroundParameter,
  chooseBackgroundSource,
  loadWindowBackground,
  resetBackgroundParameters,
  WINDOW_BACKGROUND_KEY,
} from '../../../../src/theme/background/windowBackground.ts';

test('新增外观偏好深浅独立保存，不覆写原背景键；恢复只影响当前档数值', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const store = createStore();
  loadWindowBackground(store, storage);
  chooseBackgroundSource(store, 'palette', storage);
  chooseBackgroundParameter(store, 'dark', 'shade', 43, storage);
  const original = values.get(WINDOW_BACKGROUND_KEY);
  chooseBackgroundAppearance(store, 'light', 'saturation', 170, storage);
  chooseBackgroundAppearance(store, 'dark', 'grain', 7, storage);
  expect(values.get(WINDOW_BACKGROUND_KEY)).toBe(original);
  expect(values.has(BACKGROUND_APPEARANCE_KEY)).toBe(true);
  const restored = createStore();
  loadWindowBackground(restored, storage);
  chooseColorMode(restored, 'light', null);
  expect(restored.get(backgroundAppearanceAtom).saturation).toBe(170);
  resetBackgroundParameters(restored, 'light', storage);
  expect(restored.get(backgroundAppearanceAtom)).toEqual(APPEARANCE_DEFAULTS.light);
  expect(restored.get(backgroundPreferencesAtom).source).toBe('palette');
  expect(restored.get(backgroundPreferencesAtom).dark.shade).toBe(43);
  chooseColorMode(restored, 'dark', null);
  expect(restored.get(backgroundAppearanceAtom).grain).toBe(7);
});

test('外观存档逐项钳位，坏值回默认，不能写入非有限数', () => {
  const store = createStore();
  loadBackgroundAppearance(store, {
    getItem: () =>
      JSON.stringify({ light: { saturation: -1, brightness: 999, grain: 'css', capsule: 63.6 } }),
    setItem() {},
  });
  chooseColorMode(store, 'light', null);
  expect(store.get(backgroundAppearanceAtom)).toEqual({
    ...APPEARANCE_DEFAULTS.light,
    saturation: 0,
    brightness: 160,
    capsule: 64,
  });
  chooseBackgroundAppearance(store, 'light', 'grain', Infinity, null);
  expect(store.get(backgroundAppearanceAtom).grain).toBe(APPEARANCE_DEFAULTS.light.grain);
  chooseBackgroundAppearance(store, 'light', 'capsule', -10, null);
  expect(store.get(backgroundAppearanceAtom).capsule).toBe(0);
});

test('封面染色保留主色差异，灰封面、关闭染色或饱和度为零时保留中性表面', () => {
  const color = (r: number, g: number, b: number) => {
    const argb = argbFromRgb(r, g, b);
    const hct = Hct.fromInt(argb);
    return { argb, hue: hct.hue, chroma: hct.chroma, tone: hct.tone };
  };
  const neutral = 'var(--colorNeutralBackground2)';
  for (const scheme of ['light', 'dark'] as const) {
    const appearance = APPEARANCE_DEFAULTS[scheme];
    const blue = tintedSurface(neutral, color(0, 0, 255), scheme, appearance);
    expect(blue).not.toBe(neutral);
    expect(blue).not.toBe(tintedSurface(neutral, color(255, 0, 0), scheme, appearance));
    expect(tintedSurface(neutral, color(128, 128, 128), scheme, appearance)).toBe(neutral);
    expect(tintedSurface(neutral, color(0, 0, 255), scheme, { ...appearance, tint: 0 })).toBe(
      neutral,
    );
    expect(tintedSurface(neutral, color(0, 0, 255), scheme, { ...appearance, saturation: 0 })).toBe(
      neutral,
    );
  }
});
