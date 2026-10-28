import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELEASE_SORT,
  findReleases,
  isFeatured,
  kindOptions,
  layoutReleases,
  mergeReleases,
  naturalRelease,
  releaseGroup,
  sortReleases,
  versionOptions,
  withKinds,
  withVersions,
  type ReleaseKind,
} from '../../../../src/library/online/artistReleases.ts';
import type { MusicAlbum, MusicAlbumSubType } from '../../../../src/server/musicObjects.ts';
import { artistAlbumCatalog } from '../../../fixtures/artistAlbums.ts';
import { musicAlbum } from '../../../fixtures/music.ts';

const SELF = { platform: 'wy', id: '7' } as const;
const OTHER = [{ ref: { platform: 'wy', id: '9' } as const, name: '别人' }];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const titles = (albums: readonly MusicAlbum[]) => albums.map((album) => album.title);
const own = (id: string, patch: Partial<MusicAlbum> = {}) =>
  musicAlbum(id, { artists: [{ ref: SELF, name: 'Nujabes' }], ...patch });

describe('艺人专辑的分组', () => {
  it.each([
    [{ kind: 'album', trackCount: 3 }, 'album'],
    [{ kind: 'single', trackCount: 12 }, 'single'],
    [{ kind: 'ep', trackCount: null }, 'single'],
    [{ kind: 'compilation', trackCount: 2 }, 'compilation'],
    [{ kind: null, trackCount: 7 }, 'album'],
    [{ kind: null, trackCount: 6 }, 'single'],
    [{ kind: null, trackCount: 1 }, 'single'],
    [{ kind: null, trackCount: 0 }, null],
    [{ kind: null, trackCount: null }, null],
  ] as const)('上游种类优先，没标时按曲数：%j → %s', (patch, group) => {
    expect(releaseGroup(musicAlbum('1', patch))).toBe(group);
  });

  it('第一署名不是这位艺人才算参与，署名没有身份时认不出', () => {
    const lead = (album: MusicAlbum) => isFeatured(album, SELF);
    expect(lead(musicAlbum('1', { artists: [...OTHER, { ref: SELF, name: 'N' }] }))).toBe(true);
    expect(lead(own('1'))).toBe(false);
    expect(lead(musicAlbum('1', { artists: [{ ref: null, name: '未收录' }] }))).toBe(false);
    expect(lead(musicAlbum('1', { artists: [] }))).toBe(false);
    expect(lead(own('1', { artists: [{ ref: { platform: 'tx', id: '7' }, name: 'N' }] }))).toBe(
      true,
    );
  });

  it('按页签与小节分，各组内保持原有顺序；参与的只从专辑里分出来', () => {
    const layout = layoutReleases(
      [
        own('1', { title: 'A', kind: 'album' }),
        own('2', { title: 'S', kind: 'single' }),
        own('3', { title: 'F', kind: 'album', artists: OTHER }),
        own('4', { title: 'C', kind: 'compilation', artists: OTHER }),
        own('5', { title: 'E', kind: 'ep', artists: OTHER }),
        own('6', { title: 'U', kind: null, trackCount: null, artists: OTHER }),
        own('7', { title: 'B', kind: null, trackCount: 9 }),
      ],
      SELF,
    );
    expect(layout.split).toBe(true);
    expect(titles(layout.albums)).toEqual(['A', 'U', 'B']);
    expect(titles(layout.featured)).toEqual(['F']);
    expect(titles(layout.compilations)).toEqual(['C']);
    expect(titles(layout.singles)).toEqual(['S', 'E']);
  });

  it('一张都分不出组时不分页签，全部平铺', () => {
    const bare = artistAlbumCatalog('7', true);
    const layout = layoutReleases(bare, SELF);
    expect(layout).toMatchObject({ split: false, compilations: [], featured: [], singles: [] });
    expect(layout.albums).toHaveLength(bare.length);
  });

  it('联网搜到的专辑并进各页签与小节；有一边分不出组时都放进正文', () => {
    const base = layoutReleases(
      [own('1', { title: 'A', kind: 'album' }), own('2', { title: 'S', kind: 'single' })],
      SELF,
    );
    const merged = mergeReleases(
      base,
      [
        own('3', { title: 'B', kind: 'album' }),
        own('4', { title: 'C', kind: 'compilation' }),
        own('5', { title: 'E', kind: 'ep' }),
        own('6', { title: 'F', kind: 'album', artists: OTHER }),
      ],
      SELF,
    );
    expect(titles(merged.albums)).toEqual(['A', 'B']);
    expect(titles(merged.compilations)).toEqual(['C']);
    expect(titles(merged.singles)).toEqual(['S', 'E']);
    expect(titles(merged.featured)).toEqual(['F']);
    expect(mergeReleases(base, [], SELF)).toBe(base);

    const unknown = mergeReleases(
      base,
      [own('7', { title: 'U', kind: null, trackCount: null })],
      SELF,
    );
    expect(titles(unknown.albums)).toEqual(['A', 'U']);
    expect(titles(unknown.singles)).toEqual(['S']);

    const flat = layoutReleases(artistAlbumCatalog('7', true).slice(0, 2), SELF);
    const flatMerged = mergeReleases(flat, [own('8', { title: 'N', kind: 'single' })], SELF);
    expect(flatMerged.split).toBe(false);
    expect(flatMerged.albums).toHaveLength(3);
    expect(flatMerged.singles).toEqual([]);
  });

  it('试验页的样本 30 张：专辑与现场 15（含同名同日的一张）、参与 3、合集 2、单曲与 EP 10', () => {
    const layout = layoutReleases(artistAlbumCatalog('7'), SELF);
    expect(layout.split).toBe(true);
    expect(layout.compilations).toHaveLength(2);
    expect(layout.featured).toHaveLength(3);
    expect(layout.singles).toHaveLength(10);
    expect(layout.albums).toHaveLength(15);
  });
});

