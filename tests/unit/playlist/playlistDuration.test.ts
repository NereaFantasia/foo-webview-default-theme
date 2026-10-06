import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startPlaylistDuration } from '../../../src/playlist/playlistDuration.ts';
import { startPlaylistRows } from '../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const OTHER = guidOf(1);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function start(host: UnitHost) {
  const lists = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount: 2 }),
      makePlaylist(1, 'Other', { trackCount: 1 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
  lists.setTracks(MAIN, [
    makeRow('Main', 0, { duration: 100 }),
    makeRow('Main', 1, { duration: 50 }),
  ]);
  lists.setTracks(OTHER, [makeRow('Other', 0, { duration: 30 })]);
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  const duration = startPlaylistDuration(store, { rows }, host.fb);
  await Promise.all([playlists.ready, rows.ready]);
  await wait(50);
  const open = (guid: string) => {
    const releaseRows = rows.acquire(guid);
    const release = duration.acquire(guid);
    return () => {
      release();
      releaseRows();
    };
  };
  const of = (guid: string) => store.get(duration.stateOf(guid));
  const activate = async (guid: string) => {
    await host.invoke('playlist.setActive', { playlistGuid: guid });
    await wait(250);
  };
  return { lists, duration, open, of, activate };
}

/** 只改了标签的通知：报的是这一首。 */
const retagged = (track: PlaylistTrack) => ({
  tracks: [{ handle: track.handle, path: track.path, subsong: 0 }],
  count: 1,
  fromHook: false,
  timestamp: 1,
});

describe('startPlaylistDuration', () => {
  it('活动列表的行取回后读一次总时长；不是活动列表时不读、也不写别人的时长', async () => {
    const host = installFakeHost();
    const { open, of } = await start(host);
    open(MAIN);
    open(OTHER);
    await wait(250);
    expect(of(MAIN)).toBe(150);
    expect(of(OTHER)).toBeNull();
    expect(host.callsTo('playlist.getActive')).toHaveLength(1);
  });

  it('成了活动列表就读；行增删之后重读；放手后回到 null', async () => {
    const host = installFakeHost();
    const { lists, open, of, activate } = await start(host);
    const release = open(OTHER);
    await wait(250);
    expect(of(OTHER)).toBeNull();
    await activate(OTHER);
    expect(of(OTHER)).toBe(30);

    lists.setTracks(OTHER, [
      makeRow('Other', 0, { duration: 30 }),
      makeRow('Other', 1, { duration: 12 }),
    ]);
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(1), playlist: 1, start: 1, count: 1 });
    await wait(400);
    expect(of(OTHER)).toBe(42);
    release();
    await wait(0);
    expect(of(OTHER)).toBeNull();
  });

  it('只改了标签（换了文件、重新载入信息）也重读', async () => {
    const host = installFakeHost();
    const { lists, open, of } = await start(host);
    open(MAIN);
    await wait(250);
    expect(of(MAIN)).toBe(150);
    const longer = makeRow('Main', 1, { duration: 80 });
    lists.setTracks(MAIN, [makeRow('Main', 0, { duration: 100 }), longer]);
    host.emit('metadb:changed', retagged(longer));
    await wait(400);
    expect(of(MAIN)).toBe(180);
  });

  it('离开过活动列表、内容没动过：再成为活动列表时照样重读', async () => {
    const host = installFakeHost();
    const { lists, open, of, activate } = await start(host);
    open(OTHER);
    await activate(OTHER);
    expect(of(OTHER)).toBe(30);
    await activate(MAIN);
    // 不是活动列表的这段时间里时长变了，没有事件告诉它。
    lists.setTracks(OTHER, [makeRow('Other', 0, { duration: 40 })]);
    await activate(OTHER);
    expect(of(OTHER)).toBe(40);
  });

  it('读的途中活动列表换走了：答回来的是别的列表，不写', async () => {
    const host = installFakeHost();
    const { open, of, activate } = await start(host);
    open(OTHER);
    const held = host.hold('playlist.getActive');
    await host.invoke('playlist.setActive', { playlistGuid: OTHER });
    await vi.waitFor(() => expect(held.pending.length).toBeGreaterThan(0));
    await host.invoke('playlist.setActive', { playlistGuid: MAIN });
    // 放行那一刻的应答表答的是 Main。
    held.release();
    await wait(50);
    expect(of(OTHER)).toBeNull();
    await activate(OTHER);
    expect(of(OTHER)).toBe(30);
  });
});
