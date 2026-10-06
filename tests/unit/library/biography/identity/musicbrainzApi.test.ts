import { describe, expect, it } from 'vitest';
import {
  createMusicbrainzClient,
  MUSICBRAINZ_INTERVAL_MS,
} from '../../../../../src/library/biography/identity/musicbrainzApi.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

function reply(status: number, body: string, headers: Record<string, string> = {}) {
  return { success: true as const, status, headers, body, responseType: 'text' as const };
}

function clock() {
  let time = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => time,
    wait: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    waits,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('MusicBrainz 请求', () => {
  it('经 SDK 发 GET，带 fmt=json 与写明联系方式的 UA，不跟随重定向', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{"artists":[]}'));
    const time = clock();
    const client = createMusicbrainzClient(host.fb, time.now, time.wait);
    expect(await client.request('artist', { query: 'artist:"A"', limit: '10' })).toEqual({
      kind: 'data',
      data: { artists: [] },
    });
    const call = host.callsTo('http.get')[0];
    expect(call).toMatchObject({ redirect: 'error', timeout: 15000 });
    expect(String(Reflect.get(Object(call?.['headers']), 'User-Agent'))).toMatch(
      /^foo-webview-default-theme\/\S+ \( https:\/\/\S+ \)$/,
    );
    const url = new URL(String(call?.['url']));
    expect(url.origin + url.pathname).toBe('https://musicbrainz.org/ws/2/artist');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'artist:"A"',
      limit: '10',
      fmt: 'json',
    });
  });

  it('所有请求排成一列，相邻两次开始至少隔 1.1 秒；轮到时调用方已放弃就不发', async () => {
    const host = installFakeHost();
    host.answer('http.get', reply(200, '{}'));
    const time = clock();
    const client = createMusicbrainzClient(host.fb, time.now, time.wait);
    const results = await Promise.all([
      client.request('artist/a', {}),
      client.request('artist/b', {}, () => false),
      client.request('artist/c', {}),
    ]);
    expect(results.map((item) => item.kind)).toEqual(['data', 'failed', 'data']);
    expect(host.callsTo('http.get')).toHaveLength(2);
    expect(time.waits).toEqual([MUSICBRAINZ_INTERVAL_MS]);
    time.advance(5000);
    await client.request('artist/d', {});
    expect(time.waits).toHaveLength(1);
  });

  it('404 是查无此人，503/429 限流并遵守 Retry-After，403 拒绝，400 与坏 JSON 算解析失败', async () => {
    const cases = [
      [reply(404, '{}'), { kind: 'missing' }],
      [reply(503, '', { 'Retry-After': '30' }), { kind: 'failed', problem: 'rateLimited' }],
      [reply(429, ''), { kind: 'failed', problem: 'rateLimited' }],
      [reply(403, ''), { kind: 'failed', problem: 'blocked' }],
      [reply(400, '{}'), { kind: 'failed', problem: 'invalid' }],
      [reply(200, '<html>'), { kind: 'failed', problem: 'invalid' }],
      [reply(502, ''), { kind: 'failed', problem: 'network' }],
      [hostFailure('OPERATION_FAILED'), { kind: 'failed', problem: 'network' }],
    ] as const;
    for (const [answer, expected] of cases) {
      const host = installFakeHost();
      host.answer('http.get', answer);
      const time = clock();
      const before = Date.now();
      const result = await createMusicbrainzClient(host.fb, time.now, time.wait).request('x', {});
      expect(result).toMatchObject(expected);
      if (answer.success && answer.status === 503 && result.kind === 'failed')
        expect(result.retryAt).toBeGreaterThanOrEqual(before + 30_000);
    }
  });
});
