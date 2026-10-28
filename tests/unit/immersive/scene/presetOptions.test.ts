import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  mergeOptions,
  parseStoredOptions,
  resolvePresetId,
  withStoredOption,
  type OptionSchema,
} from '../../../../src/immersive/scene/presetOptions.ts';

const SCHEMA = {
  align: { kind: 'choice', choices: ['left', 'center'], default: 'left' },
  rounded: { kind: 'switch', default: true },
  size: { kind: 'range', min: 10, max: 40, step: 2, default: 24 },
} as const satisfies OptionSchema;

describe('mergeOptions', () => {
  it('没有存档时全是声明的缺省值', () => {
    expect(mergeOptions(SCHEMA, undefined)).toEqual({ align: 'left', rounded: true, size: 24 });
    expect(mergeOptions(SCHEMA, {})).toEqual({ align: 'left', rounded: true, size: 24 });
  });

  it('存档里改过的项盖过缺省，没改的仍是缺省', () => {
    expect(mergeOptions(SCHEMA, { align: 'center', size: 30 })).toEqual({
      align: 'center',
      rounded: true,
      size: 30,
    });
    // 存成与缺省相同的值也照样有效
    expect(mergeOptions(SCHEMA, { rounded: false }).rounded).toBe(false);
  });

  it('不认识的键丢掉，不进结果', () => {
    const merged = mergeOptions(SCHEMA, { align: 'center', legacy: 1, toString: 1 });
    expect(Object.keys(merged).sort()).toEqual(['align', 'rounded', 'size']);
    expect(merged.size).toBe(24);
  });

  it('值不合法的项回缺省，不牵连别的项', () => {
    expect(mergeOptions(SCHEMA, { align: 'right', rounded: 'yes', size: 99 })).toEqual({
      align: 'left',
      rounded: true,
      size: 24,
    });
    expect(mergeOptions(SCHEMA, { align: 'center', size: Number.NaN })).toEqual({
      align: 'center',
      rounded: true,
      size: 24,
    });
    // 范围的两端含在内
    expect(mergeOptions(SCHEMA, { size: 10 }).size).toBe(10);
    expect(mergeOptions(SCHEMA, { size: 40 }).size).toBe(40);
    expect(mergeOptions(SCHEMA, { size: 9.9 }).size).toBe(24);
  });

  it('存档整个不是对象时按没有存档', () => {
    for (const raw of [null, 'text', 3, true, ['align']]) {
      expect(mergeOptions(SCHEMA, raw)).toEqual({ align: 'left', rounded: true, size: 24 });
    }
  });

  it('结果的类型随声明推出', () => {
    const merged = mergeOptions(SCHEMA, undefined);
    expectTypeOf(merged.align).toEqualTypeOf<'left' | 'center'>();
    expectTypeOf(merged.rounded).toEqualTypeOf<boolean>();
    expectTypeOf(merged.size).toEqualTypeOf<number>();
  });
});

describe('parseStoredOptions', () => {
  it('只留认得且合法的项', () => {
    expect(parseStoredOptions(SCHEMA, { align: 'center', rounded: 1, other: true })).toEqual({
      align: 'center',
    });
  });
});

describe('withStoredOption', () => {
  it('改一项并保留别的项，原对象不动', () => {
    const before = { align: 'center' };
    const after = withStoredOption(SCHEMA, before, 'size', 30);
    expect(after).toEqual({ align: 'center', size: 30 });
    expect(before).toEqual({ align: 'center' });
  });

  it('没声明的键与不合法的值原样答回', () => {
    const before = { align: 'center' };
    expect(withStoredOption(SCHEMA, before, 'unknown', 1)).toBe(before);
    expect(withStoredOption(SCHEMA, before, 'size', 5)).toBe(before);
    expect(withStoredOption(SCHEMA, before, 'toString', true)).toBe(before);
  });
});

describe('resolvePresetId', () => {
  const known = ['split', 'cover'];

  it('登记表里还有就用存档的', () => {
    expect(resolvePresetId('cover', known, 'split')).toBe('cover');
  });

  it('没有存档、空串或预设已不存在时回到缺省预设', () => {
    expect(resolvePresetId(undefined, known, 'split')).toBe('split');
    expect(resolvePresetId('', known, 'split')).toBe('split');
    expect(resolvePresetId('removed', known, 'split')).toBe('split');
  });
});
