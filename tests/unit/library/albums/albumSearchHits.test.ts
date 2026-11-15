import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  albumSearchHitsAtom,
  HIT_DEBOUNCE_MS,
  HIT_LIMIT,
  libraryQueryOf,
  startAlbumSearchHits,
} from '../../../../src/library/albums/albumSearchHits.ts';
import { TRACK_LIMIT } from '../../../../src/library/libraryTracks.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

function searchAnswer(tracks: LibraryTrackPartial[], total = tracks.length) {
  return { success: true as const, tracks, total, offset: 0, limit: HIT_LIMIT, hasMore: false };
}

function setup(host: UnitHost) {
  vi.useFakeTimers();
  const store = createStore();
  const service = startAlbumSearchHits(store, host.fb);
  return { service, state: () => store.get(albumSearchHitsAtom) };
}

describe('libraryQueryOf', () => {
  it('每个词加引号、空格连接；双引号换成空格，空词是空串', () => {
    expect(libraryQueryOf('  blue  train ')).toBe('"blue" "train"');
    expect(libraryQueryOf('say "hi"')).toBe('"say" "hi"');
    expect(libraryQueryOf(' " ')).toBe('');
  });
});

describe('startAlbumSearchHits', () => {
  it('去抖 300 ms 后发一次，只投影折专辑键要的字段；命中折成专辑键', async () => {
    const host = installFakeHost();
    host.answer(
      'library.search',
      searchAnswer([
        { album: 'Blue', albumArtists: [], artists: ['Joni Mitchell', 'X'] },
        { album: 'Kind of Blue', albumArtists: ['Miles Davis'], artists: ['Miles Davis'] },
        { album: '', albumArtists: [], artists: ['Nobody'] },
      ]),
    );
    const { service, state } = setup(host);
    service.search('bl');
    service.search('blue');
    expect(state().pending).toBe(true);
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS - 1);
    expect(host.callsTo('library.search')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.callsTo('library.search')).toEqual([
      {
        query: '"blue"',
        limit: HIT_LIMIT,
        fields: ['album', 'albumArtists', 'artists', 'albumId'],
      },
    ]);
    expect(state().pending).toBe(false);
    expect([...(state().hits ?? [])]).toEqual(['Blue\0Joni Mitchell', 'Kind of Blue\0Miles Davis']);
  });

  it('搜索命中保留 albumId，不合并显示名称相同的异常专辑与正常专辑', async () => {
    const host = installFakeHost();
    const normal = { album: '\uFFFD', albumArtists: ['X'], artists: ['X'] };
    host.answer(
      'library.search',
      searchAnswer([
        Object.assign({}, normal, { albumId: 'album1:b90058' }),
        Object.assign({}, normal, { albumId: 'album1:ba0058' }),
        normal,
      ]),
    );
    const { service, state } = setup(host);
    service.search('song');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect([...(state().hits ?? [])]).toEqual(['album1:b90058', 'album1:ba0058', '\uFFFD\0X']);
  });

  it('album artist 有多个值时按首值折，首值本身带「, 」也不拆', async () => {
    const host = installFakeHost();
    host.answer(
      'library.search',
      searchAnswer([
        {
          album: 'Deja Vu',
          albumArtists: ['Crosby, Stills', 'Nash'],
          artists: ['Neil Young'],
        },
      ]),
    );
    const { service, state } = setup(host);
    service.search('deja');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect([...(state().hits ?? [])]).toEqual(['Deja Vu\0Crosby, Stills']);
  });

  it('词一变就撤掉上一个词的命中，等新词的应答', async () => {
    const host = installFakeHost();
    host.answer(
      'library.search',
      searchAnswer([{ album: 'Blue', albumArtists: ['A'], artists: ['A'] }]),
    );
    const { service, state } = setup(host);
    service.search('blue');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state().hits?.size).toBe(1);
    service.search('blues');
    expect(state()).toEqual({ hits: null, pending: true, invalid: false });
  });

  it('只差空白或引号的词拼出同一个查询串：命中照旧，不撤也不重问', async () => {
    const host = installFakeHost();
    host.answer(
      'library.search',
      searchAnswer([{ album: 'Blue', albumArtists: ['A'], artists: ['A'] }]),
    );
    const { service, state } = setup(host);
    service.search('blue');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    service.search(' blue "');
    expect(state()).toEqual({ hits: new Set(['Blue\0A']), pending: false, invalid: false });
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(host.callsTo('library.search')).toHaveLength(1);
  });

  it('词一变，在路上的旧应答作废', async () => {
    const host = installFakeHost();
    const held = host.hold('library.search');
    const { service, state } = setup(host);
    service.search('old');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    service.search('new');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    held.respond(1, searchAnswer([{ album: 'New', albumArtists: ['A'], artists: ['A'] }]));
    await vi.advanceTimersByTimeAsync(0);
    held.respond(0, searchAnswer([{ album: 'Old', albumArtists: ['A'], artists: ['A'] }]));
    await vi.advanceTimersByTimeAsync(0);
    expect([...(state().hits ?? [])]).toEqual(['New\0A']);
  });

  it('命中超过上限当词太宽丢掉；失败静默；两种都不再 pending', async () => {
    const host = installFakeHost();
    host.answer('library.search', searchAnswer([], HIT_LIMIT + 1));
    const { service, state } = setup(host);
    service.search('a');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state()).toEqual({ hits: null, pending: false, invalid: false });
    host.answer('library.search', hostFailure('INVALID_PARAMS'));
    service.search('ab');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state()).toEqual({ hits: null, pending: false, invalid: false });
  });

  it('词清空立即清掉命中，排着的那一发不再发', async () => {
    const host = installFakeHost();
    const { service, state } = setup(host);
    service.search('blue');
    service.search('   ');
    expect(state()).toEqual({ hits: null, pending: false, invalid: false });
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(host.callsTo('library.search')).toEqual([]);
  });

  it('没连上宿主时不问，也不 pending', async () => {
    const host = installFakeHost({ available: false });
    const { service, state } = setup(host);
    service.search('blue');
    expect(state().pending).toBe(false);
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(host.calls).toEqual([]);
  });
});

