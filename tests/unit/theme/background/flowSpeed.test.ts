import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import {
  FLOW_SPEED_KEY,
  FLOW_SPEED_LIMITS,
  chooseFlowSpeed,
  flowSpeedAtom,
  loadFlowSpeed,
} from '../../../../src/theme/background/flowSpeed.ts';
import {
  loadWindowBackground,
  WINDOW_BACKGROUND_KEY,
} from '../../../../src/theme/background/windowBackground.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const storage: PrefStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      values.set(key, value);
      writes.push([key, value]);
    },
  };
  return { values, writes, storage };
}

function loaded(raw: string | null): number {
  const store = createStore();
  loadFlowSpeed(store, {
    getItem: (key) => (key === FLOW_SPEED_KEY ? raw : null),
    setItem() {},
  });
  return store.get(flowSpeedAtom);
}

test('没有存档时是原速', () => {
  expect(loaded(null)).toBe(FLOW_SPEED_LIMITS.default);
  expect(FLOW_SPEED_LIMITS.default).toBe(100);
});

test('存档读出百分数，取整并夹到范围内', () => {
  expect(loaded('{"speed":130}')).toBe(130);
  expect(loaded('{"speed":99.6}')).toBe(100);
  expect(loaded('{"speed":500}')).toBe(FLOW_SPEED_LIMITS.max);
  expect(loaded('{"speed":1}')).toBe(FLOW_SPEED_LIMITS.min);
  expect(loaded('{"speed":-40}')).toBe(FLOW_SPEED_LIMITS.min);
});

test('存档坏了或速度不是有限数时回到缺省', () => {
  for (const raw of ['{invalid', '[]', '{}', '{"speed":"fast"}', '{"speed":null}', '7']) {
    expect(loaded(raw)).toBe(FLOW_SPEED_LIMITS.default);
  }
});

test('选值写回 {"speed":N}，同值不重写，非有限数忽略，越界夹住', () => {
  const { values, writes, storage } = memoryStorage();
  const store = createStore();
  chooseFlowSpeed(store, 130, storage);
  expect(store.get(flowSpeedAtom)).toBe(130);
  expect(values.get(FLOW_SPEED_KEY)).toBe('{"speed":130}');
  chooseFlowSpeed(store, 130, storage);
  expect(writes).toHaveLength(1);
  chooseFlowSpeed(store, Number.NaN, storage);
  chooseFlowSpeed(store, Number.POSITIVE_INFINITY, storage);
  expect(store.get(flowSpeedAtom)).toBe(130);
  expect(writes).toHaveLength(1);
  chooseFlowSpeed(store, 900, storage);
  expect(store.get(flowSpeedAtom)).toBe(FLOW_SPEED_LIMITS.max);
  expect(values.get(FLOW_SPEED_KEY)).toBe('{"speed":200}');
});

test('随窗口背景一起载入，也不改动别的存档', () => {
  const { values, storage } = memoryStorage({
    [WINDOW_BACKGROUND_KEY]: '{"source":"palette"}',
    [FLOW_SPEED_KEY]: '{"speed":65}',
  });
  const store = createStore();
  loadWindowBackground(store, storage);
  expect(store.get(flowSpeedAtom)).toBe(65);
  chooseFlowSpeed(store, 80, storage);
  expect(values.get(WINDOW_BACKGROUND_KEY)).toBe('{"source":"palette"}');
  const restored = createStore();
  loadWindowBackground(restored, storage);
  expect(restored.get(flowSpeedAtom)).toBe(80);
});
