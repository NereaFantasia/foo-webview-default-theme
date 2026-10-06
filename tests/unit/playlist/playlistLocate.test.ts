import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCATE_TIMEOUT_MS, startPlaylistLocate } from '../../../src/playlist/playlistLocate.ts';
import { startPlaylistRows } from '../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const OTHER = guidOf(1);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.useRealTimers();
});

async function setup(host: UnitHost) {
  const lists = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount: 10 }),
      makePlaylist(1, 'Other', { trackCount: 20 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  const playingKey = atom('song');
  const opened: string[] = [];
  const locate = startPlaylistLocate(
    store,
    { places: { open: (guid) => opened.push(guid) }, rows, playingKey },
    host.fb,
  );
  await Promise.all([playlists.ready, rows.ready]);
  await wait();
  return {
    lists,
    store,
    rows,
    locate,
    opened,
    playingKey,
    request: () => store.get(locate.requestAtom),
    failed: () => store.get(locate.failedAtom),
  };
}

describe('startPlaylistLocate', () => {
  it('问到在播的位置，换回 GUID 去那张列表，把那一行交给页面；页面交还后收起', async () => {
    const host = installFakeHost();
    const { lists, locate, opened, request } = await setup(host);
    await host.fb.playlist.playTrack(OTHER, 7);
    const plays = host.callsTo('playlist.playTrack').length;
    await locate.locate();
    expect(opened).toStrictEqual([OTHER]);
    expect(request()).toStrictEqual({ guid: OTHER, row: 7, tick: 1 });
    locate.done(0);
    expect(request()).not.toBeNull();
    locate.done(1);
    expect(request()).toBeNull();
    expect(host.callsTo('playlist.playTrack')).toHaveLength(plays);
    expect(lists.activeGuid()).toBe(MAIN);
  });

  it('没在播或在播的不在任何列表里：什么也不做，不算失败', async () => {
    const host = installFakeHost();
    const { locate, opened, request, failed, store, playingKey } = await setup(host);
    await locate.locate();
    expect([opened, request(), failed()]).toStrictEqual([[], null, false]);
    store.set(playingKey, '');
    await locate.locate();
    expect(host.callsTo('playback.getCurrentTrackIndex')).toHaveLength(1);
  });

  it('读不到位置、或序号认不回列表：记失败，不去任何地方', async () => {
    const host = installFakeHost();
    const { locate, opened, failed } = await setup(host);
    host.answer('playback.getCurrentTrackIndex', hostFailure('INTERNAL_ERROR'));
    await locate.locate();
    expect(failed()).toBe(true);
    host.answer('playback.getCurrentTrackIndex', {
      playlistGuid: guidOf(9),
      success: true,
      found: true,
      playlist: 9,
      index: 0,
    });
    await locate.locate();
    expect(failed()).toBe(true);
    expect(opened).toStrictEqual([]);
    locate.dismissFailure();
    expect(failed()).toBe(false);
  });

  it('在播的是宿主自己建的列表：同没在播一样什么也不做，不算失败', async () => {
    const host = installFakeHost();
    const { lists, locate, opened, request, failed } = await setup(host);
    await host.fb.playlist.create('[WebView Queue]');
    await wait();
    host.answer('playback.getCurrentTrackIndex', {
      success: true,
      found: true,
      playlist: 2,
      playlistGuid: lists.guid('[WebView Queue]'),
      index: 0,
    });
    await locate.locate();
    expect([opened, request(), failed()]).toStrictEqual([[], null, false]);
  });

  it('问的途中换了曲或又发起一次，旧应答作废', async () => {
    const host = installFakeHost();
    const { locate, opened, store, playingKey } = await setup(host);
    await host.fb.playlist.playTrack(MAIN, 3);
    const held = host.hold('playback.getCurrentTrackIndex');
    const first = locate.locate();
    await wait();
    store.set(playingKey, 'next song');
    held.release();
    await first;
    expect(opened).toStrictEqual([]);
  });

  it('等页面交还期间换了曲、那张列表的行变了，请求作废；超时算失败', async () => {
    const host = installFakeHost();
    const { locate, request, failed, store, playingKey, rows } = await setup(host);
    rows.acquire(MAIN);
    await wait(50);
    await host.fb.playlist.playTrack(MAIN, 3);
    await locate.locate();
    store.set(playingKey, 'other');
    expect(request()).toBeNull();
    store.set(playingKey, 'song');
    await locate.locate();
    await host.fb.playlist.removeTracks(MAIN, [0]);
    await wait(400);
    expect(request()).toBeNull();
    expect(failed()).toBe(false);
    vi.useFakeTimers();
    await locate.locate();
    expect(request()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS);
    expect(request()).toBeNull();
    expect(failed()).toBe(true);
  });

  it('释放之后不再发请求', async () => {
    const host = installFakeHost();
    const { locate, request } = await setup(host);
    await host.fb.playlist.playTrack(MAIN, 1);
    locate.dispose();
    await locate.locate();
    expect(request()).toBeNull();
  });
});
