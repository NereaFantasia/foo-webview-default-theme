import { describe, expect, it } from 'vitest';
import {
  matchSimilar,
  matchTopTracks,
  missingTopAlbums,
  trackKey,
} from '../../../../src/library/artists/artistTops.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';

const top = (rank: number, title: string) => ({
  rank,
  title,
  plays: 10,
  listeners: 1,
  url: `https://www.last.fm/music/Nujabes/_/${encodeURIComponent(title)}`,
});

describe('热门与本地比对', () => {
  it('曲名键去掉合作者说明，别的括号是另一首', () => {
    expect(trackKey('Feather (feat. Cise Starr & Akin from Cyne)')).toBe(trackKey('feather'));
    expect(trackKey('Feather ft. Cise Starr')).toBe(trackKey('Feather'));
    expect(trackKey('Luv(sic) Part 3')).not.toBe(trackKey('Luv(sic) Part 4'));
    expect(trackKey('Aruarian Dance (Remix)')).not.toBe(trackKey('Aruarian Dance'));
  });

  it('热门曲目对上他的本地曲目就能播，同名的取第一首', () => {
    const feather = trackRow('Modal Soul', 'Feather');
    const later = trackRow('Best Of', 'FEATHER');
    const matched = matchTopTracks(
      [top(1, 'Feather (feat. Cise Starr & Akin from Cyne)'), top(2, 'Aruarian Dance')],
      [feather, later],
    );
    expect(matched.map((item) => item.local?.album ?? null)).toEqual(['Modal Soul', null]);
  });

  it('热门专辑只留库里没有的；相似艺人标出库里的写法', () => {
    const albums = [
      { title: 'Modal Soul (Deluxe)', plays: 1, url: 'https://www.last.fm/music/Nujabes/a' },
      { title: 'Luv(sic) Hexalogy', plays: 1, url: 'https://www.last.fm/music/Nujabes/b' },
    ];
    expect(missingTopAlbums(albums, ['Modal Soul']).map((album) => album.title)).toEqual([
      'Luv(sic) Hexalogy',
    ]);
    const similar = matchSimilar(
      [
        { artist: 'Uyama Hiroto', match: 1, url: 'https://www.last.fm/music/Uyama+Hiroto' },
        { artist: 'Force of Nature', match: 1, url: 'https://www.last.fm/music/Force+of+Nature' },
      ],
      ['UYAMA HIROTO', 'Nujabes'],
    );
    expect(similar.map((item) => item.local)).toEqual(['UYAMA HIROTO', null]);
  });
});
