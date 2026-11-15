import { describe, expect, it } from 'vitest';
import {
  biographyFreshness,
  biographyRetryAt,
  readAppleCacheEntry,
  readBiographyCacheEntry,
} from '../../../../src/library/biography/biographyCacheFormat.ts';
import { BIOGRAPHY_DEFAULT_TTL } from '../../../../src/library/biography/biographyModel.ts';
import { biographyDocument } from '../../../fixtures/biographySamples.ts';

const NOW = 1_800_000_000_000;
const ENTRY = {
  source: 'lastfm',
  sourceId: 'Queen',
  artist: 'Queen',
  language: 'zh',
  fetchedAt: NOW - 1000,
  expiresAt: NOW + 1000,
  document: biographyDocument(),
};

const APPLE_URL = 'https://music.apple.com/cn/artist/queen/3296287';
const THUMB = 'https://is1-ssl.mzstatic.com/image/thumb/Features115/v4/92/mza_1.png';
const HLS = 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic221/v4/cd/P1_default.m3u8';
const APPLE_ENTRY = {
  source: 'apple',
  sourceId: '3296287',
  artist: 'Queen',
  language: 'en',
  fetchedAt: NOW - 1000,
  expiresAt: NOW + 1000,
  document: {
    source: 'apple',
    sourceId: '3296287',
    artist: 'Queen',
    language: 'en',
    textLanguage: 'en',
    paragraphs: ['Rock was merely a jumping-off point.'],
    url: APPLE_URL,
    attribution: { name: 'Apple Music', url: APPLE_URL },
    photo: { source: 'apple', url: THUMB, pageUrl: APPLE_URL },
    logo: { url: THUMB, width: 2930, height: 958 },
    motion: { square: { video: HLS, poster: THUMB } },
  },
  details: {
    source: 'apple',
    artist: 'Queen',
    language: 'en',
    url: APPLE_URL,
    fetchedAt: NOW - 1000,
    expiresAt: NOW + 1000,
    tags: ['Rock'],
    counters: [],
    similar: [],
  },
};

describe('Apple 来源的缓存项', () => {
  it('读回原样，署名按来源重建，不信文件里写的', () => {
    expect(readAppleCacheEntry(APPLE_ENTRY, NOW)).toEqual(APPLE_ENTRY);
    const forged = {
      ...APPLE_ENTRY,
      document: {
        ...APPLE_ENTRY.document,
        attribution: { name: 'Evil', url: 'https://evil.test/', license: { name: 'x', url: 'y' } },
      },
    };
    expect(readAppleCacheEntry(forged, NOW)?.document?.attribution).toEqual({
      name: 'Apple Music',
      url: APPLE_URL,
    });
  });

  it('早先缓存下来的简介带 <i> 标记时读回去掉标记，整段只剩标记的丢掉', () => {
    const read = readAppleCacheEntry(
      {
        ...APPLE_ENTRY,
        document: {
          ...APPLE_ENTRY.document,
          paragraphs: ['The album <i>Jazz</i> followed.', '<i></i>'],
        },
      },
      NOW,
    );
    expect(read?.document?.paragraphs).toEqual(['The album Jazz followed.']);
  });

  it('艺人 ID、页面地址、来源标记对不上的整项丢掉', () => {
    const insecure = APPLE_URL.replace('https', 'http');
    for (const value of [
      { ...APPLE_ENTRY, sourceId: 'abc' },
      { ...APPLE_ENTRY, sourceId: undefined },
      { ...APPLE_ENTRY, sourceId: '999' },
      { ...APPLE_ENTRY, source: 'lastfm' },
      { ...APPLE_ENTRY, artist: ' Queen ' },
      { ...APPLE_ENTRY, document: { ...APPLE_ENTRY.document, url: insecure } },
      { ...APPLE_ENTRY, document: { ...APPLE_ENTRY.document, artist: 'Other' } },
      { ...APPLE_ENTRY, document: { ...APPLE_ENTRY.document, paragraphs: [] } },
    ])
      expect(readAppleCacheEntry(value, NOW)).toBeNull();
  });

  it('图片和视频只认 Apple 的域名，不合格的只丢那一项，简介照读', () => {
    const read = readAppleCacheEntry(
      {
        ...APPLE_ENTRY,
        document: {
          ...APPLE_ENTRY.document,
          photo: { source: 'apple', url: 'https://evil.test/a.png', pageUrl: APPLE_URL },
          logo: { url: 'https://evil.test/a.png', width: 1, height: 1 },
          motion: { square: { video: 'https://evil.test/a.m3u8', poster: THUMB } },
        },
      },
      NOW,
    )?.document;
    expect(read?.paragraphs).toEqual(APPLE_ENTRY.document.paragraphs);
    expect(read?.photo).toBeNull();
    expect(read?.logo).toBeUndefined();
    expect(read?.motion).toBeUndefined();
  });

  it('Apple 的附加资料没有听众数与相似艺人，读回时一律为空', () => {
    const details = readAppleCacheEntry(
      {
        ...APPLE_ENTRY,
        details: {
          ...APPLE_ENTRY.details,
          counters: [{ label: 'x', value: 1 }],
          similar: [{ artist: 'Other', url: APPLE_URL }],
        },
      },
      NOW,
    )?.details;
    expect(details).toMatchObject({ source: 'apple', tags: ['Rock'], counters: [], similar: [] });
  });

  it('两个来源的读回函数互不收对方的项', () => {
    expect(readBiographyCacheEntry(APPLE_ENTRY, NOW)).toBeNull();
    expect(readAppleCacheEntry(ENTRY, NOW)).toBeNull();
  });
});

