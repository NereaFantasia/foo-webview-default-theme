import { describe, expect, it } from 'vitest';
import {
  decadeOf,
  EMPTY_TRACK_FACETS,
  genresOf,
  pruneTrackFacets,
  trackFacetCount,
  trackFacetOptions,
  trackFacetQueries,
  toggleTrackFacet,
  UNKNOWN_DECADE,
  type FacetTrack,
} from '../../../src/track/trackFacets.ts';

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
    const options = trackFacetOptions(LIBRARY);
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

  it('给了真实流派值时按它列：单个值里的逗号不拆，计数与按值查询的结果一致', () => {
    const single = track('Rock, Soul', '', []);
    const multi = track('Rock, Soul', '', []);
    const values = new Map<FacetTrack, readonly string[]>([
      [single, ['Rock, Soul']],
      [multi, ['Rock', 'Soul']],
    ]);
    const options = trackFacetOptions([single, multi], (item) => values.get(item) ?? []);
    expect(options.genre).toEqual([
      { name: 'Rock', count: 1 },
      { name: 'Rock, Soul', count: 1 },
      { name: 'Soul', count: 1 },
    ]);
  });
});

describe('勾选拼成查询', () => {
  it('栏内或、每栏一段；年代按日期前三个字认，未知是没有日期', () => {
    let selection = toggleTrackFacet(EMPTY_TRACK_FACETS, 'genre', 'Jazz');
    selection = toggleTrackFacet(selection, 'genre', 'Hip-Hop');
    selection = toggleTrackFacet(selection, 'decade', '1990s');
    selection = toggleTrackFacet(selection, 'decade', UNKNOWN_DECADE);
    selection = toggleTrackFacet(selection, 'artist', 'Nujabes');
    expect(trackFacetCount(selection)).toBe(5);
    expect(trackFacetQueries(selection)).toEqual([
      '(genre IS "Jazz" OR genre IS "Hip-Hop")',
      '"$left(%date%,3)" IS 199 OR NOT date PRESENT',
      'artist IS "Nujabes"',
    ]);
    expect(trackFacetQueries(EMPTY_TRACK_FACETS)).toEqual([]);
  });

  it('再点一次取消；库变了之后不在清单上的勾选剔掉，没得剔时原样答回', () => {
    const selection = toggleTrackFacet(EMPTY_TRACK_FACETS, 'artist', 'Gone');
    expect(toggleTrackFacet(selection, 'artist', 'Gone').artist.size).toBe(0);
    const options = trackFacetOptions(LIBRARY);
    expect(pruneTrackFacets(selection, options).artist.size).toBe(0);
    const kept = toggleTrackFacet(EMPTY_TRACK_FACETS, 'artist', 'Nujabes');
    expect(pruneTrackFacets(kept, options)).toBe(kept);
  });
});