describe('艺人专辑的版本、查找与排序', () => {
  const albums = [
    own('1', { title: 'Alpha', subType: 'studio' }),
    own('2', { title: 'alpine live', subType: 'live' }),
    own('3', { title: 'Beta', subType: 'studio' }),
    own('4', { title: 'Gamma' }),
  ];

  it('版本选项只列有的、按固定顺序，没给版本类别的不计', () => {
    expect(versionOptions(albums)).toEqual([
      { value: 'studio', count: 2 },
      { value: 'live', count: 1 },
    ]);
    expect(versionOptions([own('1', { subType: undefined })])).toEqual([]);
  });

  it('种类选项只数上游标了单曲、EP 的，没标的不计；选了就只留这些种类', () => {
    const list = [
      own('1', { title: 'S1', kind: 'single' }),
      own('2', { title: 'S2', kind: 'single' }),
      own('3', { title: 'E1', kind: 'ep' }),
      own('4', { title: 'U', kind: null, trackCount: 2 }),
      own('5', { title: 'A', kind: 'album' }),
    ];
    expect(kindOptions(list)).toEqual([
      { value: 'single', count: 2 },
      { value: 'ep', count: 1 },
    ]);
    expect(kindOptions([own('1', { kind: null, trackCount: 2 })])).toEqual([]);
    const picked = (...values: ReleaseKind[]) => withKinds(list, new Set(values));
    expect(picked()).toBe(list);
    expect(titles(picked('ep'))).toEqual(['E1']);
    expect(titles(picked('single', 'ep'))).toEqual(['S1', 'S2', 'E1']);
  });

  it('数到 0 的选项不列，已勾的除外：勾了 EP 后版本栏只数 EP，另一栏的选择也不会让已勾的消失', () => {
    const list = [
      own('1', { title: 'S1', kind: 'single', subType: 'remix' }),
      own('2', { title: 'S2', kind: 'single', subType: 'studio' }),
      own('3', { title: 'E1', kind: 'ep', subType: 'studio' }),
    ];
    const ep = new Set<ReleaseKind>(['ep']);
    expect(versionOptions(withKinds(list, ep))).toEqual([{ value: 'studio', count: 1 }]);
    expect(versionOptions(list)).toEqual([
      { value: 'studio', count: 2 },
      { value: 'remix', count: 1 },
    ]);
    const remix = new Set<MusicAlbumSubType>(['remix']);
    expect(kindOptions(withVersions(list, remix), ep)).toEqual([
      { value: 'single', count: 1 },
      { value: 'ep', count: 0 },
    ]);
    expect(versionOptions(withKinds(list, ep), remix)).toEqual([
      { value: 'studio', count: 1 },
      { value: 'remix', count: 0 },
    ]);
  });

  it('什么都不选是全部；选了只留版本在其中的', () => {
    const picked = (...values: MusicAlbumSubType[]) => withVersions(albums, new Set(values));
    expect(picked()).toBe(albums);
    expect(titles(picked('live'))).toEqual(['alpine live']);
    expect(titles(picked('studio', 'live'))).toEqual(['Alpha', 'alpine live', 'Beta']);
  });

  it('按名称查找，不分大小写，空白当没查', () => {
    expect(titles(findReleases(albums, 'ALP'))).toEqual(['Alpha', 'alpine live']);
    expect(findReleases(albums, '  ')).toBe(albums);
    expect(findReleases(albums, 'zzz')).toEqual([]);
  });

  it('缺省按发行时间新到旧，没有日期的排最后，方向翻转时也一样', () => {
    const dated = [
      own('1', { title: 'B', releaseDate: '2020-01-01' }),
      own('2', { title: 'none', releaseDate: null }),
      own('3', { title: 'C', releaseDate: '2022-06-01' }),
      own('4', { title: 'A', releaseDate: '2020-01-01' }),
    ];
    expect(titles(sortReleases(dated, DEFAULT_RELEASE_SORT, collator))).toEqual([
      'C',
      'B',
      'A',
      'none',
    ]);
    expect(titles(sortReleases(dated, { field: 'date', descending: false }, collator))).toEqual([
      'B',
      'A',
      'C',
      'none',
    ]);
  });

  it('按名称与曲数排，名称按语言的次序，曲数缺的排最后', () => {
    const list = [
      own('1', { title: 'Album 10', trackCount: 12 }),
      own('2', { title: 'album 2', trackCount: null }),
      own('3', { title: 'Zed', trackCount: 3 }),
    ];
    expect(titles(sortReleases(list, naturalRelease('name'), collator))).toEqual([
      'album 2',
      'Album 10',
      'Zed',
    ]);
    expect(titles(sortReleases(list, naturalRelease('tracks'), collator))).toEqual([
      'Album 10',
      'Zed',
      'album 2',
    ]);
    expect(naturalRelease('date')).toEqual(DEFAULT_RELEASE_SORT);
  });
});
