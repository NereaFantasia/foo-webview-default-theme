import { createStore } from 'jotai/vanilla';
import { expect, it } from 'vitest';
import {
  choosePlayButtonStyle,
  loadPlayButtonStyle,
  playButtonStyleAtom,
  PLAY_BUTTON_STYLE_KEY,
} from '../../../src/theme/playButtonStyle.ts';

it('默认柔和，无效存档也回退柔和', () => {
  const store = createStore();
  expect(store.get(playButtonStyleAtom)).toBe('soft');
  loadPlayButtonStyle(store, { getItem: () => 'unknown', setItem() {} });
  expect(store.get(playButtonStyleAtom)).toBe('soft');
});

it('选择即时发布并可在首帧恢复', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const first = createStore();
  choosePlayButtonStyle(first, 'neutral', storage);
  expect(first.get(playButtonStyleAtom)).toBe('neutral');
  expect(values.get(PLAY_BUTTON_STYLE_KEY)).toBe('neutral');
  const second = createStore();
  loadPlayButtonStyle(second, storage);
  expect(second.get(playButtonStyleAtom)).toBe('neutral');
});

it('存储不可用不阻止当前切换', () => {
  const store = createStore();
  const storage = {
    getItem(): string | null {
      throw new Error('不可读');
    },
    setItem() {
      throw new Error('不可写');
    },
  };
  loadPlayButtonStyle(store, storage);
  expect(store.get(playButtonStyleAtom)).toBe('soft');
  choosePlayButtonStyle(store, 'raw', storage);
  expect(store.get(playButtonStyleAtom)).toBe('raw');
});