describe('startAlbumSearchHits 的高级查询', () => {
  const hit = (album: string) => ({ album, albumArtists: ['A'], artists: ['A'] });

  it('去抖后把查询原样交宿主，不带排序，命中的曲目折成专辑键', async () => {
    const host = installFakeHost();
    host.answer('library.query', {
      success: true,
      tracks: [hit('Blue'), hit('Blue'), hit('Red')],
      total: 3,
    });
    const { service, state } = setup(host);
    service.query(' %rating% GREATER 3 ');
    expect(state()).toEqual({ hits: null, pending: true, invalid: false });
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS - 1);
    expect(host.callsTo('library.query')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    // 空排序不上线，宿主按库序答
    expect(host.callsTo('library.query')).toEqual([
      {
        query: '%rating% GREATER 3',
        limit: TRACK_LIMIT,
        fields: ['album', 'albumArtists', 'artists', 'albumId'],
      },
    ]);
    expect([...(state().hits ?? [])]).toEqual(['Blue\0A', 'Red\0A']);
    expect(state().pending).toBe(false);
  });

  it('命中多过普通搜索的上限也照用，不当词太宽丢掉', async () => {
    const host = installFakeHost();
    host.answer('library.query', {
      success: true,
      tracks: [hit('Blue')],
      total: HIT_LIMIT + 1,
    });
    const { service, state } = setup(host);
    service.query('ALL');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state().hits?.size).toBe(1);
  });

  it('边写边问：新答复回来前留着上一份命中，免得整面墙闪一下', async () => {
    const host = installFakeHost();
    host.answer('library.query', {
      success: true,
      tracks: [hit('Blue')],
      total: 1,
    });
    const { service, state } = setup(host);
    service.query('ALL');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    service.query('ALL AND genre IS Jazz');
    expect(state().pending).toBe(true);
    expect([...(state().hits ?? [])]).toEqual(['Blue\0A']);
  });

  it('宿主认不出：留着上一份命中、标出错；下一份答复落地时撤掉标记', async () => {
    const host = installFakeHost();
    host.answer('library.query', {
      success: true,
      tracks: [hit('Blue')],
      total: 1,
    });
    const { service, state } = setup(host);
    service.query('ALL');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    host.answer('library.query', hostFailure('INVALID_PARAMS'));
    service.query('ALL AND (');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state().invalid).toBe(true);
    expect(state().pending).toBe(false);
    expect([...(state().hits ?? [])]).toEqual(['Blue\0A']);
    host.answer('library.query', {
      success: true,
      tracks: [hit('Red')],
      total: 1,
    });
    service.query('ALL AND artist IS A');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state()).toEqual({ hits: new Set(['Red\0A']), pending: false, invalid: false });
  });

  it('别的失败不留命中，也不标出错', async () => {
    const host = installFakeHost();
    host.answer('library.query', hostFailure('OPERATION_FAILED'));
    const { service, state } = setup(host);
    service.query('ALL');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state()).toEqual({ hits: null, pending: false, invalid: false });
  });

  it('普通词与高级查询互换时，上一种的命中不能留到新答复回来', async () => {
    const host = installFakeHost();
    host.answer('library.search', searchAnswer([hit('Blue')]));
    const { service, state } = setup(host);
    service.search('blue');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state().hits?.size).toBe(1);
    service.query('ALL');
    expect(state()).toEqual({ hits: null, pending: true, invalid: false });
  });

  it('查询清空立即撤掉命中，排着的那一发不再发', async () => {
    const host = installFakeHost();
    const { service, state } = setup(host);
    service.query('ALL');
    service.query('   ');
    expect(state()).toEqual({ hits: null, pending: false, invalid: false });
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(host.callsTo('library.query')).toEqual([]);
  });
});
