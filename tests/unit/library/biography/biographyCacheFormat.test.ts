import { describe, expect, it } from 'vitest';
import {
  biographyFreshness,
  biographyRetryAt,
  readBiographyCacheEntry,
} from '../../../../src/library/biography/biographyCacheFormat.ts';
import { BIOGRAPHY_DEFAULT_TTL } from '../../../../src/library/biography/biographyModel.ts';
import { biographyDocument } from '../../../fixtures/biographySamples.ts';

const NOW = 1_800_000_000_000;
const ENTRY = {
  artist: 'Queen',
  language: 'zh',
  fetchedAt: NOW - 1000,
  expiresAt: NOW + 1000,
  document: biographyDocument(),
};

describe('简介缓存格式', () => {
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
