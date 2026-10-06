import { describe, expect, it, vi } from 'vitest';
import type {
  LastfmApiResult,
  requestLastfmApi,
} from '../../../../../src/library/biography/lastfm-api/lastfmApi.ts';
import {
  fetchLastfmTops,
  readSimilarArtists,
  readTopAlbums,
  readTopTracks,
} from '../../../../../src/library/biography/lastfm-api/lastfmArtistTops.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

// 字段写法照 2026-10-02 用真实 key 取回的应答：曲目次数是字符串，专辑次数是数字。
const TOP_TRACKS = {
  toptracks: {
    track: [
      {
        name: 'Feather (feat. Cise Starr & Akin from Cyne)',
        playcount: '5532179',
        listeners: '500334',
        url: 'https://www.last.fm/music/Nujabes/_/Feather+(feat.+Cise+Starr+&+Akin+from+Cyne)',
        '@attr': { rank: '1' },
      },
      {
        name: 'Aruarian Dance',
        playcount: '3300000',
        listeners: '400000',
        url: 'javascript:alert(1)',
      },
      {
        name: 'Luv(sic) Part 3',
        playcount: 'x',
        url: 'https://www.last.fm/music/Nujabes/_/Luv(sic)+Part+3',
      },
    ],
  },
};

const TOP_ALBUMS = {
  topalbums: {
    album: [
      {
        name: 'Modal Soul',
        playcount: 28944636,
        url: 'https://www.last.fm/music/Nujabes/Modal+Soul',
      },
      { name: 'null', playcount: 12, url: 'https://www.last.fm/music/Uyama+Hiroto/null' },
      {
        name: 'Hydeout Productions 2nd Collection',
        playcount: 1,
        url: 'https://www.last.fm/music/Nujabes/X',
      },
    ],
  },
};

const SIMILAR = {
  similarartists: {
    artist: [
      { name: 'Force of Nature', match: '1', url: 'https://www.last.fm/music/Force+of+Nature' },
      { name: 'Nujabes', match: '0.9', url: 'https://www.last.fm/music/Nujabes' },
      { name: 'Uyama Hiroto', match: '7', url: 'https://www.last.fm/music/Uyama+Hiroto' },
      { name: 'Fake', match: '0.5', url: 'https://evil.example/music/Fake' },
    ],
  },
};

describe('Last.fm 热门与相似', () => {
  it('热门曲目：名次取 @attr，没有就按顺序；次数是字符串；不在 Last.fm 上的链接丢掉', () => {
    expect(readTopTracks(TOP_TRACKS)).toEqual([
      {
        rank: 1,
        title: 'Feather (feat. Cise Starr & Akin from Cyne)',
        plays: 5532179,
        listeners: 500334,
        url: 'https://www.last.fm/music/Nujabes/_/Feather+(feat.+Cise+Starr+&+Akin+from+Cyne)',
      },
      {
        rank: 3,
        title: 'Luv(sic) Part 3',
        plays: 0,
        listeners: 0,
        url: 'https://www.last.fm/music/Nujabes/_/Luv(sic)+Part+3',
      },
    ]);
    expect(readTopTracks({ toptracks: { track: TOP_TRACKS.toptracks.track[0] } })).toHaveLength(1);
  });

  it('热门专辑：次数是数字，名字是 null 的条目丢掉；相似艺人去掉他自己、相似度夹到 0–1', () => {
    expect(readTopAlbums(TOP_ALBUMS).map((album) => [album.title, album.plays])).toEqual([
      ['Modal Soul', 28944636],
      ['Hydeout Productions 2nd Collection', 1],
    ]);
    expect(readSimilarArtists(SIMILAR, 'nujabes')).toEqual([
      { artist: 'Force of Nature', match: 1, url: 'https://www.last.fm/music/Force+of+Nature' },
      { artist: 'Uyama Hiroto', match: 1, url: 'https://www.last.fm/music/Uyama+Hiroto' },
    ]);
  });

  it('三个请求按顺序发、带上限；任一失败整份失败；查无此人当三样都没有；有效期取最早的', async () => {
    const host = installFakeHost();
    const now = Date.now();
    const answers: LastfmApiResult[] = [
      { kind: 'data', data: TOP_TRACKS, store: true, expiresAt: now + 3000 },
      { kind: 'data', data: TOP_ALBUMS, store: true, expiresAt: now + 1000 },
      { kind: 'missing', store: true, expiresAt: now + 2000 },
    ];
    const request = vi.fn<typeof requestLastfmApi>(
      async () => answers.shift() ?? { kind: 'missing' as const, store: true, expiresAt: now },
    );
    const result = await fetchLastfmTops('Nujabes', 'k', host.fb, request);
    expect(request.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['artist.getTopTracks', { artist: 'Nujabes', autocorrect: '0', limit: '50' }],
      ['artist.getTopAlbums', { artist: 'Nujabes', autocorrect: '0', limit: '20' }],
      ['artist.getSimilar', { artist: 'Nujabes', autocorrect: '0', limit: '20' }],
    ]);
    expect(result).toMatchObject({ ok: true, expiresAt: now + 1000, similar: [] });
    request.mockResolvedValueOnce({ kind: 'failed', problem: 'rateLimited', retryAt: 5 });
    expect(await fetchLastfmTops('Nujabes', 'k', host.fb, request)).toEqual({
      ok: false,
      problem: 'rateLimited',
      retryAt: 5,
    });
  });
});
