import { describe, expect, it } from 'vitest';
import {
  decadeOf,
  EMPTY_SONG_FACETS,
  genresOf,
  pruneSongFacets,
  songFacetCount,
  songFacetOptions,
  songFacetQueries,
  toggleSongFacet,
  UNKNOWN_DECADE,
  type FacetTrack,
} from '../../../../src/library/songs/songsFacets.ts';

const track = (genre: string, date: string, artists: string[]): FacetTrack => ({
  genre,
  date,
  artist: artists.join(', '),
  artists,
});

const LIBRARY: FacetTrack[] = [
  track('Hip-Hop', '2005', ['Nujabes', 'Shing02']),
  track('Hip-Hop, Jazz', '2005-11-11', ['Nujabes']),
  track('Trip-Hop', '1998.04.20', ['Massive Attack']),
  track('Trip-Hop', '', ['Massive Attack']),
  track('Say "Hi"', 'circa 1990', ['What?']),
];

describe('年代与流派', () => {
  it('日期开头的四位年份归年代，没写日期归「未知」，不以年份开头的不归', () => {
    expect(decadeOf('2005-11-11')).toBe('2000s');
    expect(decadeOf('1998.04.20')).toBe('1990s');
    expect(decadeOf('  ')).toBe(UNKNOWN_DECADE);
    expect(decadeOf('circa 1990')).toBeNull();
  });

  it('流派按「, 」拆开', () => {
    expect(genresOf({ genre: 'Hip-Hop, Jazz' })).toEqual(['Hip-Hop', 'Jazz']);
    expect(genresOf({ genre: '' })).toEqual([]);
  });
});

describe('三栏的取值', () => {
  it('按首数多的在前，写不进查询的值不列；年代新的在前，未知垫底', () => {
    const options = songFacetOptions(LIBRARY);
    expect(options.genre).toEqual([
      { name: 'Hip-Hop', count: 2 },
      { name: 'Trip-Hop', count: 2 },
      { name: 'Jazz', count: 1 },
    ]);
    expect(options.decade).toEqual([
      { name: '2000s', count: 2 },
      { name: '1990s', count: 1 },
      { name: UNKNOWN_DECADE, count: 1 },
    ]);
    expect(options.artist.map((value) => value.name)).toEqual([
      'Massive Attack',
      'Nujabes',
      'Shing02',
    ]);
  });
});

describe('勾选拼成查询', () => {
  it('栏内或、每栏一段；年代按日期前三个字认，未知是没有日期', () => {
    let selection = toggleSongFacet(EMPTY_SONG_FACETS, 'genre', 'Jazz');
    selection = toggleSongFacet(selection, 'genre', 'Hip-Hop');
    selection = toggleSongFacet(selection, 'decade', '1990s');
    selection = toggleSongFacet(selection, 'decade', UNKNOWN_DECADE);
    selection = toggleSongFacet(selection, 'artist', 'Nujabes');
    expect(songFacetCount(selection)).toBe(5);
    expect(songFacetQueries(selection)).toEqual([
      '(genre IS "Jazz" OR genre IS "Hip-Hop")',
      '"$left(%date%,3)" IS 199 OR NOT date PRESENT',
      'artist IS "Nujabes"',
    ]);
    expect(songFacetQueries(EMPTY_SONG_FACETS)).toEqual([]);
  });

  it('再点一次取消；库变了之后不在清单上的勾选剔掉，没得剔时原样答回', () => {
    const selection = toggleSongFacet(EMPTY_SONG_FACETS, 'artist', 'Gone');
    expect(toggleSongFacet(selection, 'artist', 'Gone').artist.size).toBe(0);
    const options = songFacetOptions(LIBRARY);
    expect(pruneSongFacets(selection, options).artist.size).toBe(0);
    const kept = toggleSongFacet(EMPTY_SONG_FACETS, 'artist', 'Nujabes');
    expect(pruneSongFacets(kept, options)).toBe(kept);
  });
});
