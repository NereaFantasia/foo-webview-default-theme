import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { songsRowsAtom } from '../../../../src/library/songs/songsRows.ts';
import {
  songsFillAtom,
  startSongs,
  TYPING_DEBOUNCE_MS,
} from '../../../../src/library/songs/songsServices.ts';
import { SONGS_SORT } from '../../../../src/library/songs/songsSort.ts';
import { songsFilterAtom } from '../../../../src/library/songs/songsFilter.ts';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import { stringParam } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const host = installFakeHost();
  host.answer('library.query', (params) => ({
    success: true,
    tracks: [{ index: 0, handle: stringParam(params, 'query') ?? '' }],
    total: 1,
  }));
  const store = createStore();
  const history = startNavHistory(store);
  const songs = startSongs(store, { history, record: () => {} }, host.fb);
  onTestFinished(() => songs.dispose());
  const queries = () => host.callsTo('library.query').map((call) => call['query']);
  return { host, store, songs, queries, history };
}

describe('歌曲页的装配', () => {
  it('从流派打开：只留指定流派，清掉词、预设与其他分面，后退回原地点', () => {
    const { store, songs, history } = setup();
    history.navigate({ id: 'genres', subject: 'Jazz' });
    songs.filter.setText('live');
    songs.filter.togglePreset('lossless');
    songs.filter.toggleFacet('artist', 'Nujabes');
    songs.filter.toggleFacet('decade', '1990s');
    songs.filter.toggleFacet('genre', 'Rock');
    expect(songs.openWithGenres(['Jazz', 'Hip-Hop', 'Jazz'])).toBe(true);
    expect(store.get(songsFilterAtom)).toEqual({
      mode: 'text',
      text: '',
      advancedText: '',
      presets: new Set(),
      facets: { genre: new Set(['Jazz', 'Hip-Hop']), decade: new Set(), artist: new Set() },
    });
    expect(store.get(songsFillAtom).query).toBe('(genre IS "Jazz" OR genre IS "Hip-Hop")');
    expect(store.get(historyAtom).place).toEqual({ id: 'songs' });
    history.back();
    expect(store.get(historyAtom).place).toEqual({ id: 'genres', subject: 'Jazz' });
  });

  it('流派值不安全、没有指定值或服务已释放时，筛选与地点不变', () => {
    const { store, songs } = setup();
    songs.filter.setText('live');
    for (const names of [[], ['*'], ['Jazz', 'A"B'], ['?'], ['']]) {
      expect(songs.openWithGenres(names)).toBe(false);
    }
    songs.dispose();
    expect(songs.openWithGenres(['Jazz'])).toBe(false);
    expect(store.get(songsFilterAtom).text).toBe('live');
    expect(store.get(historyAtom).place).toEqual({ id: 'albums' });
  });

  it('缺省按艺术家升序排整个媒体库', () => {
    const { store } = setup();
    expect(store.get(songsFillAtom)).toEqual({
      query: 'ALL',
      sort: SONGS_SORT.artist,
      descending: false,
    });
  });

  it('打字等一阵再问宿主，勾预设与换排序马上问', async () => {
    const { host, store, songs, queries } = setup();
    songs.rows.acquire();
    await vi.waitFor(() => expect(store.get(songsRowsAtom).status).toBe('ready'));
    vi.useFakeTimers();
    songs.filter.setText('nu');
    songs.filter.setText('nuj');
    await vi.advanceTimersByTimeAsync(TYPING_DEBOUNCE_MS - 1);
    expect(queries()).toEqual(['ALL']);
    await vi.advanceTimersByTimeAsync(1);
    expect(queries()).toEqual(['ALL', expect.stringContaining('"nuj"')]);
    songs.filter.togglePreset('lossless');
    await vi.advanceTimersByTimeAsync(0);
    expect(queries()).toHaveLength(3);
    songs.prefs.sortBy('title');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.query').at(-1)).toMatchObject({ sort: SONGS_SORT.title });
  });

  it('高级模式立即切换，编辑高级草稿仍去抖，回车立即发送', async () => {
    const { store, songs, queries } = setup();
    songs.rows.acquire();
    await vi.waitFor(() => expect(store.get(songsRowsAtom).status).toBe('ready'));
    vi.useFakeTimers();
    songs.filter.setQuery({
      mode: 'advanced',
      text: 'not active',
      advancedText: '%codec% IS flac',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(queries().at(-1)).toBe('%codec% IS flac');
    songs.filter.setText('%codec% IS mp3');
    await vi.advanceTimersByTimeAsync(TYPING_DEBOUNCE_MS - 1);
    expect(queries().at(-1)).toBe('%codec% IS flac');
    songs.rows.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(queries().at(-1)).toBe('%codec% IS mp3');
    expect(store.get(songsFilterAtom).text).toBe('not active');
  });
});
