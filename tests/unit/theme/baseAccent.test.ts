import { createStore } from 'jotai/vanilla';
import { expect, onTestFinished, test } from 'vitest';
import {
  BASE_ACCENT_STORAGE_KEY,
  baseAccentColorAtom,
  baseAccentModeAtom,
  baseAccentRampAtom,
  chooseBaseAccent,
  chooseCustomAccent,
  initializeBaseAccent,
  refreshWindowsAccent,
  startBaseAccent,
  windowsAccentFailedAtom,
} from '../../../src/theme/baseAccent.ts';
import {
  accentRampAtom,
  chooseCoverAccentEnabled,
  coverRampAtom,
  publishCoverProfile,
} from '../../../src/theme/accentState.ts';
import { tealBrand } from '../../../src/theme/brand.ts';
import { profileFromPixels } from '../../../src/theme/coverPalette.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const theme = (accentColor: string) => ({
  success: true as const,
  darkMode: false,
  isDark: false,
  accentColor,
  transparency: true,
});

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('缺省保留固定青绿，自定义校验、即时生效并跨 store 恢复', () => {
  const storage = memory();
  const store = createStore();
  initializeBaseAccent(store, storage);
  expect(store.get(baseAccentRampAtom)).toBe(tealBrand);
  chooseBaseAccent(store, 'custom', storage);
  expect(chooseCustomAccent(store, '#A12BCE', storage)).toBe(true);
  const ramp = store.get(baseAccentRampAtom);
  expect(ramp).not.toBe(tealBrand);
  expect(chooseCustomAccent(store, 'red', storage)).toBe(false);
  expect(store.get(baseAccentRampAtom)).toBe(ramp);
  const restored = createStore();
  initializeBaseAccent(restored, storage);
  expect(restored.get(baseAccentColorAtom)).toBe('#a12bce');
  expect(restored.get(baseAccentRampAtom)).toEqual(ramp);
  chooseBaseAccent(restored, 'teal', storage);
  expect(restored.get(baseAccentRampAtom)).toBe(tealBrand);
});

test('坏存档回退，不接受任意 CSS 或无效模式', () => {
  for (const raw of ['broken', '{"mode":"other"}', '{"mode":"custom","custom":"url(x)"}']) {
    const store = createStore();
    initializeBaseAccent(store, { getItem: () => raw, setItem: () => {} });
    expect(store.get(baseAccentColorAtom)).toBe(tealBrand[100]);
  }
});

test('Windows 只在需要时读取，失败保留上次颜色并可刷新恢复', async () => {
  const host = installFakeHost();
  host.answer('system.getTheme', theme('#cc2277'));
  const store = createStore();
  const storage = memory();
  const service = startBaseAccent(store, { host: host.fb, storage, focus: null });
  onTestFinished(() => service.dispose());
  expect(host.callsTo('system.getTheme')).toHaveLength(0);
  chooseBaseAccent(store, 'windows', storage);
  await flush();
  expect(store.get(baseAccentColorAtom)).toBe('#cc2277');
  host.answer('system.getTheme', hostFailure('OPERATION_FAILED'));
  refreshWindowsAccent(store);
  await flush();
  expect(store.get(windowsAccentFailedAtom)).toBe(true);
  expect(store.get(baseAccentColorAtom)).toBe('#cc2277');
  host.answer('system.getTheme', theme('#3366cc'));
  refreshWindowsAccent(store);
  await flush();
  expect(store.get(windowsAccentFailedAtom)).toBe(false);
  expect(store.get(baseAccentColorAtom)).toBe('#3366cc');
  const restored = createStore();
  initializeBaseAccent(restored, storage);
  expect(restored.get(baseAccentModeAtom)).toBe('windows');
  expect(restored.get(baseAccentColorAtom)).toBe('#3366cc');
  expect(storage.getItem(BASE_ACCENT_STORAGE_KEY)).not.toBeNull();
});

test('Windows 迟到应答在换模式或释放后不写入', async () => {
  const host = installFakeHost();
  host.answer('system.getTheme', theme('#ee2211'));
  const held = host.hold('system.getTheme');
  const store = createStore();
  const service = startBaseAccent(store, { host: host.fb, storage: null, focus: null });
  chooseBaseAccent(store, 'windows', null);
  await flush();
  chooseBaseAccent(store, 'custom', null);
  chooseCustomAccent(store, '#335588', null);
  held.respond(0, theme('#ee2211'));
  await flush();
  expect(store.get(baseAccentColorAtom)).toBe('#335588');
  chooseBaseAccent(store, 'windows', null);
  await flush();
  service.dispose();
  held.respond(0, theme('#ee2211'));
  await flush();
  expect(store.get(baseAccentColorAtom)).toBe(tealBrand[100]);
});

test('封面优先；关闭全局跟随只让外壳使用基础色，灰图回基础色', () => {
  const store = createStore();
  chooseBaseAccent(store, 'custom', null);
  chooseCustomAccent(store, '#cc2255', null);
  publishCoverProfile(store, profileFromPixels(new Uint8ClampedArray([40, 90, 200, 255])));
  expect(store.get(accentRampAtom)).not.toEqual(store.get(baseAccentRampAtom));
  const immersive = store.get(coverRampAtom);
  chooseCoverAccentEnabled(store, false, null);
  expect(store.get(accentRampAtom)).toBe(store.get(baseAccentRampAtom));
  expect(store.get(coverRampAtom)).toBe(immersive);
  publishCoverProfile(store, profileFromPixels(new Uint8ClampedArray([128, 128, 128, 255])));
  expect(store.get(coverRampAtom)).toBe(store.get(baseAccentRampAtom));
});
