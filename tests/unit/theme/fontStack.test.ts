import { createStore } from 'jotai/vanilla';
import { describe, expect, it, test } from 'vitest';
import {
  chooseFont,
  FONT_CHOICE_KEY,
  fontChoiceAtom,
  loadFontChoice,
} from '../../../src/theme/fontChoice.ts';
import {
  DEFAULT_FONT_CHOICE,
  fontNameOf,
  fontStack,
  isFontName,
  menuFontStack,
  quoteFont,
} from '../../../src/theme/fontStack.ts';

const at = (stack: string, name: string) => stack.indexOf(name);

describe('界面字体栈', () => {
  it('默认栈从 Segoe UI 起排，以 sans-serif 收尾，不带用户字体', () => {
    const stack = fontStack(DEFAULT_FONT_CHOICE);
    expect(stack.startsWith("'Segoe UI'")).toBe(true);
    expect(stack.endsWith('sans-serif')).toBe(true);
  });

  it('用户的西文字体排在默认西文字体前，中日韩字体排在它们后、sans-serif 前', () => {
    const stack = fontStack({ latin: 'Inter', cjk: 'DengXian' });
    expect(at(stack, '"Inter"')).toBe(0);
    expect(at(stack, '"Inter"')).toBeLessThan(at(stack, "'Segoe UI'"));
    expect(at(stack, "'Segoe UI Web (West European)'")).toBeLessThan(at(stack, '"DengXian"'));
    expect(at(stack, '"DengXian"')).toBeLessThan(at(stack, 'sans-serif'));
  });

  it('只选一个时另一个仍用默认', () => {
    expect(fontStack({ latin: '', cjk: 'DengXian' })).not.toContain('Inter');
    expect(fontStack({ latin: 'Inter', cjk: '' }).split('"').length).toBe(3);
  });

  it('家族名里的引号与反斜杠转义，不会截断 font-family', () => {
    expect(quoteFont('A"B\\C')).toBe('"A\\"B\\\\C"');
  });

  it('菜单栈保留 Windows 菜单的写法，用户的字体排在对应位置', () => {
    expect(menuFontStack(DEFAULT_FONT_CHOICE)).toBe(
      "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif",
    );
    const stack = menuFontStack({ latin: 'Inter', cjk: 'DengXian' });
    expect(at(stack, '"Inter"')).toBeLessThan(at(stack, "'Segoe UI Variable'"));
    expect(at(stack, '"DengXian"')).toBeLessThan(at(stack, "'Microsoft YaHei UI'"));
  });
});

describe('字体名校验', () => {
  it('不超过 200 个字符且没有控制字符才收；读出来先去首尾空白', () => {
    expect(isFontName('微软雅黑')).toBe(true);
    expect(isFontName('x'.repeat(201))).toBe(false);
    expect(isFontName('bad\nname')).toBe(false);
    expect(isFontName('bad\u007fname')).toBe(false);
    expect(fontNameOf('  Inter  ')).toBe('Inter');
    expect(fontNameOf('bad\u0000')).toBe('');
    expect(fontNameOf(5)).toBe('');
    expect(fontNameOf(undefined)).toBe('');
  });
});

describe('界面字体偏好', () => {
  const storageOf = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });

  it('选了就保存，重新载入恢复；没变的不重复写', () => {
    const values = new Map<string, string>();
    const storage = storageOf(values);
    const store = createStore();
    loadFontChoice(store, storage);
    expect(store.get(fontChoiceAtom)).toEqual({ latin: '', cjk: '' });
    chooseFont(store, { cjk: ' DengXian ' }, storage);
    expect(JSON.parse(values.get(FONT_CHOICE_KEY) ?? '')).toEqual({ latin: '', cjk: 'DengXian' });
    const restored = createStore();
    loadFontChoice(restored, storage);
    expect(restored.get(fontChoiceAtom)).toEqual({ latin: '', cjk: 'DengXian' });
    values.delete(FONT_CHOICE_KEY);
    chooseFont(store, { cjk: 'DengXian' }, storage);
    expect(values.has(FONT_CHOICE_KEY)).toBe(false);
    chooseFont(store, { cjk: '' }, storage);
    expect(JSON.parse(values.get(FONT_CHOICE_KEY) ?? '')).toEqual({ latin: '', cjk: '' });
  });

  test.each([
    ['{"latin":"Inter","cjk":5}', { latin: 'Inter', cjk: '' }],
    ['{"latin":"bad\\nname"}', { latin: '', cjk: '' }],
    ['{invalid', { latin: '', cjk: '' }],
    ['[1]', { latin: '', cjk: '' }],
  ] as const)('无效存档逐项回到默认：%s', (raw, expected) => {
    const store = createStore();
    loadFontChoice(store, { getItem: () => raw, setItem() {} });
    expect(store.get(fontChoiceAtom)).toEqual(expected);
  });
});
