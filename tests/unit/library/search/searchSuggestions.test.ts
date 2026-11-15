import { describe, expect, it } from 'vitest';
import {
  SUGGESTION_METRICS,
  sameSong,
  searchSuggestions,
  type LocalSuggestions,
  type OnlineSuggestions,
} from '../../../../src/library/search/searchSuggestions.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';
import { musicAlbum, musicArtist, musicTrack } from '../../../fixtures/music.ts';

const { row, groupHead, sectionHead } = SUGGESTION_METRICS;

function local(albums: number, tracks: number, best = true): LocalSuggestions {
  const albumHits = Array.from({ length: albums }, (_, index) => ({
    kind: 'album' as const,
    album: albumRow(`Album ${index}`, 'Artist'),
  }));
  const trackHits = Array.from({ length: tracks }, (_, index) => ({
    kind: 'track' as const,
    track: trackRow('Album', `Track ${index}`),
  }));
  return {
    recent: ['旧词'],
    albums: albumHits,
    tracks: trackHits,
    best: best ? (albumHits[0] ?? null) : null,
  };
}

function online(artists: number, albums: number, tracks: number): OnlineSuggestions {
  return {
    kinds: ['artist', 'album', 'track'],
    result: {
      artists: Array.from({ length: artists }, (_, index) => musicArtist(`a${index}`)),
      albums: Array.from({ length: albums }, (_, index) => musicAlbum(`b${index}`)),
      tracks: Array.from({ length: tracks }, (_, index) => musicTrack(`t${index}`)),
    },
  };
}

const groups = (rows: ReturnType<typeof searchSuggestions>) => rows.map((item) => item.group);
const count = (rows: ReturnType<typeof searchSuggestions>, group: string) =>
  rows.filter((item) => item.group === group).length;

describe('搜索下拉的各行', () => {
  it('没有搜索词时是最近搜索', () => {
    expect(searchSuggestions(' ', local(3, 3), online(2, 2, 2), null)).toEqual([
      { key: 'recent:旧词', group: 'recent', text: '旧词' },
    ]);
  });

  it('媒体库在前、在线在后，各组到上限为止；最佳匹配那张不在专辑组里重复', () => {
    const rows = searchSuggestions('词', local(6, 9), online(5, 5, 9), null);
    expect(groups(rows)).toEqual([
      'best',
      ...Array<string>(3).fill('albums'),
      ...Array<string>(4).fill('tracks'),
      ...Array<string>(2).fill('onlineArtists'),
      ...Array<string>(3).fill('onlineAlbums'),
      ...Array<string>(4).fill('onlineTracks'),
    ]);
    expect(rows.filter((item) => item.group === 'albums').map((item) => item.key)).not.toContain(
      rows[0]?.key,
    );
  });

  it('不带在线一区时只有媒体库各组', () => {
    expect(groups(searchSuggestions('词', local(1, 2, false), null, null))).toEqual([
      'albums',
      'tracks',
      'tracks',
    ]);
  });
});

describe('按高度收条数', () => {
  it('放不下时每组先保 1 行，余下的按组的先后一轮一组加 1 行', () => {
    // 两个区标题、六组各 1 行之外，还能再放两行：落在最佳匹配之后的头两组（媒体库专辑、曲目）
    const budget = 2 * sectionHead + 6 * (groupHead + row) + 2 * row;
    const rows = searchSuggestions('词', local(6, 9), online(5, 5, 9), budget);
    expect([
      count(rows, 'best'),
      count(rows, 'albums'),
      count(rows, 'tracks'),
      count(rows, 'onlineArtists'),
      count(rows, 'onlineAlbums'),
      count(rows, 'onlineTracks'),
    ]).toEqual([1, 2, 2, 1, 1, 1]);
  });

  it('每组 1 行也放不下时仍各列 1 行，由下拉滚动', () => {
    const rows = searchSuggestions('词', local(6, 9), online(5, 5, 9), 100);
    expect(groups(rows)).toEqual([
      'best',
      'albums',
      'tracks',
      'onlineArtists',
      'onlineAlbums',
      'onlineTracks',
    ]);
  });

  it('在线结果到了不改媒体库的条数，在线各组只分预留与余下的高度', () => {
    const budget = 2 * sectionHead + 6 * (groupHead + row) + 4 * row;
    const waiting = searchSuggestions(
      '词',
      local(6, 9),
      { kinds: ['artist', 'album', 'track'], result: null },
      budget,
    );
    const arrived = searchSuggestions('词', local(6, 9), online(1, 0, 9), budget);
    const library = (rows: ReturnType<typeof searchSuggestions>) =>
      rows.filter((item) => !item.group.startsWith('online')).map((item) => item.key);
    expect(library(arrived)).toEqual(library(waiting));
    // 在线专辑没有结果，空出的高度留给在线曲目，不还给媒体库
    expect(count(arrived, 'onlineArtists')).toBe(1);
    expect(count(arrived, 'onlineTracks')).toBe(4);
  });

  it('只搜曲目的来源只为在线曲目预留高度', () => {
    const budget = 2 * sectionHead + 4 * (groupHead + row) + 3 * row;
    const rows = searchSuggestions('词', local(6, 9), { kinds: ['track'], result: null }, budget);
    expect([count(rows, 'best'), count(rows, 'albums'), count(rows, 'tracks')]).toEqual([1, 2, 2]);
  });
});

describe('同歌去重', () => {
  const mine = trackRow('Modal Soul', 'Feather', {
    artist: 'Nujabes feat. Cise Starr',
    duration: 175,
  });
  const theirs = (patch: Parameters<typeof musicTrack>[1]) =>
    musicTrack('1', { title: 'feather', durationMs: 176_500, ...patch });

  it('曲名相同、艺人对上一位、时长差不到 2 秒算同一首', () => {
    expect(sameSong(mine, theirs({}))).toBe(true);
    expect(sameSong(mine, theirs({ artists: [{ ref: null, name: 'Cise Starr' }] }))).toBe(true);
  });

  it('曲名、艺人或时长有一项对不上就不算', () => {
    expect(sameSong(mine, theirs({ title: 'Feather (Remix)' }))).toBe(false);
    expect(sameSong(mine, theirs({ artists: [{ ref: null, name: 'Other' }] }))).toBe(false);
    expect(sameSong(mine, theirs({ durationMs: 177_000 }))).toBe(false);
    expect(sameSong(mine, theirs({ durationMs: null }))).toBe(false);
  });

  it('下拉里与媒体库同一首的在线曲目不出，媒体库那首照常', () => {
    const library: LocalSuggestions = {
      recent: [],
      albums: [],
      tracks: [{ kind: 'track', track: mine }],
      best: null,
    };
    const rows = searchSuggestions(
      'feather',
      library,
      {
        kinds: ['track'],
        result: { artists: [], albums: [], tracks: [theirs({}), musicTrack('2')] },
      },
      null,
    );
    expect(rows.map((item) => item.key)).toEqual([expect.stringContaining('Feather'), 'online:2']);
  });
});
