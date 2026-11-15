import { describe, expect, it } from 'vitest';
import {
  favoriteKeyOf,
  readFavoriteKeys,
  readFavoriteList,
  readFavoriteRemoved,
  readFavoriteStamps,
} from '../../../src/server/musicFavorites.ts';
import { musicAlbum, musicTrack } from '../../fixtures/music.ts';

const EMPTY = { track: [], album: [], artist: [], playlist: [] };

describe('本地收藏的协议读取', () => {
  it('键表：每类一个数组，每行是平台、ID、收藏时间；重复、缺类、多类、坏行都不要', () => {
    const keys = {
      ...EMPTY,
      track: [
        ['wy', '1', 5],
        ['wy', '2', 3],
      ],
      album: [['wy', '1', 9]],
    };
    expect(readFavoriteKeys(keys)).toEqual(keys);
    for (const bad of [
      {
        ...EMPTY,
        track: [
          ['wy', '1', 5],
          ['wy', '1', 6],
        ],
      },
      { track: [], album: [], artist: [] },
      { ...EMPTY, radio: [] },
      { ...EMPTY, track: [['xx', '1', 5]] },
      { ...EMPTY, track: [['wy', '', 5]] },
      { ...EMPTY, track: [['wy', '1', -1]] },
      { ...EMPTY, track: [['wy', '1']] },
      { ...EMPTY, track: 'none' },
    ])
      expect(readFavoriteKeys(bad)).toBeNull();
  });

  it('同一个 ID 在不同类里是两条，各类的键互不影响', () => {
    expect(favoriteKeyOf('track', { platform: 'wy', id: '1' })).not.toBe(
      favoriteKeyOf('album', { platform: 'wy', id: '1' }),
    );
  });

  it('一页条目：只收请求的那一类，重复或坏条目整页不要，对象只留协议里的字段', () => {
    const entry = (kind: string, item: unknown, addedAt = 1) => ({ kind, item, addedAt });
    const page = {
      items: [entry('track', { ...musicTrack('1'), extra: 'x' })],
      nextCursor: null,
      total: 1,
    };
    expect(readFavoriteList(page, 'track')).toEqual({
      items: [{ kind: 'track', item: musicTrack('1'), addedAt: 1 }],
      nextCursor: null,
      total: 1,
    });
    expect(readFavoriteList(page, 'album')).toBeNull();
    for (const items of [
      [entry('track', musicTrack('1')), entry('track', musicTrack('1'))],
      [entry('track', { title: '缺字段' })],
      [entry('track', musicTrack('1'), -1)],
      [entry('album', musicAlbum('1'))],
    ])
      expect(readFavoriteList({ items, nextCursor: null, total: 1 }, 'track')).toBeNull();
    expect(readFavoriteList({ ...page, nextCursor: 'has space' }, 'track')).toBeNull();
    expect(readFavoriteList({ ...page, total: -1 }, 'track')).toBeNull();
  });

  it('各项的收藏时间与取消数：形状不对不要', () => {
    expect(readFavoriteStamps([{ ref: { platform: 'wy', id: '1' }, addedAt: 3 }])).toEqual([
      { ref: { platform: 'wy', id: '1' }, addedAt: 3 },
    ]);
    expect(readFavoriteStamps([{ ref: { platform: 'wy' }, addedAt: 3 }])).toBeNull();
    expect(readFavoriteStamps([{ ref: { platform: 'wy', id: '1' }, addedAt: 1.5 }])).toBeNull();
    expect(readFavoriteStamps(Array.from({ length: 101 }, () => ({})))).toBeNull();
    expect(readFavoriteRemoved({ removed: 2 })).toBe(2);
    for (const bad of [{ removed: -1 }, { removed: 101 }, { removed: '1' }, null, {}])
      expect(readFavoriteRemoved(bad)).toBeNull();
  });
});