describe('简介缓存格式', () => {
  it('没有来源、身份与署名的旧项照读，署名由许可和地址推导', () => {
    const without = (value: object, ...keys: string[]) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
    const legacy = {
      ...without(ENTRY, 'source', 'sourceId'),
      document: without(ENTRY.document, 'source', 'sourceId', 'attribution'),
    };
    const read = readBiographyCacheEntry(legacy, NOW);
    expect(read).toEqual(ENTRY);
    expect(read?.document?.attribution.license?.name).toBe('CC BY-SA 3.0');
  });

  it('危险链接、错位身份和时间字段不会成为可信缓存', () => {
    expect(readBiographyCacheEntry(ENTRY, NOW)).toEqual(ENTRY);
    for (const value of [
      { ...ENTRY, fetchedAt: NOW + 1 },
      { ...ENTRY, expiresAt: NOW - 2000 },
      { ...ENTRY, document: { ...ENTRY.document, paragraphs: [1] } },
      { ...ENTRY, document: { ...ENTRY.document, url: 'javascript:alert(1)' } },
      { ...ENTRY, document: { ...ENTRY.document, artist: 'Other' } },
      { ...ENTRY, document: { ...ENTRY.document, licenseUrl: 'https://evil.test/' } },
      { ...ENTRY, document: { ...ENTRY.document, paragraphs: ['x'.repeat(64_001)] } },
    ])
      expect(readBiographyCacheEntry(value, NOW)).toBeNull();
  });

  it('明确没有正文可缓存，来源和语言仍必须完整', () => {
    expect(readBiographyCacheEntry({ ...ENTRY, document: null }, NOW)).toMatchObject({
      document: null,
      artist: 'Queen',
      language: 'zh',
    });
    expect(readBiographyCacheEntry({ ...ENTRY, language: 'xx' }, NOW)).toBeNull();
    const japanese = {
      ...ENTRY,
      language: 'ja',
      document: biographyDocument('Queen', 'ja', 'ロックバンド'),
    };
    expect(readBiographyCacheEntry(japanese, NOW)).toEqual(japanese);
    expect(readBiographyCacheEntry({ ...japanese, document: ENTRY.document }, NOW)).toBeNull();
  });

  it('尊重 no-store、no-cache、max-age 与 Age，缺省最多二十八天', () => {
    expect(biographyFreshness({}, NOW)).toEqual({
      store: true,
      expiresAt: NOW + BIOGRAPHY_DEFAULT_TTL,
    });
    expect(biographyFreshness({ 'Cache-Control': 'public, no-store' }, NOW)).toEqual({
      store: false,
      expiresAt: NOW,
    });
    expect(biographyFreshness({ 'cache-control': 'no-cache, max-age=100' }, NOW).expiresAt).toBe(
      NOW,
    );
    expect(biographyFreshness({ 'Cache-Control': 'max-age="100"', Age: '25' }, NOW).expiresAt).toBe(
      NOW + 75_000,
    );
    expect(biographyFreshness({ 'cache-control': 'max-age=0' }, NOW).expiresAt).toBe(NOW);
    expect(biographyFreshness({ 'cache-control': 'max-age=999999999' }, NOW).expiresAt).toBe(
      NOW + BIOGRAPHY_DEFAULT_TTL,
    );
  });

  it('服务端 Retry-After 无论秒数或日期都不被较短的本地退避覆盖', () => {
    expect(biographyRetryAt({ 'Retry-After': '600' }, NOW, 30_000)).toBe(NOW + 600_000);
    expect(
      biographyRetryAt({ 'retry-after': new Date(NOW + 120_000).toUTCString() }, NOW, 30_000),
    ).toBe(NOW + 120_000);
    expect(biographyRetryAt({}, NOW, 30_000)).toBe(NOW + 30_000);
  });
});
