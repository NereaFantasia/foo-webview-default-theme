import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlaylistTypeSearch,
  TYPE_SEARCH_DEBOUNCE_MS,
  TYPE_SEARCH_EXPIRY_MS,
  type PlaylistTypeSearchTarget,
} from '../../../src/playlist/playlistTypeSearch.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);

afterEach(() => {
  vi.useRealTimers();
});

function setup(host: UnitHost, total = 300) {
  const lists = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true })],
    (event, payload) => host.emit(event, payload),
  );
  lists.setTracks(
    MAIN,
    Array.from({ length: total }, (_, row) =>
      makeRow('Main', row, {
        title: row === 250 ? 'Zebra' : `Song ${row}`,
        album: 'Album',
        albumArtist: row === 280 ? 'Zeppelin' : 'Artist',
      }),
    ),
  );
  let target: PlaylistTypeSearchTarget = { guid: MAIN, total, hits: null };
  const located: number[] = [];
  let visible = true;
  const search = createPlaylistTypeSearch(
    () => target,
    (row) => {
      located.push(row);
      return visible;
    },
    host.fb,
  );
  return {
    lists,
    search,
    located,
    retarget: (next: Partial<PlaylistTypeSearchTarget>) => {
      target = { ...target, ...next };
    },
    hide: () => {
      visible = false;
    },
  };
}

const type = (search: { input(key: string): boolean }, text: string) =>
  [...text].map((key) => search.input(key));

describe('createPlaylistTypeSearch', () => {
  it('静默一阵才翻页找；专辑艺术家的命中压过更早的标题命中；找完一阵清串', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { search, located } = setup(host);
    expect(type(search, 'ze')).toStrictEqual([true, true]);
    expect(search.state.text).toBe('ze');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS - 1);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(located).toStrictEqual([280]);
    expect(search.state).toMatchObject({ noMatch: false, scanning: false });
    const pages = host.callsTo('playlist.getTracks');
    expect(pages.map((page) => page['start'])).toStrictEqual([0, 200]);
    expect(pages[0]?.['fields']).toStrictEqual(['index', 'albumArtist', 'title', 'album']);
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_EXPIRY_MS);
    expect(search.state.text).toBe('');
  });

  it('过滤态只在命中里找，落的是真实行号；那一行此刻看不见也算没找到', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { search, located, retarget, hide } = setup(host);
    const row = (title: string) => ({ albumArtist: 'A', title, album: 'B' });
    retarget({
      hits: [
        { index: 7, row: row('alpha') },
        { index: 42, row: row('beta') },
      ],
    });
    type(search, 'b');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    expect(located).toStrictEqual([42]);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(0);
    hide();
    search.clear();
    type(search, 'a');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    expect(search.state.noMatch).toBe(true);
  });

  it('Backspace 退一格、重新计时；Esc 不归它；首字符空白与控制键不收，串长到上限吞掉后续键', () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { search } = setup(host);
    expect(search.input(' ')).toBe(false);
    expect(search.input('Escape')).toBe(false);
    expect(search.input('Enter')).toBe(false);
    expect(search.input('Backspace')).toBe(false);
    type(search, 'ab');
    expect(search.input('Backspace')).toBe(true);
    expect(search.state.text).toBe('a');
    type(search, '𝄞'.repeat(25));
    expect([...search.state.text]).toHaveLength(20);
  });

  it('新键进来之后旧扫描的应答不再落焦点；换了列表或过滤就作罢', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { search, located, retarget } = setup(host);
    const held = host.hold('playlist.getTracks');
    type(search, 'z');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    search.input('x');
    held.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(located).toStrictEqual([]);
    const again = host.hold('playlist.getTracks');
    search.clear();
    type(search, 'z');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    retarget({ total: 299 });
    again.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(located).toStrictEqual([]);
    // 作罢的那一串清掉，不停在「在找」上，之后的空格不被当成续串吞掉。
    expect(search.state).toMatchObject({ text: '', scanning: false });
    expect(search.input(' ')).toBe(false);
  });

  it('取行失败与没找到分开报；页的总数对不上也算失败，不落一个看似合理的行号', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { search, located } = setup(host);
    host.answer('playlist.getTracks', hostFailure('INTERNAL_ERROR'));
    type(search, 'z');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    expect(search.state).toMatchObject({ failed: true, noMatch: false, scanning: false });
    host.answer('playlist.getTracks', {
      success: true,
      playlist: 0,
      start: 0,
      count: 1,
      total: 1,
      tracks: [{ index: 0, albumArtist: 'Zed' }],
    });
    search.clear();
    type(search, 'z');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    expect(search.state.failed).toBe(true);
    expect(located).toStrictEqual([]);
  });

  it('释放之后定时器清掉，晚到的应答不管', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { search, located } = setup(host);
    const held = host.hold('playlist.getTracks');
    type(search, 'z');
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_DEBOUNCE_MS);
    search.dispose();
    held.release();
    await vi.advanceTimersByTimeAsync(TYPE_SEARCH_EXPIRY_MS * 2);
    expect(located).toStrictEqual([]);
    expect(search.input('a')).toBe(false);
  });
});
