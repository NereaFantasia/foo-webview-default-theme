import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startPlaylistCovers } from '../../../../src/playlist/groups/playlistCovers.ts';
import {
  NO_GROUPS,
  startPlaylistGroups,
  type PlaylistGroupsState,
} from '../../../../src/playlist/groups/playlistGroups.ts';
import { playlistRowOf } from '../../../../src/playlist/playlistRow.ts';
import { startPlaylistRows } from '../../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../../fixtures/fakePlaylists.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** 一张专辑一组；每行写成「目录」或「目录#碟号」，碟号缺省为 1。 */
function tracksIn(groups: readonly (readonly string[])[]): PlaylistTrack[] {
  const out: PlaylistTrack[] = [];
  groups.forEach((specs, group) => {
    for (const spec of specs) {
      const [dir = '', disc = '1'] = spec.split('#');
      const row = out.length;
      out.push(
        makeRow('Main', row, {
          album: `Album ${group}`,
          albumArtist: 'Artist',
          discNumber: Number(disc),
          path: `file://E:/Music/${dir}/${String(row).padStart(2, '0')}.flac`,
        }),
      );
    }
  });
  return out;
}

async function setup(host: UnitHost, groups: readonly (readonly string[])[]) {
  const lists = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true })],
    (event, payload) => host.emit(event, payload),
  );
  lists.setTracks(MAIN, tracksIn(groups));
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: `fb2k://artwork/${String(params['path'])}?size=${String(params['maxSize'])}`,
  }));
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  const grouping = startPlaylistGroups(store, { rows, storage: null }, host.fb);
  const covers = startPlaylistCovers(
    store,
    { rows, groups: grouping, pixelRatio: () => 1 },
    host.fb,
  );
  rows.acquire(MAIN);
  grouping.acquire(MAIN);
  await Promise.all([playlists.ready, rows.ready, grouping.ready]);
  await wait(350);
  /** 问一次、等取回再问一次，答第二次的结果。 */
  const settled = async (runIndex: number, width = 120) => {
    covers.coverOf(MAIN, runIndex, width);
    await wait(10);
    return covers.coverOf(MAIN, runIndex, width);
  };
  return { host, lists, store, rows, grouping, covers, settled };
}

const artCalls = (host: UnitHost) => host.callsTo('artwork.getFb2kUrlByPath');

describe('startPlaylistCovers：行号对不上的旧行', () => {
  it('缓存里的行在行增删重排之后留着显示时，不拿它的路径，另取一行', async () => {
    const host = installFakeHost();
    const lists = new FakePlaylists(
      host,
      [makePlaylist(0, 'Main', { isActive: true })],
      (event, payload) => host.emit(event, payload),
    );
    lists.setTracks(MAIN, tracksIn([['New', 'New']]));
    host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: 'front',
      path: String(params['path']),
      dataUrl: `fb2k://artwork/${String(params['path'])}`,
    }));
    const store = createStore();
    const stale = tracksIn([['Old', 'Old']]);
    const rows = {
      rowAt: (_guid: string, row: number) => {
        const track = stale[row];
        return track ? playlistRowOf(track) : undefined;
      },
      currentAt: () => false,
    };
    const runs = [{ start: 0, count: 2, key: 'Album 0 | Artist' }];
    const state = atom<PlaylistGroupsState>({ ...NO_GROUPS, runs, total: 2 });
    const covers = startPlaylistCovers(
      store,
      { rows, groups: { stateOf: () => state }, pixelRatio: () => 1 },
      host.fb,
    );
    covers.coverOf(MAIN, 0, 120);
    await wait(20);
    expect(covers.coverOf(MAIN, 0, 120)?.urls).toStrictEqual([
      'fb2k://artwork/file://E:/Music/New/00.flac',
    ]);
    expect(host.callsTo('playlist.getTracks').length).toBeGreaterThan(0);
  });
});

describe('startPlaylistCovers：游程在重取', () => {
  it('游程在重取时不排新的；取到一半游程开始重取，这一次作废，重取完再问才取', async () => {
    const host = installFakeHost();
    const lists = new FakePlaylists(
      host,
      [makePlaylist(0, 'Main', { isActive: true })],
      (event, payload) => host.emit(event, payload),
    );
    lists.setTracks(MAIN, tracksIn([['A', 'A']]));
    host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: 'front',
      path: String(params['path']),
      dataUrl: `fb2k://artwork/${String(params['path'])}`,
    }));
    const store = createStore();
    const rows = { rowAt: () => undefined, currentAt: () => false };
    const runs = [{ start: 0, count: 2, key: 'Album 0 | Artist' }];
    const state = atom<PlaylistGroupsState>({ ...NO_GROUPS, runs, total: 2, loading: true });
    const covers = startPlaylistCovers(
      store,
      { rows, groups: { stateOf: () => state }, pixelRatio: () => 1 },
      host.fb,
    );
    expect(covers.coverOf(MAIN, 0, 120)).toBeUndefined();
    await wait(20);
    expect(host.callsTo('playlist.getTracks')).toEqual([]);

    store.set(state, { ...store.get(state), loading: false });
    const held = host.hold('artwork.getFb2kUrlByPath');
    covers.coverOf(MAIN, 0, 120);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    store.set(state, { ...store.get(state), loading: true });
    held.release();
    await wait(20);
    store.set(state, { ...store.get(state), loading: false });
    // 作废的那一次没写进缓存：同一份游程再问时重新排取，不给旧的那张。
    expect(covers.coverOf(MAIN, 0, 120)).toBeUndefined();
    await wait(20);
    expect(covers.coverOf(MAIN, 0, 120)?.status).toBe('ready');
    expect(artCalls(host)).toHaveLength(2);
  });
});

