import { describe, expect, it } from 'vitest';
import { requestLastfmApi } from '../../../../../src/library/biography/lastfm-api/lastfmApi.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const KEY = '0123456789abcdef0123456789abcdef';

function reply(status: number, body: string, headers: Record<string, string> = {}) {
  return { success: true as const, status, headers, body, responseType: 'text' as const };
}

describe('Last.fm API 请求', () => {
  it('只经 SDK 发只读请求，参数带 key 与 JSON 格式，不跟随重定向', async () => {
    const host = installFakeHost();
    host.answer(
      'http.get',
      reply(200, JSON.stringify({ artist: { name: 'Nujabes' } }), {
        'Cache-Control': 'max-age=3600',
      }),
    );
    const before = Date.now();
    const result = await requestLastfmApi(
      'artist.getInfo',
      { artist: 'Nujabes', lang: 'zh' },
      KEY,
      host.fb,
    );
    expect(result).toMatchObject({
      kind: 'data',
      store: true,
      data: { artist: { name: 'Nujabes' } },
    });
    if (result.kind === 'data') {
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    }
    const call = host.callsTo('http.get')[0];
    expect(call).toMatchObject({ redirect: 'error', timeout: 12000 });
    const url = new URL(String(call?.['url']));
    expect(url.origin + url.pathname).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      method: 'artist.getInfo',
      artist: 'Nujabes',
      lang: 'zh',
      api_key: KEY,
      format: 'json',
    });
  });

  it.each([
    [404, 6, 'missing'],
    [403, 10, 'keyInvalid'],
    [403, 26, 'keySuspended'],
    [429, 29, 'rateLimited'],
    [500, 8, 'network'],
    [503, 11, 'network'],
    [200, 16, 'network'],
    [400, 3, 'invalid'],
  ] as const)('HTTP %s 带错误码 %s 时按错误码归类为 %s', async (status, code, expected) => {
    const host = installFakeHost();
    host.answer('http.get', reply(status, JSON.stringify({ error: code, message: 'x' })));
    const result = await requestLastfmApi('artist.getInfo', { artist: 'A' }, KEY, host.fb);
    if (expected === 'missing') expect(result).toMatchObject({ kind: 'missing' });
    else expect(result).toMatchObject({ kind: 'failed', problem: expected });
  });

  it('没有错误码时按 HTTP 状态归类，读不出 JSON 不算成功，宿主失败算网络问题', async () => {
    const cases = [
      [reply(429, 'busy', { 'Retry-After': '120' }), 'rateLimited'],
      [reply(403, '<html>'), 'blocked'],
      [reply(502, ''), 'network'],
      [reply(200, '<html>not json</html>'), 'invalid'],
      [reply(200, '[1,2]'), 'invalid'],
      [hostFailure('OPERATION_FAILED'), 'network'],
    ] as const;
    for (const [answer, problem] of cases) {
      const host = installFakeHost();
      host.answer('http.get', answer);
      const before = Date.now();
      const result = await requestLastfmApi('artist.getInfo', { artist: 'A' }, KEY, host.fb);
      expect(result).toMatchObject({ kind: 'failed', problem });
      if (problem === 'rateLimited' && result.kind === 'failed')
        expect(result.retryAt).toBeGreaterThanOrEqual(before + 120_000);
    }
  });
});
