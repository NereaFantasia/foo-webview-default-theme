import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { filterConditions } from '../../../src/track/filterLabels.ts';
import { EMPTY_TRACK_FILTER } from '../../../src/track/trackFilter.ts';
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
  type TrackFacetOptions,
} from '../../../src/track/trackFacets.ts';

const track = (genre: string, date: string, artists: string[]): FacetTrack => ({
  genre,
  date,
  artist: artists.join(', '),
  artists,
  album: '',
  albumArtists: [],
  absolutePath: '',
});

/** 放在 `folder` 里的一首；`albumArtists` 缺省是没标专辑艺人 */
const onAlbum = (
  album: string,
  folder: string,
  artists: string[],
  albumArtists: string[] = [],
): FacetTrack => ({
  ...track('', '', artists),
  album,
  albumArtists,
  absolutePath: `${folder}\\01.flac`,
});

/** 按显示名取专辑一栏里那一项的取值 */
function albumValue(options: TrackFacetOptions, label: string): string {
  const found = options.album.find((value) => value.label === label);
  if (!found) throw new Error(`没有这一项：${label}`);
  return found.name;
}

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

describe('专辑一栏', () => {
  const COMPILATION = 'E:\\Music\\Now 100';
  const compilation = [
    onAlbum('Now 100', COMPILATION, ['A']),
    onAlbum('Now 100', COMPILATION, ['B']),
    onAlbum('Now 100', COMPILATION, ['C']),
  ];

  it('没标专辑艺人的合辑：每首艺人不同也归在同一张，艺人一栏仍是各算各的', () => {
    const options = trackFacetOptions(compilation);
    expect(options.album).toEqual([
      { name: expect.stringContaining('Now 100'), count: 3, label: 'Now 100' },
    ]);
    expect(options.artist.map((value) => value.name)).toEqual(['A', 'B', 'C']);
  });

  it('没标专辑艺人的同名专辑按文件夹分开，同名的在名字后写文件夹名区分', () => {
    const options = trackFacetOptions([
      onAlbum('Greatest Hits', 'E:\\Music\\Queen', ['Queen']),
      onAlbum('Greatest Hits', 'E:\\Music\\Queen', ['Queen']),
      onAlbum('Greatest Hits', 'E:\\Music\\ABBA', ['ABBA']),
    ]);
    expect(options.album.map(({ label, count }) => [label, count])).toEqual([
      ['Greatest Hits · Queen', 2],
      ['Greatest Hits · ABBA', 1],
    ]);
  });

  it('标了专辑艺人的按（专辑名，专辑艺人）归，与所在文件夹无关；同名的写专辑艺人区分', () => {
    const options = trackFacetOptions([
      onAlbum('Live', 'E:\\Music\\1', ['A'], ['A']),
      onAlbum('Live', 'E:\\Music\\2', ['A'], ['A']),
      onAlbum('Live', 'E:\\Music\\3', ['B'], ['B']),
      onAlbum('Solo', 'E:\\Music\\4', ['C'], ['C']),
    ]);
    expect(options.album.map(({ label, count }) => [label, count])).toEqual([
      ['Live · A', 2],
      ['Live · B', 1],
      ['Solo', 1],
    ]);
  });

  it('没有专辑名、含异常编码的专辑、值写不进查询、不是本地绝对路径的不列', () => {
    const options = trackFacetOptions([
      onAlbum('', 'E:\\Music\\X', ['A']),
      { ...onAlbum('Odd', 'E:\\Music\\X', ['A']), albumId: 'album1:6f' },
      onAlbum('What?', 'E:\\Music\\X', ['A']),
      onAlbum('Tagged "q"', 'E:\\Music\\X', ['A'], ['A']),
      { ...onAlbum('Remote', '', ['A']), absolutePath: 'https://host/a/01.flac' },
      { ...onAlbum('AtRoot', '', ['A']), absolutePath: 'E:\\01.flac' },
    ]);
    expect(options.album).toEqual([]);
  });

  it('勾选拼成查询：标了专辑艺人的比 album artist，没标的按文件夹，几张用或连、再与其他栏并', () => {
    const options = trackFacetOptions([
      ...compilation,
      onAlbum('Live', 'E:\\Music\\1', ['A'], ['A']),
    ]);
    const merged = toggleTrackFacet(EMPTY_TRACK_FACETS, 'album', albumValue(options, 'Now 100'));
    expect(trackFacetQueries(merged)).toEqual([
      `album IS "Now 100" AND NOT "album artist" PRESENT AND "$directory_path(%path%)" IS "${COMPILATION}"`,
    ]);
    const both = toggleTrackFacet(merged, 'album', albumValue(options, 'Live'));
    const withGenre = toggleTrackFacet(both, 'genre', 'Jazz');
    expect(trackFacetCount(withGenre)).toBe(3);
    expect(trackFacetQueries(withGenre)).toEqual([
      'genre IS "Jazz"',
      `(album IS "Now 100" AND NOT "album artist" PRESENT AND "$directory_path(%path%)" IS "${COMPILATION}") OR (album IS "Live" AND "album artist" IS "A")`,
    ]);
  });

  it('认不出的取值匹配不到任何曲目，不放行整库；库里没有了的专辑勾选被剔掉', () => {
    const stale = toggleTrackFacet(EMPTY_TRACK_FACETS, 'album', 'not-an-album-value');
    expect(trackFacetQueries(stale)).toEqual(['NOT ALL']);
    const options = trackFacetOptions(compilation);
    expect(pruneTrackFacets(stale, options).album.size).toBe(0);
    const kept = toggleTrackFacet(EMPTY_TRACK_FACETS, 'album', albumValue(options, 'Now 100'));
    expect(pruneTrackFacets(kept, options)).toBe(kept);
  });

  it('条件行里的标签只写专辑名', () => {
    const options = trackFacetOptions(compilation);
    const facets = toggleTrackFacet(EMPTY_TRACK_FACETS, 'album', albumValue(options, 'Now 100'));
    const t = createTranslate(zhCN, {});
    expect(filterConditions({ ...EMPTY_TRACK_FILTER, facets }, t).map((one) => one.label)).toEqual([
      'Now 100',
    ]);
  });
});
