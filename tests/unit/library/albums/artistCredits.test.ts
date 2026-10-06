import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { ArtistInfo } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALBUM_LIMIT } from '../../../../src/library/albums.ts';
import {
  artistCreditsAtom,
  startArtistCredits,
} from '../../../../src/library/albums/artistCredits.ts';
import { startBrowserPrefs } from '../../../../src/library/albums/browserPrefs.ts';
import { LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

function artist(name: string, albums: [string, string][]): ArtistInfo {
  return {
    name,
    albumCount: albums.length,
    trackCount: albums.length * 10,
    totalDuration: 0,
    albums: albums.map(([album, by]) => ({ name: album, artist: by })),
  };
}

const ITEMS = [
  artist('A', [
    ['Duet', 'A'],
    ['Guest Spot', 'C'],
  ]),
  artist('B', [['Duet', 'A']]),
  artist('', [['Nameless', 'X']]),
];

async function setup(host: UnitHost, dimension: 'artist' | 'genre') {
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  prefs.setDimension(dimension);
  await prefs.ready;
  const service = startArtistCredits(store, host.fb);
  await service.ready;
  return { store, prefs, service, state: () => store.get(artistCreditsAtom) };
}

describe('startArtistCredits', () => {
  it('分节依据是艺术家才取；专辑到署名的表按专辑键记，去掉没名字的艺术家', async () => {
    const host = installFakeHost();
    host.answer('library.getArtists', { success: true, items: ITEMS, count: ITEMS.length });
    const { state } = await setup(host, 'artist');
    expect(host.callsTo('library.getArtists')).toEqual([
      { limit: ALBUM_LIMIT, includeAlbums: true },
    ]);
    expect(state().status).toBe('ready');
    expect([...(state().credits ?? [])]).toEqual([
      ['Duet\0A', ['A', 'B']],
      ['Guest Spot\0C', ['A']],
    ]);
  });

  it('用不着时不取；切到艺术家档那一刻才取', async () => {
    const host = installFakeHost();
    const { prefs, state } = await setup(host, 'genre');
    expect(host.callsTo('library.getArtists')).toEqual([]);
    expect(state()).toMatchObject({ status: 'idle', credits: null });
    prefs.setDimension('artist');
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(host.callsTo('library.getArtists')).toHaveLength(1);
  });

  it('库变更按 1 s 合并重取；用不着时只记下过时，切回来再取', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { prefs } = await setup(host, 'artist');
    host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
    host.emit('library:itemsModified', { count: 1, timestamp: 2 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getArtists')).toHaveLength(2);
    prefs.setDimension('genre');
    host.emit('library:itemsRemoved', { count: 1, timestamp: 3 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getArtists')).toHaveLength(2);
    prefs.setDimension('artist');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.getArtists')).toHaveLength(3);
    prefs.setDimension('genre');
    prefs.setDimension('artist');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.getArtists')).toHaveLength(3);
  });

  it('失败时旧表留着；先发的重取晚到丢掉', async () => {
    const host = installFakeHost();
    host.answer('library.getArtists', { success: true, items: ITEMS, count: ITEMS.length });
    const { service, state } = await setup(host, 'artist');
    host.answer('library.getArtists', hostFailure('LIBRARY_DISABLED'));
    await service.retry();
    expect(state().status).toBe('failed');
    expect(state().credits?.size).toBe(2);
    const held = host.hold('library.getArtists');
    void service.retry();
    void service.retry();
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1, { success: true, items: [artist('Z', [['New', 'Z']])], count: 1 });
    held.respond(0, { success: true, items: ITEMS, count: ITEMS.length });
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect([...(state().credits?.keys() ?? [])]).toEqual(['New\0Z']);
  });
});
