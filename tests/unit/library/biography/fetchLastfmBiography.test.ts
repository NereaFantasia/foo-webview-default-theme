import { describe, expect, it, vi } from 'vitest';
import { fetchLastfmBiography } from '../../../../src/library/biography/fetchLastfmBiography.ts';
import { parseBiographySample } from '../../../fixtures/biographyHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const found = (status: number, headers: Record<string, string>, body: string) => ({
  success: true as const,
  status,
  headers,
  body,
  responseType: 'text' as const,
});

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

  it('解析到本机地址被宿主拦下时归 localRelay，DNS 未解析归 dns，原文随 detail 带出', async () => {
    const host = installFakeHost();
    host.answer(
      'http.get',
      hostFailure('PERMISSION_DENIED', 'Target host resolves to a private/local network address'),
    );
    await expect(
      fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample),
    ).resolves.toMatchObject({
      ok: false,
      problem: 'localRelay',
      detail: 'Target host resolves to a private/local network address',
    });
    host.answer('http.get', hostFailure('OPERATION_FAILED', 'Send failed: DNS name not resolved'));
    await expect(
      fetchLastfmBiography('Queen', 'zh', host.fb, parseBiographySample),
    ).resolves.toMatchObject({
      ok: false,
      problem: 'dns',
      detail: 'Send failed: DNS name not resolved',
    });
    host.answer(
      'http.get',
      hostFailure('OPERATION_FAILED', 'Receive failed: Connection error (reset or aborted)'),
    );
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

  it('名字规范化跳转后解析校验用终跳名，正文归属与缓存键保持请求名', async () => {
    const host = installFakeHost();
    host.answer('http.get', (params) =>
      String(params['url']).includes('%E4%BC%A6')
        ? found(301, { Location: '/zh/music/%E5%91%A8%E6%9D%B0%E5%80%AB/+wiki' }, '')
        : found(200, {}, '繁体正文'),
    );
    let seenPage = '';
    const result = await fetchLastfmBiography(
      '周杰伦',
      'zh',
      host.fb,
      (body, artist, language, pageArtist) => {
        seenPage = pageArtist ?? '';
        return parseBiographySample(body, artist, language);
      },
    );
    expect(seenPage).toBe('周杰倫');
    expect(result).toMatchObject({
      ok: true,
      entry: { artist: '周杰伦', document: { artist: '周杰伦', paragraphs: ['繁体正文'] } },
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