describe('startPlaylistCovers', () => {
  it('同一目录的组只取一张；代表路径在行缓存里时不另发取行请求', async () => {
    const host = installFakeHost();
    const { settled } = await setup(host, [['A', 'A', 'A']]);
    const pages = host.callsTo('playlist.getTracks').length;
    expect(await settled(0)).toStrictEqual({
      urls: ['fb2k://artwork/file://E:/Music/A/00.flac?size=256'],
      status: 'ready',
    });
    expect(host.callsTo('playlist.getTracks')).toHaveLength(pages);
  });

  it('多碟跨目录每个目录一张，按首次出现的顺序；超过四个目录退回第一张', async () => {
    const host = installFakeHost();
    const { settled } = await setup(host, [
      ['CD1#1', 'CD1#1', 'CD2#2'],
      ['a#1', 'b#2', 'c#3', 'd#4', 'e#5'],
    ]);
    expect((await settled(0))?.urls).toStrictEqual([
      'fb2k://artwork/file://E:/Music/CD1/00.flac?size=256',
      'fb2k://artwork/file://E:/Music/CD2/02.flac?size=256',
    ]);
    expect((await settled(1))?.urls).toStrictEqual([
      'fb2k://artwork/file://E:/Music/a/03.flac?size=256',
    ]);
  });

  it('封面列关着时一张都不取；同一组只取一次', async () => {
    const host = installFakeHost();
    const { covers, settled } = await setup(host, [['A', 'A']]);
    expect(covers.coverOf(MAIN, 0, 0)).toBeUndefined();
    await wait(10);
    expect(artCalls(host)).toHaveLength(0);
    await settled(0);
    covers.coverOf(MAIN, 0, 120);
    covers.coverOf(MAIN, 0, 120);
    await wait(10);
    expect(artCalls(host)).toHaveLength(1);
  });

  it('请求尺寸按封面列宽乘像素比取档；跨档或游程换了整份重取，不先给一帧旧地址', async () => {
    const host = installFakeHost();
    const { covers, settled } = await setup(host, [['A', 'A']]);
    await settled(0, 120);
    expect(artCalls(host).at(-1)).toMatchObject({ maxSize: 256 });
    expect(covers.coverOf(MAIN, 0, 300)).toBeUndefined();
    await wait(10);
    expect(artCalls(host).at(-1)).toMatchObject({ maxSize: 384 });
    const before = artCalls(host).length;
    await host.fb.playlist.reverse(MAIN);
    await wait(350);
    expect(covers.coverOf(MAIN, 0, 300)).toBeUndefined();
    await wait(10);
    expect(artCalls(host)).toHaveLength(before + 1);
  });

  it('刷新：通知组头重问，新地址带刷新记号；取回途中刷新了，旧应答不写', async () => {
    const host = installFakeHost();
    const { store, covers, settled } = await setup(host, [['A', 'A']]);
    const held = host.hold('artwork.getFb2kUrlByPath');
    covers.coverOf(MAIN, 0, 120);
    await wait(10);
    const version = store.get(covers.versionAtom);
    covers.refresh(MAIN);
    expect(store.get(covers.versionAtom)).toBe(version + 1);
    held.release();
    await wait(10);
    expect(covers.coverOf(MAIN, 0, 120)).toBeUndefined();
    await wait(10);
    const cover = await settled(0);
    expect(cover?.urls[0]).toMatch(/[?&]_refresh=\d+$/);
  });

  it('F5 之后内联的 data: 地址原样用，不接刷新记号（接了图就读不出来）', async () => {
    const host = installFakeHost();
    const { covers, settled } = await setup(host, [['A']]);
    const inline = 'data:image/png;base64,AAAA';
    host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: 'front',
      path: String(params['path']),
      dataUrl: inline,
    }));
    covers.refresh(MAIN);
    expect((await settled(0))?.urls).toStrictEqual([inline]);
  });

  it('释放之后不再取也不再写', async () => {
    const host = installFakeHost();
    const { covers } = await setup(host, [['A']]);
    covers.coverOf(MAIN, 0, 120);
    covers.dispose();
    await wait(10);
    expect(covers.coverOf(MAIN, 0, 120)).toBeUndefined();
    expect(artCalls(host)).toHaveLength(0);
  });
});
