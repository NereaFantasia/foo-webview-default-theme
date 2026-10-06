import { describe, expect, it } from 'vitest';
import {
  BIOGRAPHY_PHOTO_BYTES,
  fetchLastfmPhoto,
} from '../../../../../src/library/biography/online/fetchLastfmPhoto.ts';
import { TAISHI_PHOTO } from '../../../../fixtures/biographyPhotoSamples.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

describe('Last.fm 主图下载', () => {
  it('只经 SDK 收二进制，不跟随重定向，保留图片缓存策略', async () => {
    const host = installFakeHost();
    host.answer('http.get', {
      success: true,
      status: 200,
      body: 'AQIDBA==',
      responseType: 'base64',
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
    });
    const result = await fetchLastfmPhoto(TAISHI_PHOTO, host.fb);
    expect(result).toMatchObject({ ok: true, store: false });
    if (result.ok) {
      expect(result.blob.type).toBe('image/jpeg');
      expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    }
    expect(host.callsTo('http.get')[0]).toMatchObject({
      url: TAISHI_PHOTO.url,
      redirect: 'error',
      timeout: 12000,
      responseType: 'arraybuffer',
    });
    expect(
      await fetchLastfmPhoto({ ...TAISHI_PHOTO, url: 'https://evil.test/image.jpg' }, host.fb),
    ).toMatchObject({ ok: false, problem: 'invalid' });
    expect(host.callsTo('http.get')).toHaveLength(1);
  });

  it.each([
    [403, 'blocked'],
    [404, 'photoMissing'],
    [429, 'rateLimited'],
    [503, 'network'],
  ] as const)('HTTP %s 不冒充成功或空图，并遵守 Retry-After', async (status, problem) => {
    const host = installFakeHost();
    host.answer('http.get', {
      success: true,
      status,
      headers: { 'Retry-After': '7200' },
      body: '',
      responseType: 'base64',
    });
    const now = Date.now();
    const result = await fetchLastfmPhoto(TAISHI_PHOTO, host.fb);
    expect(result).toMatchObject({ ok: false, problem });
    if (!result.ok) expect(result.retryAt).toBeGreaterThanOrEqual(now + 7200000);
  });

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])(
    '不显示 %s 响应',
    async (type) => {
      const host = installFakeHost();
      host.answer('http.get', {
        success: true,
        status: 200,
        headers: { 'Content-Type': type },
        body: 'AQIDBA==',
        responseType: 'base64',
      });
      expect(await fetchLastfmPhoto(TAISHI_PHOTO, host.fb)).toMatchObject({
        ok: false,
        problem: 'invalid',
      });
    },
  );

  it('拒绝空体和超过 4 MiB 的图片体', async () => {
    const host = installFakeHost();
    for (const body of ['', Buffer.alloc(BIOGRAPHY_PHOTO_BYTES + 1).toString('base64')]) {
      host.answer('http.get', {
        success: true,
        status: 200,
        headers: { 'Content-Type': 'image/png' },
        body,
        responseType: 'base64',
      });
      expect(await fetchLastfmPhoto(TAISHI_PHOTO, host.fb)).toMatchObject({
        ok: false,
        problem: 'invalid',
      });
    }
  });
});
