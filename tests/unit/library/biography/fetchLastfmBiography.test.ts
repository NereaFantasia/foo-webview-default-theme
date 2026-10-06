import { describe, expect, it, vi } from 'vitest';
import { fetchLastfmBiography } from '../../../../src/library/biography/fetchLastfmBiography.ts';
import { parseBiographySample } from '../../../fixtures/biographyHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

describe('Last.fm 请求', () => {
  it.each([403, 429, 503])('HTTP %s 不是没有简介', async (status) => {
    const host = installFakeHost();
    host.answer('http.get', { success: true, status, body: 'challenge', headers: {} });
    const result = await fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample);
    expect(result).toMatchObject({
      ok: false,
      problem: status === 403 ? 'blocked' : status === 429 ? 'rateLimited' : 'network',
    });
  });

  it('SDK 高层助手的 reject 被收成网络错误', async () => {
    const host = installFakeHost();
    host.answer('http.get', hostFailure('OPERATION_FAILED'));
    await expect(
      fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample),
    ).resolves.toMatchObject({ ok: false, problem: 'network' });
  });

  it('默认异步回执等待 http:response，事件结果进入正文', async () => {
    const host = installFakeHost();
    host.answer('http.get', { success: true, async: true, requestId: 'bio-request' });
    const pending = fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample);
    await vi.waitFor(() => expect(host.listenerCount('http:response')).toBeGreaterThan(0));
    host.emit('http:response', {
      requestId: 'bio-request',
      success: true,
      status: 200,
      body: '事件正文',
      headers: {},
    });
    expect(await pending).toMatchObject({
      ok: true,
      entry: { document: { paragraphs: ['事件正文'] } },
    });
  });

  it('404 可作为没有简介，200 的未知页面不能成为空正文', async () => {
    const host = installFakeHost();
    host.answer('http.get', { success: true, status: 404, body: '', headers: {} });
    expect(await fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample)).toMatchObject({
      ok: true,
      entry: { document: null },
    });
    host.answer('http.get', { success: true, status: 200, body: 'invalid', headers: {} });
    expect(await fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample)).toMatchObject({
      ok: false,
      problem: 'invalid',
    });
  });
});
