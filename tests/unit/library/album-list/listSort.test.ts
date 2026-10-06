import type { LibraryTrack } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import { albumKeyOf, type Album } from '../../../../src/host/libraryContract.ts';
import {
  albumSortValue,
  orderSections,
  parseListSort,
  shuffleRank,
  sortListAlbums,
  type ListSortContext,
  type ListSortField,
  type TrackStats,
} from '../../../../src/library/album-list/listSort.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';

const names = (albums: readonly Album[]) => albums.map((album) => album.name);

const BLUE = albumRow('Blue Train', 'John Coltrane', {
  year: '1957',
  trackCount: 5,
  duration: 2500,
});
const KIND = albumRow('Kind of Blue', 'Miles Davis', { year: '1959-08-17', trackCount: 5 });
const MOANIN = albumRow('Moanin', 'Art Blakey', { year: '', trackCount: 6 });

function context(
  tracks: Readonly<Record<string, readonly LibraryTrack[]>>,
  stats: Readonly<Record<string, TrackStats>> = {},
  seed = 1,
): ListSortContext {
  return {
    tracksOf: (album) => tracks[album.name],
    statsOf: (track) => stats[track.title],
    seed,
  };
}

function stat(extra: Partial<TrackStats>): TrackStats {
  return { added: '', lastPlayed: '', firstPlayed: '', playCount: 0, ...extra };
}

describe('albumSortValue', () => {
  const tracks = [
    trackRow('Blue Train', 'b1', { bitrate: 900, sampleRate: 44100, fileSize: 10, rating: 4 }),
    trackRow('Blue Train', 'b2', { bitrate: 1100, sampleRate: 96000, fileSize: 30, rating: 0 }),
    trackRow('Blue Train', 'b3', { bitrate: 0, sampleRate: 0, fileSize: -1, rating: 2 }),
  ];
  const stats = {
    b1: stat({ added: '2024-01-02 10:00:00', lastPlayed: '2024-03-01 08:00:00', playCount: 2 }),
    b2: stat({ added: '2023-05-05 10:00:00', firstPlayed: '2023-06-01 00:00:00', playCount: 5 }),
    b3: stat({ firstPlayed: '2023-01-01 00:00:00' }),
  };
  const value = (field: ListSortField) =>
    albumSortValue(field, BLUE, context({ 'Blue Train': tracks }, stats));

  it('求和、平均、取最高：取不到的首不算', () => {
    expect(value('fileSize')).toBe(40);
    expect(value('bitrate')).toBe(1000);
    expect(value('sampleRate')).toBe(96000);
    expect(value('playCount')).toBe(7);
    expect(value('duration')).toBe(2500);
  });

  it('评分取评过分的曲目的平均；添加时间、最近播放取最新，首次播放取最早', () => {
    expect(value('rating')).toBe(3);
    expect(value('added')).toBe('2024-01-02 10:00:00');
    expect(value('lastPlayed')).toBe('2024-03-01 08:00:00');
    expect(value('firstPlayed')).toBe('2023-01-01 00:00:00');
  });

  it('格式与文件夹路径取第一首；年份只取四位；曲目还没取到时文件一组取不到', () => {
    expect(value('codec')).toBe('FLAC');
    expect(value('folder')).toBe('E:\\Music\\John Coltrane\\Blue Train');
    expect(albumSortValue('year', KIND, context({}))).toBe('1959');
    expect(albumSortValue('fileSize', KIND, context({}))).toBeUndefined();
    expect(albumSortValue('added', BLUE, context({ 'Blue Train': tracks }))).toBeUndefined();
  });
});

describe('sortListAlbums', () => {
  it('升序、降序；取不到值的恒在最后', () => {
    const albums = [MOANIN, KIND, BLUE];
    const empty = context({});
    expect(names(sortListAlbums(albums, { field: 'year', descending: false }, empty))).toEqual([
      'Blue Train',
      'Kind of Blue',
      'Moanin',
    ]);
    expect(names(sortListAlbums(albums, { field: 'year', descending: true }, empty))).toEqual([
      'Kind of Blue',
      'Blue Train',
      'Moanin',
    ]);
  });

  it('值相同时按专辑名；入参不改', () => {
    const albums = [KIND, BLUE];
    const sorted = sortListAlbums(albums, { field: 'trackCount', descending: true }, context({}));
    expect(names(sorted)).toEqual(['Blue Train', 'Kind of Blue']);
    expect(names(albums)).toEqual(['Kind of Blue', 'Blue Train']);
  });

  it('随机：同一个种子排出同一个顺序，与入参顺序无关；方向不起作用', () => {
    const many = Array.from({ length: 30 }, (_, at) => albumRow(`Album ${at}`, 'Artist'));
    const shuffle = (seed: number, list: readonly Album[], descending = false) =>
      names(sortListAlbums(list, { field: 'random', descending }, context({}, {}, seed)));
    const once = shuffle(7, many);
    expect(shuffle(7, [...many].reverse())).toEqual(once);
    expect(shuffle(7, many, true)).toEqual(once);
    expect(shuffle(8, many)).not.toEqual(once);
    expect(once).not.toEqual(names(many));
  });

  it('洗牌的秩只看种子与专辑键', () => {
    const key = albumKeyOf(BLUE);
    expect(shuffleRank(3, key)).toBe(shuffleRank(3, key));
    expect(shuffleRank(3, key)).not.toBe(shuffleRank(4, key));
    expect(shuffleRank(3, key)).toBeGreaterThanOrEqual(0);
  });
});

describe('parseListSort', () => {
  it('字段不认得就当没存；方向不是 true 就当升序', () => {
    expect(parseListSort({ field: 'bitrate', descending: true })).toEqual({
      field: 'bitrate',
      descending: true,
    });
    expect(parseListSort({ field: 'bitrate', descending: 'yes' })).toEqual({
      field: 'bitrate',
      descending: false,
    });
    expect(parseListSort({ field: 'bogus' })).toBeUndefined();
    expect(parseListSort('albumArtist')).toBeUndefined();
  });
});

describe('orderSections', () => {
  const section = (key: string | null, count: number) => ({
    key,
    albums: Array.from({ length: count }, (_, at) => albumRow(`${key} ${at}`, 'A')),
  });
  const keys = (sections: readonly { key: string | null }[]) => sections.map((s) => s.key);

  it('按张数多的在前，张数相同保持名称序，「未知」恒在最后；按名称原样', () => {
    const sections = [
      section('Blues', 2),
      section('Jazz', 5),
      section('Rock', 2),
      section(null, 9),
    ];
    expect(keys(orderSections(sections, 'count'))).toEqual(['Jazz', 'Blues', 'Rock', null]);
    expect(keys(orderSections(sections, 'name'))).toEqual(['Blues', 'Jazz', 'Rock', null]);
  });
});
