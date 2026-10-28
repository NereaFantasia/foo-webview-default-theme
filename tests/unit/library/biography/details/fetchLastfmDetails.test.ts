import { describe, expect, it } from 'vitest';
import { fetchLastfmDetails } from '../../../../../src/library/biography/details/fetchLastfmDetails.ts';
import type { readLastfmDetails } from '../../../../../src/library/biography/details/lastfmDetails.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const PARSE: typeof readLastfmDetails = (body) =>
  body === 'invalid'
    ? { kind: 'invalid' }
    : { kind: 'found', details: { tags: [body], counters: [], similar: [] } };

const found = (status: number, headers: Record<string, string>, body: string) => ({
  success: true as const,
  status,
  headers,
  body,
  responseType: 'text' as const,
});

describe('Last.fm 主页请求', () => {
  it.each([403, 429, 503])('HTTP %s 保留错误类型和 Retry-After', async (status) => {
    const host = installFakeHost();
    const before = Date.now();
    host.answer('http.get', {
      success: true,
      status,
      body: '',
      headers: { 'Retry-After': '1800' },
    });
    const result = await fetchLastfmDetails('Queen', 'en', host.fb, PARSE);
    expect(result).toMatchObject({
      ok: false,
      problem: status === 403 ? 'blocked' : status === 429 ? 'rateLimited' : 'network',
    });
    if (!result.ok) expect(result.retryAt).toBeGreaterThanOrEqual(before + 1_800_000);
  });

  it('拒绝或解析异常不会逃出服务，验证页不能缓存成空资料', async () => {
    const host = installFakeHost();
    host.answer('http.get', hostFailure('OPERATION_FAILED'));
    await expect(fetchLastfmDetails('Queen', 'en', host.fb, PARSE)).resolves.toMatchObject({
      ok: false,
      problem: 'network',
    });
    host.answer('http.get', hostFailure('OPERATION_FAILED', 'Send failed: DNS name not resolved'));
    await expect(fetchLastfmDetails('Queen', 'en', host.fb, PARSE)).resolves.toMatchObject({
      ok: false,
      problem: 'dns',
      detail: 'Send failed: DNS name not resolved',
    });
    host.answer('http.get', { success: true, status: 200, body: 'invalid', headers: {} });
    await expect(fetchLastfmDetails('Queen', 'en', host.fb, PARSE)).resolves.toMatchObject({
      ok: false,
      problem: 'invalid',
    });
    await expect(
      fetchLastfmDetails('Queen', 'en', host.fb, () => {
        throw new Error('parse');
      }),
    ).resolves.toMatchObject({ ok: false, problem: 'invalid' });
  });

  it('名字规范化跳转后解析校验用终跳名，归属名与链接保持请求名', async () => {
    const host = installFakeHost();
    host.answer('http.get', (params) =>
      String(params['url']).includes('%E4%BC%A6')
        ? found(301, { Location: '/zh/music/%E5%91%A8%E6%9D%B0%E5%80%AB' }, '')
        : found(200, {}, '繁体资料'),
    );
    let seenPage = '';
    const result = await fetchLastfmDetails(
      '周杰伦',
      'zh',
      host.fb,
      (body, artist, language, pageArtist) => {
        seenPage = pageArtist ?? '';
        return PARSE(body, artist, language);
      },
    );
    expect(seenPage).toBe('周杰倫');
    expect(result).toMatchObject({
      ok: true,
      details: {
        artist: '周杰伦',
        url: 'https://www.last.fm/zh/music/%E5%91%A8%E6%9D%B0%E4%BC%A6',
      },
    });
  });

  it('404 缓存空资料，Age 和 no-cache 决定附加资料自己的有效期', async () => {
    const host = installFakeHost();
    host.answer('http.get', { success: true, status: 404, body: '', headers: {} });
    expect(await fetchLastfmDetails('Queen', 'en', host.fb, PARSE)).toMatchObject({
      ok: true,
      store: true,
      details: { tags: [], counters: [], similar: [] },
    });
    for (const policy of ['max-age=60', 'no-cache', 'no-store']) {
      host.answer('http.get', {
        success: true,
        status: 200,
        body: 'rock',
        headers: { 'Cache-Control': policy, Age: '10' },
      });
      const result = await fetchLastfmDetails('Queen', 'en', host.fb, PARSE);
      expect(result).toMatchObject({
        ok: true,
        store: policy !== 'no-store',
        details: { tags: ['rock'] },
      });
      if (result.ok)
        expect(result.details.expiresAt - result.details.fetchedAt).toBe(
          policy === 'max-age=60' ? 50_000 : 0,
        );
    }
  });
});
