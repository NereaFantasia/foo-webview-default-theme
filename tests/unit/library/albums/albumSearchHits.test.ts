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
      { query: '"blue"', limit: HIT_LIMIT, fields: ['album', 'albumArtists', 'artists'] },
    ]);
    expect(state().pending).toBe(false);
    expect([...(state().hits ?? [])]).toEqual(['Blue\0Joni Mitchell', 'Kind of Blue\0Miles Davis']);
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
    expect(state()).toEqual({ hits: null, pending: true });
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
    expect(state()).toEqual({ hits: new Set(['Blue\0A']), pending: false });
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
    expect(state()).toEqual({ hits: null, pending: false });
    host.answer('library.search', hostFailure('INVALID_PARAMS'));
    service.search('ab');
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state()).toEqual({ hits: null, pending: false });
  });

  it('词清空立即清掉命中，排着的那一发不再发', async () => {
    const host = installFakeHost();
    const { service, state } = setup(host);
    service.search('blue');
    service.search('   ');
    expect(state()).toEqual({ hits: null, pending: false });
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
