import { describe, expect, it } from 'vitest';
import type { ApplePhoto } from '../../../../../src/library/biography/biographyModel.ts';
import {
  appleHeroOf,
  applePhotoUrl,
  fetchApplePhoto,
} from '../../../../../src/library/biography/online/fetchApplePhoto.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const PHOTO: ApplePhoto = {
  source: 'apple',
  url: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/queen',
  pageUrl: 'https://music.apple.com/cn/artist/queen/3296287',
};

describe('Apple 艺术照下载', () => {
  it('基础地址拼上 600 见方的 jpg 再取，经 SDK 收二进制且不跟随重定向', async () => {
    const host = installFakeHost();
    host.answer('http.get', {
      success: true,
      status: 200,
      body: 'AQIDBA==',
      responseType: 'base64',
      headers: { 'Content-Type': 'image/jpeg' },
    });
    const result = await fetchApplePhoto(PHOTO, host.fb);
    expect(result).toMatchObject({ ok: true });
    if (result.ok)
      expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(host.callsTo('http.get')[0]).toMatchObject({
      url: `${PHOTO.url}/600x600bb.jpg`,
      redirect: 'error',
      responseType: 'arraybuffer',
    });
  });

  it('基础地址不是 mzstatic.com 的图片、或已带了尺寸，不发请求', async () => {
    const host = installFakeHost();
    for (const url of [
      'https://evil.test/image/thumb/Music/v4/aa/queen',
      'http://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/queen',
      `${PHOTO.url}/600x600bb.jpg`,
    ])
      expect(await fetchApplePhoto({ ...PHOTO, url }, host.fb)).toMatchObject({
        ok: false,
        problem: 'invalid',
      });
    expect(host.callsTo('http.get')).toHaveLength(0);
  });

  it('宽幅图：基础地址拼 1600×900 与页面给的裁切码，取图用的就是这个地址；没有宽幅图时没有这一张', async () => {
    const hero = appleHeroOf({ ...PHOTO, wide: { url: PHOTO.url, crop: 'vf' } });
    expect(hero).toMatchObject({
      source: 'apple',
      url: PHOTO.url,
      pageUrl: PHOTO.pageUrl,
      request: { width: 1600, height: 900, crop: 'vf' },
    });
    expect(appleHeroOf(PHOTO)).toBeNull();
    expect(applePhotoUrl(PHOTO)).toBe(`${PHOTO.url}/600x600bb.jpg`);
    if (!hero) return;
    expect(applePhotoUrl(hero)).toBe(`${PHOTO.url}/1600x900vf.jpg`);
    const host = installFakeHost();
    host.answer('http.get', {
      success: true,
      status: 200,
      body: 'AQIDBA==',
      responseType: 'base64',
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(await fetchApplePhoto(hero, host.fb)).toMatchObject({ ok: true });
    expect(host.callsTo('http.get')[0]).toMatchObject({ url: `${PHOTO.url}/1600x900vf.jpg` });
  });

  it('宽幅动态艺术照的静帧取 1280×720，图片服务现场渲染较慢，超时放宽到 30 秒；宽幅艺术图仍是 1600×900', async () => {
    const still = appleHeroOf({ ...PHOTO, wide: { url: PHOTO.url, crop: 'bb' } });
    expect(still?.request).toEqual({ width: 1280, height: 720, crop: 'bb' });
    if (!still) return;
    const host = installFakeHost();
    host.answer('http.get', {
      success: true,
      status: 200,
      body: 'AQIDBA==',
      responseType: 'base64',
      headers: { 'Content-Type': 'image/jpeg' },
    });
    await fetchApplePhoto(still, host.fb);
    expect(host.callsTo('http.get')[0]).toMatchObject({
      url: `${PHOTO.url}/1280x720bb.jpg`,
      timeout: 30_000,
    });
  });

  it('图不存在不冒充成功', async () => {
    const host = installFakeHost();
    host.answer('http.get', {
      success: true,
      status: 404,
      headers: {},
      body: '',
      responseType: 'base64',
    });
    expect(await fetchApplePhoto(PHOTO, host.fb)).toMatchObject({
      ok: false,
      problem: 'photoMissing',
    });
  });
});
