import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  albumText,
  artistText,
  keepRemoved,
  queryWords,
  trackRows,
  trackText,
  wallRows,
  withKept,
} from '../../../../src/library/favorites/favoritesRows.ts';
import type { FavoriteEntry } from '../../../../src/server/musicFavorites.ts';
import { musicAlbum, musicArtist, musicTrack } from '../../../fixtures/music.ts';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const entry = (id: string, addedAt: number, patch = {}): FavoriteEntry<'track'> => ({
  kind: 'track',
  item: musicTrack(id, patch),
  addedAt,
});
const ids = (rows: readonly FavoriteEntry<'track'>[]) => rows.map((row) => row.item.ref.id);

describe('收藏页的查找与排序', () => {
  const rows = [
    entry('1', 100, { title: 'Banana', durationMs: 200000 }),
    entry('2', 300, { title: 'apple', durationMs: null }),
    entry('3', 200, { title: 'Cherry', durationMs: 100000 }),
  ];

  it('缺省收藏时间新到旧，升序反过来；值相同的按收藏时间新到旧', () => {
    expect(ids(trackRows(rows, '', DEFAULT_SORT, collator))).toEqual(['2', '3', '1']);
    expect(ids(trackRows(rows, '', { field: 'added', descending: false }, collator))).toEqual([
      '1',
      '3',
      '2',
    ]);
    const same = [entry('a', 1, { title: '同名' }), entry('b', 5, { title: '同名' })];
    expect(ids(trackRows(same, '', { field: 'title', descending: false }, collator))).toEqual([
      'b',
      'a',
    ]);
  });

  it('按标题、时长排；没有时长的排在升序的最前', () => {
    expect(ids(trackRows(rows, '', { field: 'title', descending: false }, collator))).toEqual([
      '2',
      '1',
      '3',
    ]);
    expect(ids(trackRows(rows, '', { field: 'duration', descending: false }, collator))).toEqual([
      '2',
      '3',
      '1',
    ]);
    expect(ids(trackRows(rows, '', { field: 'duration', descending: true }, collator))).toEqual([
      '1',
      '3',
      '2',
    ]);
  });

  it('查找：不分大小写，每个词都要出现；标题、别名、署名及其别名、专辑名都算', () => {
    const named = [
      entry('1', 3, {
        title: '夜に駆ける',
        aliases: ['向夜晚奔去'],
        artists: [{ ref: null, name: 'YOASOBI', aliases: ['夜游', 'ヨアソビ'] }],
        album: { ref: null, title: 'THE BOOK' },
      }),
      entry('2', 2, {
        title: '十年',
        artists: [{ ref: null, name: '陈奕迅', aliases: ['Eason Chan'] }],
      }),
    ];
    const found = (query: string) => ids(trackRows(named, query, DEFAULT_SORT, collator));
    expect(found('向夜晚')).toEqual(['1']);
    expect(found('EASON chan')).toEqual(['2']);
    expect(found('yoasobi book')).toEqual(['1']);
    expect(found('yoasobi 十年')).toEqual([]);
    expect(found('  ')).toEqual(['1', '2']);
    expect(trackText(named[0]!.item)).toContain('ヨアソビ');
    expect(queryWords(' A  b ')).toEqual(['a', 'b']);
  });

  it('封面墙：按名称或收藏时间排，艺人的别名也能查到', () => {
    const artists = [
      { kind: 'artist' as const, item: musicArtist('1', { name: 'Zed' }), addedAt: 1 },
      {
        kind: 'artist' as const,
        item: musicArtist('2', { name: 'Alpha', aliases: ['阿尔法'] }),
        addedAt: 2,
      },
    ];
    const names = (list: readonly { item: { name: string } }[]) => list.map((row) => row.item.name);
    const byName = { field: 'name', descending: false } as const;
    expect(names(wallRows(artists, '', byName, collator, artistText, (a) => a.name))).toEqual([
      'Alpha',
      'Zed',
    ]);
    expect(names(wallRows(artists, '', DEFAULT_SORT, collator, artistText, (a) => a.name))).toEqual(
      ['Alpha', 'Zed'],
    );
    expect(
      names(wallRows(artists, '阿尔', DEFAULT_SORT, collator, artistText, (a) => a.name)),
    ).toEqual(['Alpha']);
    const albums = [{ kind: 'album' as const, item: musicAlbum('9'), addedAt: 1 }];
    expect(albumText(albums[0]!.item)).toContain('Nujabes');
  });
});

describe('本页取消过收藏的条目留在页里', () => {
  const a = entry('a', 300);
  const b = entry('b', 200);
  const c = entry('c', 100);
  const shown = (live: readonly FavoriteEntry<'track'>[], kept: ReadonlyMap<string, typeof a>) =>
    ids(trackRows(withKept(live, kept).rows, '', DEFAULT_SORT, collator));

  it('不见了的留下来、按原来的收藏时间排，页面据此知道哪几行已经不在收藏里', () => {
    const kept = keepRemoved([a, b, c], [a, c], new Map());
    expect([...kept.keys()]).toEqual(['b']);
    const { rows, removed } = withKept([a, c], kept);
    expect(shown([a, c], kept)).toEqual(['a', 'b', 'c']);
    expect(rows).toHaveLength(3);
    expect([...removed]).toEqual(['b']);
  });

  it('收回来的用留着的那份：收藏时间变新了行也不跳到最前，也不再算已取消', () => {
    const kept = keepRemoved([a, b, c], [a, c], new Map());
    const again = entry('b', 999);
    const { removed } = withKept([again, a, c], kept);
    expect(shown([again, a, c], kept)).toEqual(['a', 'b', 'c']);
    expect(removed.size).toBe(0);
    // 再取消一次：留的仍是第一次的那份，没有换成新的
    expect(keepRemoved([again, a, c], [a, c], kept)).toBe(kept);
  });

  it('没有取消过就原样交还此刻的条目', () => {
    const live = [a, b];
    expect(keepRemoved(live, live, new Map()).size).toBe(0);
    expect(withKept(live, new Map()).rows).toBe(live);
  });
});
