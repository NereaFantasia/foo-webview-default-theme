import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import {
  BUILTIN_MESSAGES,
  createTranslate,
  resolveBuiltin,
  sanitizeMessages,
} from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';

describe('resolveBuiltin', () => {
  it('zh 开头的走简体中文，其余一律英文', () => {
    expect(resolveBuiltin('zh-CN')).toBe('zh-CN');
    expect(resolveBuiltin('zh-TW')).toBe('zh-CN');
    expect(resolveBuiltin('ZH-hans-cn')).toBe('zh-CN');
    expect(resolveBuiltin('en-US')).toBe('en');
    expect(resolveBuiltin('ja-JP')).toBe('en');
    expect(resolveBuiltin('')).toBe('en');
  });
});

describe('createTranslate', () => {
  it('覆盖层有的键用覆盖层，缺的回落基准包', () => {
    const t = createTranslate(en, { 'host.unavailable': 'Pas connecté' });
    expect(t('host.unavailable')).toBe('Pas connecté');
    expect(t('host.readFailed')).toBe(en['host.readFailed']);
  });

  it('按参数替换占位，没给的占位原样留着', () => {
    const t = createTranslate(en, {});
    expect(t('nav.backTo', { name: 'Albums' })).toBe('Back to Albums');
    expect(t('nav.backTo', { other: 1 })).toBe('Back to {name}');
    expect(t('nav.backTo')).toBe('Back to {name}');
  });
});

describe('sanitizeMessages', () => {
  it('只留已知的键且值是字符串的条目', () => {
    const input = { 'host.unavailable': '接続なし', 'host.readFailed': 42, 'no.such.key': 'x' };
    expect(sanitizeMessages(input)).toEqual({ 'host.unavailable': '接続なし' });
  });

  it('不是对象的输入给空包', () => {
    expect(sanitizeMessages(null)).toEqual({});
    expect(sanitizeMessages('host.unavailable')).toEqual({});
    expect(sanitizeMessages(['host.unavailable'])).toEqual({});
  });
});

describe('内置包', () => {
  it('中文包与英文包的键完全一致', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    expect(BUILTIN_MESSAGES['zh-CN']).toBe(zhCN);
  });
});
