// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  FONT_WEIGHT_RANGE,
  fontStyleOf,
  fontWeightOf,
  probeVariableWeight,
  registerVariableFont,
  variableAlias,
} from '../../../src/kit/variableFont.ts';

describe('字重取值', () => {
  it('只收 100 到 900 的数，取整；其余当没指定', () => {
    expect(fontWeightOf(450)).toBe(450);
    expect(fontWeightOf(450.6)).toBe(451);
    expect(fontWeightOf(FONT_WEIGHT_RANGE.min)).toBe(100);
    expect(fontWeightOf(FONT_WEIGHT_RANGE.max)).toBe(900);
    expect(fontWeightOf(99)).toBeNull();
    expect(fontWeightOf(901)).toBeNull();
    expect(fontWeightOf(Number.NaN)).toBeNull();
    expect(fontWeightOf('450')).toBeNull();
    expect(fontWeightOf(null)).toBeNull();
  });
});

describe('可变字体别名', () => {
  it('同一个字体同一个别名，不同字体不同别名', () => {
    expect(variableAlias('Bahnschrift')).toBe(variableAlias('Bahnschrift'));
    expect(variableAlias('Bahnschrift')).not.toBe(variableAlias('Segoe UI Variable Text'));
    expect(variableAlias('Bahnschrift')).toMatch(/^theme-vf-[0-9a-z]+$/);
  });

  it('注册写进页面样式，用 local() 指向本机字体并声明字重范围；重复注册只写一次', () => {
    const before = document.head.querySelectorAll('style').length;
    const alias = registerVariableFont('Test "Quoted" Font');
    expect(registerVariableFont('Test "Quoted" Font')).toBe(alias);
    const sheets = [...document.head.querySelectorAll('style')];
    expect(sheets.length).toBeGreaterThanOrEqual(before);
    const text = sheets.map((sheet) => sheet.textContent ?? '').join('\n');
    expect(text.split(`font-family: "${alias}"`).length).toBe(2);
    expect(text).toContain('local("Test \\"Quoted\\" Font")');
    expect(text).toContain('local("Test \\"Quoted\\" Font Regular")');
    expect(text).toContain('font-weight: 100 900');
  });

  it('没选字重或没选字体时不走别名', () => {
    const stack = (family: string) => `"${family}", fallback`;
    expect(fontStyleOf('', 450, stack)).toEqual({ fontFamily: '"", fallback' });
    expect(fontStyleOf('Inter', null, stack)).toEqual({ fontFamily: '"Inter", fallback' });
    const weighted = fontStyleOf('Inter', 450, stack);
    expect(weighted).toEqual({
      fontFamily: `"${variableAlias('Inter')}", "Inter", fallback`,
      fontWeight: 450,
    });
  });
});

describe('探测能不能连续调字重', () => {
  const load = vi.fn(() => Promise.resolve([]));
  Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });

  it('字重 450 的墨量与 400、500 都不同才算可变字体', async () => {
    const continuous = vi.fn((_: string, weight: number) => weight * 10);
    expect(await probeVariableWeight('Continuous Font', continuous)).toBe(true);
    expect(continuous).toHaveBeenCalledTimes(3);
  });

  it('静态字体 450 与 400 或 500 同一个字面，不算', async () => {
    expect(
      await probeVariableWeight('Static Font', (_, weight) => (weight < 500 ? 100 : 200)),
    ).toBe(false);
    expect(
      await probeVariableWeight('Static Font Two', (_, weight) => (weight > 400 ? 200 : 100)),
    ).toBe(false);
  });

  it('结果按字体缓存，不重复量；拿不到画布时答否', async () => {
    const measure = vi.fn((_: string, weight: number) => weight);
    await probeVariableWeight('Cached Font', measure);
    await probeVariableWeight('Cached Font', measure);
    expect(measure).toHaveBeenCalledTimes(3);
    expect(await probeVariableWeight('No Canvas Font', null)).toBe(false);
  });
});
