import { describe, expect, it } from 'vitest';
import { localeName } from '../../../src/settings/localeName.ts';

describe('localeName', () => {
  it('用这门语言自己的写法', () => {
    expect(localeName('en')).toBe('English');
    expect(localeName('zh-CN')).toBe('中文（中国）');
    expect(localeName('ja')).toBe('日本語');
  });

  it('标签不合法时退回标签本身', () => {
    expect(localeName('not a tag')).toBe('not a tag');
    expect(localeName('')).toBe('');
  });
});
