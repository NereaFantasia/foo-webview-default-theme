import { describe, expect, it, vi } from 'vitest';
import type {
  AppleApiResult,
  AppleClient,
} from '../../../../../src/library/biography/apple/appleClient.ts';
import {
  appleArtistIdFromLink,
  resolveAppleIdentity,
  resolveAppleLink,
  searchAppleArtists,
} from '../../../../../src/library/biography/apple/appleIdentityResolver.ts';
import { lookupAnswer, searchAnswer } from '../../../../fixtures/appleCatalog.ts';

const ARTIST = { id: 112018, name: 'Nirvana' };
const data = (value: unknown): AppleApiResult => ({ kind: 'data', data: value });

function client(search: AppleApiResult, lookup: AppleApiResult) {
  const methods = {
    search: vi.fn(async (): Promise<AppleApiResult> => search),
    lookup: vi.fn(async (): Promise<AppleApiResult> => lookup),
  };
  return methods satisfies Pick<AppleClient, 'search' | 'lookup'>;
}

describe('粘贴的 Apple 艺人链接', () => {
  it('取出艺人 ID：带名字、不带名字、带区域与查询串的都认，itunes.apple.com 也认', () => {
    for (const link of [
      'https://music.apple.com/cn/artist/nirvana/112018',
      'https://music.apple.com/us/artist/112018',
      ' https://music.apple.com/cn/artist/nirvana/112018?l=en-US ',
      'https://music.apple.com/artist/nirvana/112018/',
      'https://itunes.apple.com/cn/artist/nirvana/112018',
    ])
      expect(appleArtistIdFromLink(link)).toBe('112018');
  });

  it('不是艺人页、不是 Apple 的域名、不是 https 的都不认', () => {
    for (const link of [
      'https://music.apple.com/cn/album/nevermind/1440783617',
      'https://www.last.fm/music/Nirvana',
      'http://music.apple.com/cn/artist/nirvana/112018',
      'https://music.apple.com.evil.test/cn/artist/nirvana/112018',
      'https://music.apple.com:8443/cn/artist/nirvana/112018',
      'https://music.apple.com/cn/artist/nirvana/0',
      'music.apple.com/cn/artist/nirvana/112018',
      '',
    ])
      expect(appleArtistIdFromLink(link)).toBeNull();
  });

  it('按 ID 查一次，取回名字和规范地址；ID 不在应答里算查无此人', async () => {
    const found = client(data({}), data(lookupAnswer({ 1: { artist: ARTIST, albums: [] } })));
    expect(await resolveAppleLink(found, '112018', () => true)).toEqual({
      kind: 'found',
      sourceId: '112018',
      sourceArtist: 'Nirvana',
      url: 'https://music.apple.com/cn/artist/nirvana/112018',
    });
    expect(found.lookup).toHaveBeenCalledTimes(1);
    const other = client(data({}), data(lookupAnswer({ 1: { artist: ARTIST, albums: [] } })));
    expect(await resolveAppleLink(other, '999', () => true)).toEqual({ kind: 'missing' });
  });
});

describe('搜索框按关键词找艺人', () => {
  const artists = Array.from({ length: 10 }, (_, index) => ({
    id: 100 + index,
    name: `Artist ${index}`,
  }));

  it('按 Apple 返回的次序取前 8 位，不按名字筛，不与本地专辑比对；只发搜索加一次 Lookup', async () => {
    const env = client(
      data(searchAnswer(...artists)),
      data(
        lookupAnswer({
          1: { artist: artists[0] ?? ARTIST, albums: [{ title: 'Debut', year: 2001, tracks: 9 }] },
        }),
      ),
    );
    const outcome = await searchAppleArtists(env, 'queen', () => true);
    expect(env.search.mock.calls[0]).toEqual(['queen', expect.any(Function), undefined]);
    expect(env.lookup).toHaveBeenCalledTimes(1);
    expect(env.lookup.mock.calls[0]).toEqual([
      ['100', '101', '102', '103', '104', '105', '106', '107'],
      expect.any(Function),
    ]);
    expect(outcome.kind).toBe('found');
    if (outcome.kind !== 'found') return;
    expect(outcome.candidates.map((item) => item.id)).toEqual([
      '100',
      '101',
      '102',
      '103',
      '104',
      '105',
      '106',
      '107',
    ]);
    // 名字与关键词都对不上的也列出来；没有比对，所以没有重合
    expect(outcome.candidates.every((item) => item.overlap === 0 && !item.matched.length)).toBe(
      true,
    );
    expect(outcome.candidates[0]).toMatchObject({ albumCount: 1, years: [2001, 2001] });
  });

  it('搜不到时给空列表，不再 Lookup', async () => {
    const env = client(data(searchAnswer()), data({}));
    expect(await searchAppleArtists(env, 'nobody', () => true)).toEqual({
      kind: 'found',
      candidates: [],
    });
    expect(env.lookup).not.toHaveBeenCalled();
  });

  it('请求失败原样交出；调用方放弃后不再往下请求', async () => {
    const failed = client({ kind: 'failed', problem: 'rateLimited', retryAt: 9 }, data({}));
    expect(await searchAppleArtists(failed, 'x', () => true)).toMatchObject({
      kind: 'failed',
      problem: 'rateLimited',
    });
    const env = client(data(searchAnswer(ARTIST)), data({}));
    let alive = true;
    env.search.mockImplementation(async () => {
      alive = false;
      return data(searchAnswer(ARTIST));
    });
    expect(await searchAppleArtists(env, 'x', () => alive)).toEqual({ kind: 'cancelled' });
    expect(env.lookup).not.toHaveBeenCalled();
  });
});

