import { describe, expect, it } from 'vitest';
import { fetchLastfmDetails } from '../../../../../src/library/biography/details/fetchLastfmDetails.ts';
import type { readLastfmDetails } from '../../../../../src/library/biography/details/lastfmDetails.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const PARSE: typeof readLastfmDetails = (body) =>
  body === 'invalid'
    ? { kind: 'invalid' }
    : { kind: 'found', details: { tags: [body], counters: [], similar: [] } };

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
