import { describe, expect, it } from 'vitest';
import {
  lxSourceAddRequest,
  lxSourceCheckRequest,
  lxSourceIdRequest,
  lxSourceOrderRequest,
  lxSourceToggleRequest,
} from '../../music/musicRequests.ts';

const invalid = expect.objectContaining({ code: 'invalid-request' });

describe('音源管理的请求体', () => {
  it('导入：本地文件给文件名与脚本，网址只给 url', () => {
    expect(lxSourceAddRequest({ name: ' 星海.js ', script: 'code' })).toEqual({
      name: '星海.js',
      script: 'code',
    });
    expect(lxSourceAddRequest({ url: ' https://example.test/a.js ' })).toEqual({
      url: 'https://example.test/a.js',
    });
    for (const body of [
      { name: 'a.js' },
      { name: '', script: 'code' },
      { name: 'a.js', script: ' ' },
      { name: 'a.js', script: 'code', url: 'https://example.test/a.js' },
      { url: '' },
      { url: 'x'.repeat(2049) },
      null,
    ])
      expect(() => lxSourceAddRequest(body)).toThrow(invalid);
  });

  it('启用、删除与调整先后', () => {
    expect(lxSourceToggleRequest({ id: 'a.js', enabled: false })).toEqual({
      id: 'a.js',
      enabled: false,
    });
    expect(lxSourceIdRequest({ id: 'a.js' })).toBe('a.js');
    expect(lxSourceOrderRequest({ ids: ['b.js', 'a.js'] })).toEqual(['b.js', 'a.js']);
    for (const call of [
      () => lxSourceToggleRequest({ id: 'a.js' }),
      () => lxSourceToggleRequest({ id: '', enabled: true }),
      () => lxSourceIdRequest({ id: 'a.js', extra: 1 }),
      () => lxSourceOrderRequest({ ids: [] }),
      () => lxSourceOrderRequest({ ids: ['a.js', 'a.js'] }),
      () => lxSourceOrderRequest({ ids: ['a.js', 7] }),
    ])
      expect(call).toThrow(invalid);
  });

  it('检测：音源 ID 加平台，网易云不走音源脚本', () => {
    expect(lxSourceCheckRequest({ id: 'a.js', platform: 'kw' })).toEqual({
      id: 'a.js',
      platform: 'kw',
    });
    for (const call of [
      () => lxSourceCheckRequest({ id: 'a.js', platform: 'wy' }),
      () => lxSourceCheckRequest({ id: 'a.js', platform: 'xx' }),
      () => lxSourceCheckRequest({ id: '', platform: 'kw' }),
      () => lxSourceCheckRequest({ platform: 'kw' }),
      () => lxSourceCheckRequest({ id: 'a.js', platform: 'kw', extra: 1 }),
    ])
      expect(call).toThrow(invalid);
  });
});