describe('Apple 身份认定', () => {
  it('请求里只有艺人名与艺人 ID，不外发本地专辑名；没有本地专辑也会 Lookup，候选行要靠它认人', async () => {
    const env = client(
      data(searchAnswer(ARTIST)),
      data(lookupAnswer({ 1: { artist: ARTIST, albums: [{ title: 'Nevermind', year: 1991 }] } })),
    );
    const outcome = await resolveAppleIdentity(env, 'Nirvana', [], true, () => true);
    expect(env.search.mock.calls[0]).toEqual(['Nirvana', expect.any(Function), undefined]);
    expect(JSON.stringify(env.lookup.mock.calls)).not.toContain('Nevermind');
    expect(env.lookup).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      kind: 'record',
      entry: {
        status: 'resolved',
        sourceId: '112018',
        candidates: [{ id: '112018', samples: ['Nevermind'] }],
      },
    });
  });

  it('名字一致的恰好一位时，在 Lookup 之前先交给提前取页；不止一位、名字不一致或用户否定过时不提前取', async () => {
    const order: string[] = [];
    const env = client(
      data(searchAnswer(ARTIST)),
      data(lookupAnswer({ 1: { artist: ARTIST, albums: [] } })),
    );
    env.lookup.mockImplementation(async () => {
      order.push('lookup');
      return data(lookupAnswer({ 1: { artist: ARTIST, albums: [] } }));
    });
    const alive = () => true;
    await resolveAppleIdentity(env, 'Nirvana', [], true, alive, (hit, still) => {
      order.push(`prefetch:${hit.id}:${still === alive}`);
    });
    expect(order).toEqual(['prefetch:112018:true', 'lookup']);

    const never = vi.fn();
    const pair = client(
      data(searchAnswer(ARTIST, { id: 5, name: 'Nirvana' })),
      data(lookupAnswer({})),
    );
    await resolveAppleIdentity(pair, 'Nirvana', [], true, alive, never);
    const other = client(
      data(searchAnswer({ id: 9, name: 'Diao ye zong' })),
      data(lookupAnswer({})),
    );
    await resolveAppleIdentity(other, '凋叶棕', [], true, alive, never);
    await resolveAppleIdentity(env, 'Nirvana', [], false, alive, never);
    expect(never).not.toHaveBeenCalled();
  });

  it('搜不到艺人时查无此人，不再 Lookup', async () => {
    const env = client(data(searchAnswer()), data({}));
    const outcome = await resolveAppleIdentity(env, 'Nobody', [], true, () => true);
    expect(outcome).toMatchObject({ kind: 'record', entry: { status: 'none' } });
    expect(env.lookup).not.toHaveBeenCalled();
  });

  it('认定的记录带上全部候选；compare 为 false 时只列名字一致的，不比对专辑', async () => {
    const env = client(
      data(searchAnswer(ARTIST, { id: 5, name: 'Nirvana' })),
      data(
        lookupAnswer({
          1: { artist: ARTIST, albums: [{ title: 'Nevermind', year: 1991, tracks: 13 }] },
          2: { artist: { id: 5, name: 'Nirvana' }, albums: [] },
        }),
      ),
    );
    const owned = [{ name: 'Nevermind', year: 1991, trackCount: 13 }];
    const resolved = await resolveAppleIdentity(env, 'Nirvana', owned, true, () => true);
    expect(resolved).toMatchObject({
      kind: 'record',
      entry: { status: 'resolved', sourceId: '112018' },
    });
    if (resolved.kind === 'record' && resolved.entry.status === 'resolved')
      expect(resolved.entry.candidates.map((item) => item.id)).toEqual(['112018', '5']);
    const listed = await resolveAppleIdentity(env, 'Nirvana', owned, false, () => true);
    // 带 rejected：读回时不按证据重判，免得又认回刚否定的那位
    expect(listed).toMatchObject({
      kind: 'record',
      entry: { status: 'ambiguous', rejected: true },
    });
  });

  it('请求失败原样交出；搜索回来时调用方已放弃就不再 Lookup', async () => {
    const failed = client({ kind: 'failed', problem: 'blocked', retryAt: 9 }, data({}));
    expect(await resolveAppleIdentity(failed, 'X', [], true, () => true)).toMatchObject({
      kind: 'failed',
      problem: 'blocked',
    });
    const env = client(data(searchAnswer(ARTIST)), data({}));
    let alive = true;
    env.search.mockImplementation(async () => {
      alive = false;
      return data(searchAnswer(ARTIST));
    });
    expect(await resolveAppleIdentity(env, 'X', [], true, () => alive)).toEqual({
      kind: 'cancelled',
    });
    expect(env.lookup).not.toHaveBeenCalled();
  });
});
