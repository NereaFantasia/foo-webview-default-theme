// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fetchLastfmGallery } from '../../../../../src/library/biography/online/lastfmGallery.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const ARTIST_ID = 'a'.repeat(32);
const found = (status: number, headers: Record<string, string>, body: string) => ({
  success: true as const,
  status,
  headers,
  body,
  responseType: 'text' as const,
});
const galleryPage = (artistPath: string) => `
  <link rel="canonical" href="https://www.last.fm${artistPath}/+images">
  <a href="${artistPath}/+images/${ARTIST_ID}">
    <img src="https://lastfm-img.freetls.fastly.net/i/u/avatar170s/${ARTIST_ID}">
  </a>
`;

const SIMPLIFIED = 'https://www.last.fm/music/%E5%91%A8%E6%9D%B0%E4%BC%A6';
const CANONICAL = 'https://www.last.fm/music/%E5%91%A8%E6%9D%B0%E5%80%AB';

describe('Last.fm 相册读取', () => {
  it('正常页解析一张照片并带上规范来源链接', async () => {
    const host = installFakeHost();
    host.answer('http.get', found(200, {}, galleryPage('/music/%E5%91%A8%E6%9D%B0%E5%80%AB')));
    const result = await fetchLastfmGallery(CANONICAL, host.fb);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.photos).toEqual([
      {
        url: `https://lastfm-img.freetls.fastly.net/i/u/770x0/${ARTIST_ID}.jpg`,
        pageUrl: `${CANONICAL}/+images/${ARTIST_ID}`,
      },
    ]);
  });

  it('名字规范化跳转后按终跳地址解析与构建照片链接', async () => {
    const host = installFakeHost();
    host.answer('http.get', (params) =>
      String(params['url']).includes('%E4%BC%A6')
        ? found(301, { Location: '/music/%E5%91%A8%E6%9D%B0%E5%80%AB/+images' }, '')
        : found(200, {}, galleryPage('/music/%E5%91%A8%E6%9D%B0%E5%80%AB')),
    );
    const result = await fetchLastfmGallery(SIMPLIFIED, host.fb);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.photos[0]?.pageUrl).toBe(`${SIMPLIFIED}/+images/${ARTIST_ID}`);
  });

  it('别名写法的艺人页跟跳后 canonical 对不上才算无法解析', async () => {
    const host = installFakeHost();
    host.answer('http.get', found(200, {}, galleryPage('/music/SomeoneElse')));
    await expect(fetchLastfmGallery(CANONICAL, host.fb)).resolves.toMatchObject({
      ok: false,
      problem: 'invalid',
    });
  });
});
