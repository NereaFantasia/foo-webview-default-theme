import { describe, expect, it } from 'vitest';
import {
  readBiographyDetails,
  readBiographyFacts,
} from '../../../../../src/library/biography/details/biographyDetailsModel.ts';
import { readBiographyCacheEntry } from '../../../../../src/library/biography/biographyCacheFormat.ts';
import { lastfmArtistUrl } from '../../../../../src/library/biography/biographyModel.ts';
import { biographyDocument } from '../../../../fixtures/biographySamples.ts';

const NOW = 1_800_000_000_000;
const DETAILS = {
  artist: 'Queen',
  language: 'zh',
  url: lastfmArtistUrl('Queen', 'zh'),
  fetchedAt: NOW - 100,
  expiresAt: NOW + 1000,
  tags: ['rock'],
  counters: [{ label: '听众', value: 1234567 }],
  similar: [{ artist: 'The Beatles', url: lastfmArtistUrl('The Beatles', 'zh') }],
};

describe('简介附加资料缓存', () => {
  it('身份、语言、来源和时间都必须吻合，正文旧缓存仍可读', () => {
    expect(readBiographyDetails(DETAILS, 'Queen', 'zh', NOW)).toEqual(DETAILS);
    for (const bad of [
      { ...DETAILS, artist: 'Other' },
      { ...DETAILS, language: 'en' },
      { ...DETAILS, url: 'https://evil.test' },
      { ...DETAILS, expiresAt: NOW - 1000 },
      { ...DETAILS, fetchedAt: NOW + 1 },
      { ...DETAILS, tags: null },
    ])
      expect(readBiographyDetails(bad, 'Queen', 'zh', NOW)).toBeUndefined();
    const entry = {
      artist: 'Queen',
      language: 'zh',
      fetchedAt: NOW - 100,
      expiresAt: NOW + 1000,
      document: biographyDocument(),
    };
    expect(readBiographyCacheEntry(entry, NOW)).toEqual(entry);
    expect(readBiographyCacheEntry({ ...entry, details: DETAILS }, NOW)?.details).toEqual(DETAILS);
    expect(
      readBiographyCacheEntry(
        { ...entry, details: { ...DETAILS, url: 'javascript:alert(1)' } },
        NOW,
      )?.document,
    ).toEqual(entry.document);
  });

  it('不可信条目按字段丢弃，危险相似链接和非整数计数不进入显示', () => {
    expect(
      readBiographyDetails(
        {
          ...DETAILS,
          tags: ['rock', 'rock', 1, '', 'x'.repeat(81)],
          counters: [
            { label: 'Count', value: -1 },
            { label: 'Count', value: 1.2 },
          ],
          similar: [
            { artist: 'Other', url: 'javascript:alert(1)' },
            { artist: 'Queen', url: DETAILS.url },
          ],
        },
        'Queen',
        'zh',
        NOW,
      ),
    ).toMatchObject({ tags: ['rock'], counters: [], similar: [] });
    expect(
      readBiographyFacts([
        { label: '成立', value: '1970' },
        { label: 'x', value: '<p>纯文本</p>' },
        { label: '', value: 'x' },
        { label: 'x', value: '\u0000' },
        { label: 'x', value: 'x'.repeat(513) },
      ]),
    ).toEqual([
      { label: '成立', value: '1970' },
      { label: 'x', value: '<p>纯文本</p>' },
    ]);
  });
});
