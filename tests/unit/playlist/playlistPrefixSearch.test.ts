import { describe, expect, it } from 'vitest';
import { findPlaylistPrefix } from '../../../src/playlist/playlistPrefixSearch.ts';

describe('findPlaylistPrefix', () => {
  it('后页的专辑艺术家命中压过前页的标题命中，同时只留一页', async () => {
    const calls: number[] = [];
    const index = await findPlaylistPrefix('Alpha', {
      total: 201,
      current: () => true,
      page: async (start, count) => {
        calls.push(start);
        return Array.from({ length: Math.min(count, 201 - start) }, (_, at) =>
          start + at === 200
            ? { albumArtist: 'ALPHA artist' }
            : { title: start + at === 0 ? 'Alpha title' : 'Other' },
        );
      },
    });
    expect(index).toBe(200);
    expect(calls).toStrictEqual([0, 200]);
  });

  it('标题排在专辑前，只认前缀不认子串', async () => {
    expect(
      await findPlaylistPrefix('sun', {
        total: 4,
        current: () => true,
        page: async () => [
          { albumArtist: 'The Sun' },
          { album: 'Sun album' },
          { title: 'Sun title' },
          { title: 'Sun second' },
        ],
      }),
    ).toBe(2);
  });

  it('专辑艺术家命中了就不再要后面的页', async () => {
    let calls = 0;
    expect(
      await findPlaylistPrefix('hit', {
        total: 100_000,
        current: () => true,
        page: async () => {
          calls += 1;
          return [{ albumArtist: 'Hit' }];
        },
      }),
    ).toBe(0);
    expect(calls).toBe(1);
  });

  it('途中作废了不答退而求其次的命中，也不再要下一页', async () => {
    let current = true;
    let calls = 0;
    expect(
      await findPlaylistPrefix('hit', {
        total: 500,
        current: () => current,
        page: async () => {
          calls += 1;
          current = false;
          return [{ title: 'Hit' }];
        },
      }),
    ).toBe(-1);
    expect(calls).toBe(1);
  });

  it('缺了或不是字符串的字段不算命中', async () => {
    expect(
      await findPlaylistPrefix('object', {
        total: 4,
        current: () => true,
        page: async () => [null, {}, { albumArtist: {} }, { title: 42 }],
      }),
    ).toBe(-1);
  });
});
