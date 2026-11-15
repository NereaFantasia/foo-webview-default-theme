import { describe, expect, it } from 'vitest';
import {
  appleArtistPageUrl,
  readAppleAlbums,
  readAppleSearch,
} from '../../../../../src/library/biography/apple/appleCatalog.ts';

function artist(id: number | string, name: string, extra: Record<string, unknown> = {}) {
  return {
    wrapperType: 'artist',
    artistType: 'Artist',
    artistName: name,
    artistId: id,
    primaryGenreName: '摇滚',
    artistLinkUrl: `https://music.apple.com/cn/artist/${name.toLowerCase()}/${id}?uo=4`,
    ...extra,
  };
}

describe('iTunes 搜索应答', () => {
  it('按应答次序给出艺人，页面地址去掉查询串，重复的 ID 只留第一次', () => {
    const hits = readAppleSearch({
      resultCount: 3,
      results: [artist(3296287, 'Queen'), artist(3296287, 'Queen'), artist('112018', 'Nirvana')],
    });
    expect(hits).toEqual([
      {
        id: '3296287',
        name: 'Queen',
        genre: '摇滚',
        url: 'https://music.apple.com/cn/artist/queen/3296287',
      },
      {
        id: '112018',
        name: 'Nirvana',
        genre: '摇滚',
        url: 'https://music.apple.com/cn/artist/nirvana/112018',
      },
    ]);
  });

  it('不是艺人的项、缺名字或 ID 不合格的项丢掉', () => {
    const hits = readAppleSearch({
      results: [
        { wrapperType: 'collection', collectionName: 'X', artistId: 1 },
        artist(2, ''),
        artist('abc', 'Bad'),
        artist(0, 'Zero'),
        artist(5, 'Ok'),
      ],
    });
    expect(hits.map((item) => item.id)).toEqual(['5']);
    expect(readAppleSearch(null)).toEqual([]);
    expect(readAppleSearch({ results: 'x' })).toEqual([]);
  });

  it('艺人页地址不合格或 ID 对不上时退成按 ID 跳转的地址，没有曲风时为空串', () => {
    const [wrongId, foreign, plain] = readAppleSearch({
      results: [
        artist(7, 'A', { artistLinkUrl: 'https://music.apple.com/cn/artist/a/8' }),
        artist(9, 'B', { artistLinkUrl: 'https://evil.example/cn/artist/b/9' }),
        artist(10, 'C', { primaryGenreName: undefined }),
      ],
    });
    expect(wrongId?.url).toBe('https://music.apple.com/cn/artist/-/7');
    expect(foreign?.url).toBe('https://music.apple.com/cn/artist/-/9');
    expect(plain?.genre).toBe('');
  });

  it('艺人页地址只认 music.apple.com 的 https 艺人页，查询串与片段不保留', () => {
    const url = 'https://music.apple.com/cn/artist/queen/3296287';
    expect(appleArtistPageUrl(`${url}?l=en-GB#x`, '3296287')).toBe(url);
    expect(appleArtistPageUrl(url, '1')).toBeNull();
    expect(appleArtistPageUrl(url.replace('https', 'http'), '3296287')).toBeNull();
    expect(appleArtistPageUrl('https://music.apple.com/cn/album/x/3296287', '3296287')).toBeNull();
    expect(
      appleArtistPageUrl('https://music.apple.com:444/cn/artist/q/3296287', '3296287'),
    ).toBeNull();
  });
});

describe('iTunes 批量 Lookup 应答', () => {
  const album = (artistId: number, name: string, extra: Record<string, unknown> = {}) => ({
    wrapperType: 'collection',
    collectionType: 'Album',
    artistId,
    collectionName: name,
    trackCount: 10,
    releaseDate: '1991-09-24T07:00:00Z',
    ...extra,
  });

  it('专辑按艺人 ID 分组，取标题、发行年份与曲数；艺人项不算专辑', () => {
    const groups = readAppleAlbums({
      results: [
        artist(1, 'A'),
        album(1, 'Nevermind'),
        album(1, 'Live - EP', { trackCount: 4, releaseDate: '2003-01-01T08:00:00Z' }),
        album(2, 'Other'),
      ],
    });
    expect(groups.get('1')).toEqual([
      { title: 'Nevermind', year: 1991, trackCount: 10 },
      { title: 'Live - EP', year: 2003, trackCount: 4 },
    ]);
    expect(groups.get('2')).toHaveLength(1);
    expect(groups.has('3')).toBe(false);
  });

  it('没有发行日期或曲数的专辑照样收下，年份和曲数记为空', () => {
    const groups = readAppleAlbums({
      results: [album(1, 'X', { releaseDate: undefined, trackCount: 0 }), album(1, '')],
    });
    expect(groups.get('1')).toEqual([{ title: 'X', year: null, trackCount: null }]);
  });
});
