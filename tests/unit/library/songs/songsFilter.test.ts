import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SONGS_FILTER,
  sameSongsFilter,
  songsFilterAtom,
  songsQueryOf,
  startSongsFilter,
} from '../../../../src/library/songs/songsFilter.ts';
import { toggleSongFacet } from '../../../../src/library/songs/songsFacets.ts';

describe('筛选拼成查询', () => {
  it('什么都不筛时是整个媒体库', () => {
    expect(songsQueryOf(EMPTY_SONGS_FILTER, 'all')).toEqual({
      query: 'ALL',
      raw: false,
      words: [],
      filtered: false,
    });
    expect(songsQueryOf({ ...EMPTY_SONGS_FILTER, text: '?' }, 'all').filtered).toBe(true);
  });

  it('词、预设与分面几段都要成立，各加括号', () => {
    const filter = {
      ...EMPTY_SONGS_FILTER,
      text: 'Live',
      presets: new Set(['lossless'] as const),
      facets: toggleSongFacet(EMPTY_SONGS_FILTER.facets, 'genre', 'Jazz'),
    };
    expect(songsQueryOf(filter, 'title')).toEqual({
      query: '(title HAS "live") AND (%__encoding% IS lossless) AND (genre IS "Jazz")',
      raw: false,
      words: ['live'],
      filtered: true,
    });
  });

  it('框里写的是查询时原样放进去', () => {
    const filter = {
      ...EMPTY_SONGS_FILTER,
      mode: 'advanced' as const,
      text: 'ignored draft',
      advancedText: '%bitrate% GREATER 900 OR genre HAS jazz',
    };
    const query = songsQueryOf(filter, 'all');
    expect(query.raw).toBe(true);
    expect(query.query).toBe('%bitrate% GREATER 900 OR genre HAS jazz');
    const both = songsQueryOf({ ...filter, presets: new Set(['long'] as const) }, 'all');
    expect(both.query).toBe(
      '(%bitrate% GREATER 900 OR genre HAS jazz) AND (%length_seconds% GREATER 600)',
    );
  });
});

describe('筛选服务', () => {
  it('显式切换保留独立草稿，清词与清条件不影响另一模式，快照恢复两份草稿', () => {
    const store = createStore();
    const filter = startSongsFilter(store);
    filter.setText('100% ? live');
    expect(songsQueryOf(store.get(songsFilterAtom), 'title')).toMatchObject({
      raw: false,
      words: ['100%', '?', 'live'],
    });
    filter.setQuery({ ...store.get(songsFilterAtom), mode: 'advanced' });
    expect(songsQueryOf(store.get(songsFilterAtom), 'title').filtered).toBe(false);
    filter.setText('%codec% IS flac');
    filter.togglePreset('lossless');
    const saved = store.get(songsFilterAtom);
    filter.setText('');
    filter.clearConditions();
    expect(store.get(songsFilterAtom)).toMatchObject({ text: '100% ? live', advancedText: '' });
    filter.restore(saved);
    expect(store.get(songsFilterAtom)).toBe(saved);
    filter.setQuery({ ...saved, mode: 'text' });
    expect(songsQueryOf(store.get(songsFilterAtom), 'title').raw).toBe(false);
    expect(store.get(songsFilterAtom).advancedText).toBe('%codec% IS flac');
    expect(sameSongsFilter(saved, store.get(songsFilterAtom))).toBe(false);
  });

  it('勾预设时去掉冲突的；清条件留着框里的字；全部清掉回到空的', () => {
    const store = createStore();
    const filter = startSongsFilter(store);
    filter.setText('live');
    filter.togglePreset('highRated');
    filter.togglePreset('unrated');
    expect([...store.get(songsFilterAtom).presets]).toEqual(['unrated']);
    filter.toggleFacet('decade', '1990s');
    filter.clearConditions();
    expect(store.get(songsFilterAtom).text).toBe('live');
    expect(store.get(songsFilterAtom).presets.size).toBe(0);
    filter.clear();
    expect(sameSongsFilter(store.get(songsFilterAtom), EMPTY_SONGS_FILTER)).toBe(true);
  });

  it('交还快照：一样就不换，免得订阅的一方白跑一遍', () => {
    const store = createStore();
    const filter = startSongsFilter(store);
    const before = store.get(songsFilterAtom);
    filter.restore({ ...EMPTY_SONGS_FILTER, presets: new Set() });
    expect(store.get(songsFilterAtom)).toBe(before);
    filter.restore({ ...EMPTY_SONGS_FILTER, text: 'x' });
    expect(store.get(songsFilterAtom).text).toBe('x');
  });
});
