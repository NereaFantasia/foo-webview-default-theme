import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import {
  chooseSurfaceTint,
  loadSurfaceTint,
  surfaceTintAtom,
  SURFACE_TINT_KEY,
} from '../../../src/theme/surfaceTint.ts';

test('菜单与浮层染色独立保存，重新载入恢复且不修改背景偏好', () => {
  const values = new Map([['default-theme.window-background.v1', '{"source":"cover"}']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const store = createStore();
  loadSurfaceTint(store, storage);
  expect(store.get(surfaceTintAtom)).toEqual({ menus: true, panels: true });
  chooseSurfaceTint(store, 'menus', false, storage);
  expect(store.get(surfaceTintAtom)).toEqual({ menus: false, panels: true });
  const restored = createStore();
  loadSurfaceTint(restored, storage);
  expect(restored.get(surfaceTintAtom)).toEqual({ menus: false, panels: true });
  chooseSurfaceTint(restored, 'panels', false, storage);
  loadSurfaceTint(store, storage);
  expect(store.get(surfaceTintAtom)).toEqual({ menus: false, panels: false });
  chooseSurfaceTint(store, 'menus', true, storage);
  expect(JSON.parse(values.get(SURFACE_TINT_KEY) ?? '')).toEqual({ menus: true, panels: false });
  expect(values.get('default-theme.window-background.v1')).toBe('{"source":"cover"}');
});

test.each([
  ['{"menus":false,"panels":"false"}', { menus: false, panels: true }],
  ['{"panels":false}', { menus: true, panels: false }],
  ['{"menus":0,"panels":null}', { menus: true, panels: true }],
  ['{invalid', { menus: true, panels: true }],
  ['[false,false]', { menus: true, panels: true }],
] as const)('无效存档逐项回退：%s', (raw, expected) => {
  const store = createStore();
  loadSurfaceTint(store, { getItem: () => raw, setItem() {} });
  expect(store.get(surfaceTintAtom)).toEqual(expected);
});

test('存储不可用时仍能独立切换，重复选择保留当前状态', () => {
  const storage = {
    getItem(): string | null {
      throw new Error('读取失败');
    },
    setItem(): void {
      throw new Error('写入失败');
    },
  };
  const store = createStore();
  loadSurfaceTint(store, storage);
  chooseSurfaceTint(store, 'menus', false, storage);
  const current = store.get(surfaceTintAtom);
  chooseSurfaceTint(store, 'menus', false, storage);
  expect(store.get(surfaceTintAtom)).toBe(current);
  chooseSurfaceTint(store, 'panels', false, null);
  expect(store.get(surfaceTintAtom)).toEqual({ menus: false, panels: false });
});
