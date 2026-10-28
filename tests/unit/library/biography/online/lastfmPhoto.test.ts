import { describe, expect, it } from 'vitest';
import {
  lastfmPhotoId,
  readLastfmPhotoValue,
} from '../../../../../src/library/biography/online/lastfmPhoto.ts';
import { readBiographyCacheEntry } from '../../../../../src/library/biography/biographyCacheFormat.ts';
import { biographyDocument } from '../../../../fixtures/biographySamples.ts';
import { TAISHI_PHOTO, TAISHI_PHOTO_ID } from '../../../../fixtures/biographyPhotoSamples.ts';

describe('Last.fm 图片身份', () => {
  it.each([
    `avatar170s/${TAISHI_PHOTO_ID}`,
    `avatar300s/${TAISHI_PHOTO_ID}.webp`,
    `300x300/${TAISHI_PHOTO_ID}`,
    `770x0/${TAISHI_PHOTO_ID}.jpg`,
    `ar0/${TAISHI_PHOTO_ID}.png`,
  ])('缩略图与大图使用同一图片标识：%s', (path) => {
    expect(lastfmPhotoId(`https://lastfm-img.freetls.fastly.net/i/u/${path}`)).toBe(
      TAISHI_PHOTO_ID,
    );
  });

  it.each([
    `http://lastfm-img.freetls.fastly.net/i/u/avatar170s/${TAISHI_PHOTO_ID}`,
    `https://lastfm-img.freetls.fastly.net.evil.test/i/u/avatar170s/${TAISHI_PHOTO_ID}`,
    `https://lastfm-img.freetls.fastly.net/i/u/avatar170s/${TAISHI_PHOTO_ID}?image=other`,
    `https://lastfm-img.freetls.fastly.net/i/u/avatar170s/${TAISHI_PHOTO_ID}.svg`,
    `https://lastfm-img.freetls.fastly.net/i/u/avatar170s/${TAISHI_PHOTO_ID}/other`,
    'https://lastfm-img.freetls.fastly.net/i/u/avatar170s/2a96cbd8b46e442fc41c2b86b821562f',
  ])('新缩略图仍拒绝不可信地址与默认占位：%s', (url) => {
    expect(lastfmPhotoId(url)).toBeNull();
  });

  it('只接受固定 HTTPS CDN 与同一艺人同一图片的来源页', () => {
    expect(readLastfmPhotoValue(TAISHI_PHOTO, 'Taishi', 'zh')).toEqual(TAISHI_PHOTO);
    for (const photo of [
      { ...TAISHI_PHOTO, url: TAISHI_PHOTO.url.replace('https:', 'http:') },
      { ...TAISHI_PHOTO, url: TAISHI_PHOTO.url.replace('.net', '.net.evil.test') },
      { ...TAISHI_PHOTO, url: `${TAISHI_PHOTO.url}?redirect=evil` },
      { ...TAISHI_PHOTO, url: TAISHI_PHOTO.url.replace('https://', 'https://user@') },
      {
        ...TAISHI_PHOTO,
        url: TAISHI_PHOTO.url.replace(TAISHI_PHOTO_ID, '2a96cbd8b46e442fc41c2b86b821562f'),
      },
      { ...TAISHI_PHOTO, pageUrl: TAISHI_PHOTO.pageUrl.replace('Taishi', 'Other') },
      { ...TAISHI_PHOTO, pageUrl: 'javascript:alert(1)' },
    ])
      expect(readLastfmPhotoValue(photo, 'Taishi', 'zh')).toBeNull();
  });

  it('缓存读回保留合法主图，丢弃伪造地址而不丢正文，兼容没有图片字段的旧缓存', () => {
    const entry = {
      artist: 'Taishi',
      language: 'zh',
      fetchedAt: 100,
      expiresAt: 1000,
      document: biographyDocument('Taishi'),
    };
    const read = (photo?: unknown) =>
      readBiographyCacheEntry({ ...entry, document: { ...entry.document, photo } }, 200)?.document;
    expect(read(TAISHI_PHOTO)?.photo).toEqual(TAISHI_PHOTO);
    expect(read({ ...TAISHI_PHOTO, url: 'https://evil.test/photo.jpg' })?.photo).toBeNull();
    expect(read()).toEqual(entry.document);
  });
});
