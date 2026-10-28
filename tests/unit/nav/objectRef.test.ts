import { describe, expect, it } from 'vitest';
import { albumKeyOf } from '../../../src/host/libraryContract.ts';
import { placeOf, refKey, refOf, type ObjectRef } from '../../../src/nav/objectRef.ts';
import { EMPTY_GENRE, isPlainGenre, onlineListSubject } from '../../../src/nav/places.ts';

/** 每个种类一份样例；加种类时这里不补就过不了类型检查 */
const SAMPLES = {
  album: {
    kind: 'album',
    key: albumKeyOf({ name: 'A/B?#', albumArtist: 'X', albumId: undefined }),
  },
  artist: { kind: 'artist', name: 'Alice feat. Bob & C/D' },
  folder: { kind: 'folder', path: 'E:\\Music\\Alpha\\a.flac' },
  genre: { kind: 'genre', value: 'Hip-Hop/Jazz' },
  playlist: { kind: 'playlist', guid: '{0F8E7D6C-1234-4ABC-9DEF-001122334455}' },
  onlineList: {
    kind: 'onlineList',
    list: { kind: 'artist', ref: { platform: 'wy', id: '42' }, title: '某人' },
  },
  onlineAlbums: {
    kind: 'onlineAlbums',
    wall: {
      ref: { platform: 'wy', id: '42' },
      section: 'featured',
      name: '某人',
      query: '',
      sort: { field: 'date', descending: true },
      versions: ['live'],
    },
  },
} as const satisfies { [K in ObjectRef['kind']]: Extract<ObjectRef, { kind: K }> };

const ALL: readonly ObjectRef[] = Object.values(SAMPLES);

describe('objectRef', () => {
  it('每个种类经地点往返后不变；没有固定页面的种类没有地点', () => {
    const NO_PAGE: readonly ObjectRef['kind'][] = ['folder'];
    for (const ref of ALL) {
      const place = placeOf(ref);
      if (NO_PAGE.includes(ref.kind)) {
        expect(place).toBeNull();
        continue;
      }
      expect(place).not.toBeNull();
      expect(place === null ? null : refOf(place)).toEqual(ref);
    }
    expect(refOf({ id: 'folders', subject: '{"rootId":"E:\\Music"}' })).toBeNull();
  });

  it('对象对应各自的地点，主体沿用已有编码', () => {
    expect(placeOf(SAMPLES.album)).toEqual({ id: 'album', subject: 'A/B?#\0X' });
    expect(placeOf(SAMPLES.artist)).toEqual({ id: 'artists', subject: 'Alice feat. Bob & C/D' });
    expect(placeOf(SAMPLES.playlist)).toEqual({ id: 'playlist', subject: SAMPLES.playlist.guid });
    expect(placeOf(SAMPLES.genre)).toEqual({ id: 'genres', subject: 'Hip-Hop/Jazz' });
    expect(placeOf(SAMPLES.onlineList)).toEqual({
      id: 'onlineList',
      subject: onlineListSubject(SAMPLES.onlineList.list),
    });
  });

  it('流派只认单个标签原值：空串与保留前缀（没有流派、多选）没有页面，也认不回引用', () => {
    for (const value of ['', EMPTY_GENRE, `${EMPTY_GENRE}["A","B"]`])
      expect(placeOf({ kind: 'genre', value })).toBeNull();
    expect(refOf({ id: 'genres' })).toBeNull();
    for (const subject of ['', EMPTY_GENRE, `${EMPTY_GENRE}["A","B"]`])
      expect(refOf({ id: 'genres', subject })).toBeNull();
    expect(isPlainGenre('Jazz')).toBe(true);
    expect(isPlainGenre('')).toBe(false);
  });

  it('不是对象的地点、没有主体或主体损坏时没有引用', () => {
    expect(refOf({ id: 'albums' })).toBeNull();
    expect(refOf({ id: 'songs' })).toBeNull();
    expect(refOf({ id: 'artists' })).toBeNull();
    expect(refOf({ id: 'album', subject: '' })).toBeNull();
    expect(refOf({ id: 'playlist', subject: '' })).toBeNull();
    expect(refOf({ id: 'playlist' })).toBeNull();
    expect(refOf({ id: 'onlineList', subject: 'not json' })).toBeNull();
    expect(refOf({ id: 'search', subject: 'q' })).toBeNull();
  });

  it('键按对象身份区分种类，在线列表的标题不进键', () => {
    const keys = ALL.map(refKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(refKey({ kind: 'artist', name: 'X' })).not.toBe(
      refKey({ kind: 'album', key: albumKeyOf({ name: 'X', albumArtist: '', albumId: 'X' }) }),
    );
    const renamed: ObjectRef = {
      kind: 'onlineList',
      list: { ...SAMPLES.onlineList.list, title: '改名' },
    };
    expect(refKey(renamed)).toBe(refKey(SAMPLES.onlineList));
  });

  it('艺人专辑墙的键按艺人与哪一节区分，艺人名、查找与排序不进键', () => {
    const other: ObjectRef = {
      kind: 'onlineAlbums',
      wall: { ...SAMPLES.onlineAlbums.wall, section: 'albums' },
    };
    expect(refKey(other)).not.toBe(refKey(SAMPLES.onlineAlbums));
    const moved: ObjectRef = {
      kind: 'onlineAlbums',
      wall: {
        ...SAMPLES.onlineAlbums.wall,
        name: '改名',
        query: 'x',
        sort: { field: 'name', descending: false },
      },
    };
    expect(refKey(moved)).toBe(refKey(SAMPLES.onlineAlbums));
  });
});
