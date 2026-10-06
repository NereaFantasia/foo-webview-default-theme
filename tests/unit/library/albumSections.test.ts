import { describe, expect, it } from 'vitest';
import {
  filterAlbums,
  sectionAlbums,
  sortAlbums,
  type SectionContext,
} from '../../../src/library/albumSections.ts';
import { albumKeyOf, type Album } from '../../../src/host/libraryContract.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';

const names = (albums: readonly Album[]) => albums.map((album) => album.name);
const NO_CONTEXT: SectionContext = { roots: [], relativeBase: null, creditsOf: () => [] };

describe('filterAlbums', () => {
  const albums = [
    albumRow('Blue Train', 'John Coltrane', { year: '1957' }),
    albumRow('Kind of Blue', 'Miles Davis', { year: '1959-08-17' }),
    albumRow('Mix', 'DJ'),
  ];

  it('多词 AND，每个词落在专辑名、专辑艺术家或年份之一；不分大小写', () => {
    expect(names(filterAlbums(albums, 'BLUE'))).toEqual(['Blue Train', 'Kind of Blue']);
    expect(names(filterAlbums(albums, 'blue miles'))).toEqual(['Kind of Blue']);
    expect(names(filterAlbums(albums, '1959'))).toEqual(['Kind of Blue']);
    expect(names(filterAlbums(albums, 'dj'))).toEqual(['Mix']);
  });

  it('曲目级命中的专辑整张算进来；词为空时全部保留', () => {
    const hits = new Set([albumKeyOf(albums[2]!)]);
    expect(names(filterAlbums(albums, 'nothing', hits))).toEqual(['Mix']);
    expect(names(filterAlbums(albums, '  ', hits))).toHaveLength(3);
  });
});

describe('sortAlbums', () => {
  const albums = [
    albumRow('Vol. 10', 'B', { year: '2001', trackCount: 5 }),
    albumRow('Vol. 2', 'A', { year: '', trackCount: 12 }),
    albumRow('alpha', 'C', { year: '1999-01-01', trackCount: 12 }),
  ];

  it('专辑名按数字感知、不分大小写', () => {
    expect(names(sortAlbums(albums, 'name'))).toEqual(['alpha', 'Vol. 2', 'Vol. 10']);
  });

  it('年份新的在前、没有年份的恒在最后；曲目数多的在前，同数按名字', () => {
    expect(names(sortAlbums(albums, 'year'))).toEqual(['Vol. 10', 'alpha', 'Vol. 2']);
    expect(names(sortAlbums(albums, 'trackCount'))).toEqual(['alpha', 'Vol. 2', 'Vol. 10']);
    expect(names(sortAlbums(albums, 'artist'))).toEqual(['Vol. 2', 'Vol. 10', 'alpha']);
  });

  it('不改入参', () => {
    const copy = [...albums];
    sortAlbums(albums, 'year');
    expect(albums).toEqual(copy);
  });
});

describe('sectionAlbums', () => {
  it('平铺档是单独一节、键为 null', () => {
    const albums = [albumRow('A', 'X')];
    expect(sectionAlbums(albums, 'album', NO_CONTEXT)).toEqual([{ key: null, albums }]);
  });

  it('按流派分节，节按名字排，没有流派的进「未知」节并排最后，节内保持入参顺序', () => {
    const albums = [
      albumRow('B', 'X', { genre: 'Rock' }),
      albumRow('A', 'X', { genre: '' }),
      albumRow('C', 'X', { genre: 'Jazz' }),
      albumRow('D', 'X', { genre: 'Rock' }),
    ];
    const sections = sectionAlbums(albums, 'genre', NO_CONTEXT);
    expect(sections.map((section) => [section.key, names(section.albums)])).toEqual([
      ['Jazz', ['C']],
      ['Rock', ['B', 'D']],
      [null, ['A']],
    ]);
  });

  it('album artist 标签在而值为空：专辑艺术家档回落到 artist', () => {
    const albums = [albumRow('A', 'Solo', { albumArtist: '' }), albumRow('B', 'Solo')];
    expect(sectionAlbums(albums, 'albumArtist', NO_CONTEXT)).toEqual([{ key: 'Solo', albums }]);
  });

  it('文件夹档按首曲的父目录', () => {
    const albums = [albumRow('A', 'X', { firstTrackPath: 'file://E:\\Music\\X\\A\\01.flac' })];
    expect(sectionAlbums(albums, 'folder', NO_CONTEXT)[0]?.key).toBe('E:\\Music\\X\\A');
  });

  it('一级目录档按最长匹配的库根，目录名按原大小写；便携安装的相对路径先拼基准', () => {
    const albums = [
      albumRow('A', 'X', { firstTrackPath: 'file://E:\\Music\\Jazz\\A\\01.flac' }),
      albumRow('B', 'X', { firstTrackPath: 'file://E:\\Music\\Classical\\Bach\\B\\01.flac' }),
      albumRow('C', 'X', { firstTrackPath: 'file-relative://..\\Music\\Pop\\C\\01.flac' }),
      albumRow('D', 'X', { firstTrackPath: 'file://E:\\Music\\loose.flac' }),
    ];
    const context: SectionContext = {
      roots: ['E:\\Music\\', 'E:\\Music\\Classical'],
      relativeBase: 'E:\\FB2K',
      creditsOf: () => [],
    };
    const sections = sectionAlbums(albums, 'libraryRoot', context);
    expect(sections.map((section) => [section.key, names(section.albums)])).toEqual([
      ['Bach', ['B']],
      ['Jazz', ['A']],
      ['Pop', ['C']],
      [null, ['D']],
    ]);
  });

  it('艺术家档：一张专辑进每位署名艺术家的节，没有署名的进「未知」节', () => {
    const duet = albumRow('Duet', 'A');
    const solo = albumRow('Solo', 'B');
    const credits = new Map([[albumKeyOf(duet), ['A', 'B']]]);
    const sections = sectionAlbums([duet, solo], 'artist', {
      ...NO_CONTEXT,
      creditsOf: (album) => credits.get(albumKeyOf(album)) ?? [],
    });
    expect(sections.map((section) => [section.key, names(section.albums)])).toEqual([
      ['A', ['Duet']],
      ['B', ['Duet']],
      [null, ['Solo']],
    ]);
  });
});
