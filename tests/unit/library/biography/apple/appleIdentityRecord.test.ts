import { describe, expect, it } from 'vitest';
import {
  appleIdentityStateOf,
  appleManualStateOf,
  readAppleIdentityRecord,
} from '../../../../../src/library/biography/apple/appleIdentityRecord.ts';
import {
  IDENTITY_OPEN_TTL,
  IDENTITY_RESOLVED_TTL,
} from '../../../../../src/library/biography/identity/identityRecord.ts';

const NOW = 1_800_000_000_000;
const URL_1 = 'https://music.apple.com/cn/artist/nirvana/112018';
const CANDIDATE = {
  id: '112018',
  name: 'Nirvana',
  genre: '另类音乐',
  url: URL_1,
  nameMatch: true,
  overlap: 1,
  reliable: 1,
  matched: ['Nevermind'],
  albumCount: 21,
  years: [1989, 2021],
  samples: ['Nevermind', 'Bleach'],
};
const TIMES = { artist: 'Nirvana', fetchedAt: NOW - 1000, expiresAt: NOW + 1000 };
const RESOLVED = {
  ...TIMES,
  status: 'resolved',
  sourceId: '112018',
  sourceArtist: 'Nirvana',
  url: URL_1,
  candidates: [CANDIDATE],
};

describe('Apple 身份缓存项', () => {
  it('三种状态都能读回原样', () => {
    expect(readAppleIdentityRecord(RESOLVED, NOW)).toEqual(RESOLVED);
    const ambiguous = { ...TIMES, status: 'ambiguous', candidates: [CANDIDATE] };
    expect(readAppleIdentityRecord(ambiguous, NOW)).toEqual(ambiguous);
    const rejected = { ...ambiguous, rejected: true };
    expect(readAppleIdentityRecord(rejected, NOW)).toEqual(rejected);
    expect(readAppleIdentityRecord({ ...TIMES, status: 'none' }, NOW)).toEqual({
      ...TIMES,
      status: 'none',
    });
  });

  it('过期、时间在未来、有效期长得不合理的都丢掉；认定的 60 天，没认定的 7 天', () => {
    for (const times of [
      { fetchedAt: NOW - 2000, expiresAt: NOW - 1 },
      { fetchedAt: NOW + 1, expiresAt: NOW + 2000 },
      { fetchedAt: NOW, expiresAt: NOW + IDENTITY_RESOLVED_TTL + 1 },
    ])
      expect(readAppleIdentityRecord({ ...RESOLVED, ...times }, NOW)).toBeNull();
    const open = {
      ...TIMES,
      status: 'none',
      fetchedAt: NOW,
      expiresAt: NOW + IDENTITY_OPEN_TTL + 1,
    };
    expect(readAppleIdentityRecord(open, NOW)).toBeNull();
    const long = { ...RESOLVED, fetchedAt: NOW, expiresAt: NOW + IDENTITY_RESOLVED_TTL };
    expect(readAppleIdentityRecord(long, NOW)).not.toBeNull();
  });

  it('认定项的艺人 ID 与页面地址要对上，名字缺失的整项不要', () => {
    for (const bad of [
      { ...RESOLVED, sourceId: 'abc' },
      { ...RESOLVED, sourceId: '999' },
      { ...RESOLVED, url: 'https://evil.test/cn/artist/nirvana/112018' },
      { ...RESOLVED, sourceArtist: '' },
      { ...RESOLVED, status: 'unknown' },
      { ...RESOLVED, artist: '.' },
    ])
      expect(readAppleIdentityRecord(bad, NOW)).toBeNull();
  });

  it('候选按项丢弃：地址或 ID 不合格的丢，没有一个合格的候选时同名待选项不要', () => {
    const bad = { ...CANDIDATE, id: '5', url: URL_1 };
    const read = readAppleIdentityRecord({ ...RESOLVED, candidates: [bad, CANDIDATE] }, NOW);
    expect(read?.status === 'resolved' && read.candidates).toEqual([CANDIDATE]);
    expect(
      readAppleIdentityRecord({ ...TIMES, status: 'ambiguous', candidates: [bad] }, NOW),
    ).toBeNull();
    expect(readAppleIdentityRecord({ ...TIMES, status: 'ambiguous' }, NOW)).toBeNull();
  });

  it('候选里的杂项字段读回时收窄：可靠重合不超过重合，专辑名限 3 张，年份范围要成对', () => {
    const odd = {
      ...CANDIDATE,
      reliable: 9,
      samples: ['a', 'b', 'c', 'd'],
      years: [2000],
      genre: 5,
    };
    const read = readAppleIdentityRecord({ ...RESOLVED, candidates: [odd] }, NOW);
    expect(read?.status === 'resolved' && read.candidates[0]).toMatchObject({
      reliable: 1,
      samples: ['a', 'b', 'c'],
      years: null,
      genre: '',
    });
  });

  it('缓存项与手选各自对应的状态；自动认定的都不是手选', () => {
    const resolved = readAppleIdentityRecord(RESOLVED, NOW);
    expect(resolved && appleIdentityStateOf(resolved)).toEqual({
      artist: 'Nirvana',
      status: 'resolved',
      sourceId: '112018',
      sourceArtist: 'Nirvana',
      url: URL_1,
      manual: false,
    });
    expect(
      appleManualStateOf({
        artist: 'Nirvana',
        sourceId: '112018',
        sourceArtist: 'Nirvana',
        url: URL_1,
      }),
    ).toMatchObject({ status: 'resolved', manual: true });
    expect(appleManualStateOf({ artist: 'Nirvana', declined: true })).toEqual({
      artist: 'Nirvana',
      status: 'declined',
    });
  });

  it('放宽前存下的候选记录读回时在本机重判；用户否定过的不重判，仍列候选', () => {
    const other = { ...CANDIDATE, id: '5', url: 'https://music.apple.com/cn/artist/x/5' };
    const strong = { ...CANDIDATE, overlap: 4, reliable: 2 };
    const old = readAppleIdentityRecord(
      {
        ...TIMES,
        status: 'ambiguous',
        candidates: [strong, { ...other, overlap: 1, reliable: 0 }],
      },
      NOW,
    );
    expect(old && appleIdentityStateOf(old)).toMatchObject({
      status: 'resolved',
      sourceId: '112018',
      manual: false,
    });
    const rejected = readAppleIdentityRecord(
      { ...TIMES, status: 'ambiguous', candidates: [other, strong], rejected: true },
      NOW,
    );
    expect(rejected && appleIdentityStateOf(rejected)).toMatchObject({
      status: 'ambiguous',
      candidates: [{ id: '5' }, { id: '112018' }],
    });
  });
});
