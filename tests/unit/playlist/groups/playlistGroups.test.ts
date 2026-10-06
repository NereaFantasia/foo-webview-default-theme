import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { MAX_RUNS, startPlaylistGroups } from '../../../../src/playlist/groups/playlistGroups.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import { readGroupsPrefs } from '../../../../src/playlist/groups/playlistGroupsPrefs.ts';
import { startPlaylistRows } from '../../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../../src/playback/playlists.ts';
import { DEFAULT_GROUP_MODE, GROUP_MODES } from '../../../../src/playlist/sortPatterns.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
/** 等过行服务与分组两道合并窗口，外加应答。 */
const coalesced = () => wait(350);

/** 专辑 A 两碟三首、专辑 B 一碟两首。 */
function albumRows(): PlaylistTrack[] {
  const spec: [string, number][] = [
    ['A', 1],
    ['A', 1],
    ['A', 2],
    ['B', 1],
    ['B', 1],
  ];
  return spec.map(([album, discNumber], row) =>
    makeRow('Main', row, { album, albumArtist: 'Artist', discNumber }),
  );
}

function memoryStorage(initial: Record<string, string> = {}): PrefStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function setup(host: UnitHost) {
  const lists = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true, trackCount: 5 })],
    (event, payload) => host.emit(event, payload),
  );
  lists.setTracks(MAIN, albumRows());
  return lists;
}

async function start(host: UnitHost, storage: PrefStorage | null = memoryStorage()) {
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  const groups = startPlaylistGroups(store, { rows, storage }, host.fb);
  rows.acquire(MAIN);
  const release = groups.acquire(MAIN);
  await Promise.all([playlists.ready, rows.ready, groups.ready]);
  await coalesced();
  const state = () => store.get(groups.stateOf(MAIN));
  return { store, rows, groups, release, state };
}

const keys = (runs: readonly { readonly key: string }[]) => runs.map((run) => run.key);
const runCalls = (host: UnitHost) => host.callsTo('playlist.getGroupRuns');

describe('startPlaylistGroups', () => {
  it('行取回后按缺省依据取游程，两侧总数一致才落位', async () => {
    const host = installFakeHost();
    setup(host);
    const { state } = await start(host);
    expect(keys(state().runs)).toStrictEqual(['A | Artist', 'B | Artist']);
    expect(state().runs[0]?.sub).toStrictEqual([
      { start: 0, count: 2, key: '1' },
      { start: 2, count: 1, key: '2' },
    ]);
    expect(state()).toMatchObject({ total: 5, loading: false, failure: null });
    expect(runCalls(host)[0]).toMatchObject({
      playlistGuid: MAIN,
      patterns: GROUP_MODES[DEFAULT_GROUP_MODE]?.patterns,
    });
  });

  it('挂上就取第一份游程，不等行服务的第一页、也不等合并窗口', async () => {
    const host = installFakeHost();
    setup(host);
    const store = createStore();
    const playlists = startPlaylists(store, host.fb);
    const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
    const groups = startPlaylistGroups(store, { rows, storage: memoryStorage() }, host.fb);
    await Promise.all([playlists.ready, rows.ready, groups.ready]);
    const pages = host.hold('playlist.getTracks');
    rows.acquire(MAIN);
    groups.acquire(MAIN);
    await wait(20);
    expect(store.get(rows.stateOf(MAIN)).status).toBe('loading');
    expect(runCalls(host)).toHaveLength(1);
    expect(store.get(groups.stateOf(MAIN)).loading).toBe(true);
    pages.release();
    await coalesced();
    expect(keys(store.get(groups.stateOf(MAIN)).runs)).toStrictEqual(['A | Artist', 'B | Artist']);
    // 行的第一页到了不算内容变化，不再重取。
    expect(runCalls(host)).toHaveLength(1);
  });

  it('合并窗口里的几次内容变化只重取一次', async () => {
    const host = installFakeHost();
    setup(host);
    await start(host);
    const before = runCalls(host).length;
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 5 });
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 5 });
    await coalesced();
    expect(runCalls(host)).toHaveLength(before + 1);
  });

  it('两侧总数一直对不上：重取两次后退回扁平，不当成错误提示', async () => {
    const host = installFakeHost();
    setup(host);
    host.answer('playlist.getGroupRuns', {
      playlistGuid: guidOf(0),
      success: true,
      playlist: 0,
      total: 99,
      runs: [],
    });
    const { state } = await start(host);
    await coalesced();
    expect(runCalls(host)).toHaveLength(3);
    expect(state()).toMatchObject({ runs: [], loading: false, failure: null });
  });

  it('组数超过上限、宿主答失败时退回扁平并说明原因；列表已不在时不提示', async () => {
    const host = installFakeHost();
    const lists = setup(host);
    const count = MAX_RUNS + 1;
    lists.setTracks(
      MAIN,
      Array.from({ length: count }, (_, row) => makeRow('Main', row)),
    );
    lists.content.setRuns(
      MAIN,
      Array.from({ length: count }, (_, at) => ({ start: at, count: 1, key: `${at}` })),
    );
    const { state, groups } = await start(host);
    expect(state()).toMatchObject({ runs: [], failure: 'tooMany' });
    host.answer('playlist.getGroupRuns', hostFailure('INTERNAL_ERROR'));
    groups.retry(MAIN);
    await coalesced();
    expect(state()).toMatchObject({ runs: [], failure: 'unavailable', loading: false });
    host.answer('playlist.getGroupRuns', hostFailure('NOT_FOUND'));
    groups.retry(MAIN);
    await coalesced();
    expect(state().failure).toBeNull();
  });

  it('折叠按组键切换；重取只丢已经不在的键，折叠全部与展开全部只作用在一级组', async () => {
    const host = installFakeHost();
    const lists = setup(host);
    const { groups, state } = await start(host);
    groups.toggleCollapsed(MAIN, 'A | Artist');
    expect([...state().collapsed]).toStrictEqual(['A | Artist']);
    groups.toggleCollapsed(MAIN, 'A | Artist');
    expect(state().collapsed.size).toBe(0);
    groups.collapseAll(MAIN);
    expect([...state().collapsed]).toStrictEqual(['A | Artist', 'B | Artist']);
    // 删掉 B 的两首：B 的键不在了，A 的折叠留着。
    await host.fb.playlist.removeTracks(MAIN, [3, 4]);
    await coalesced();
    expect(lists.items[0]?.trackCount).toBe(3);
    expect([...state().collapsed]).toStrictEqual(['A | Artist']);
    groups.expandAll(MAIN);
    expect(state().collapsed.size).toBe(0);
  });

  it('关掉分组一次也不取；再打开取一次；开关与依据落盘，坏的存档按缺省', async () => {
    const host = installFakeHost();
    setup(host);
    const storage = memoryStorage();
    const { groups, state, store } = await start(host, storage);
    const before = runCalls(host).length;
    groups.setEnabled(false);
    expect(state()).toMatchObject({ runs: [], loading: false });
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 5 });
    await coalesced();
    expect(runCalls(host)).toHaveLength(before);
    groups.setEnabled(true);
    await coalesced();
    expect(runCalls(host)).toHaveLength(before + 1);
    expect(store.get(groups.prefsAtom)).toStrictEqual({ enabled: true, mode: DEFAULT_GROUP_MODE });
    groups.setEnabled(false);
    expect(readGroupsPrefs(storage)).toStrictEqual({ enabled: false, mode: DEFAULT_GROUP_MODE });
    expect(
      readGroupsPrefs(memoryStorage({ 'default-theme.playlist-groups.v1': '{bad' })),
    ).toStrictEqual({
      enabled: true,
      mode: DEFAULT_GROUP_MODE,
    });
    expect(
      readGroupsPrefs(
        memoryStorage({ 'default-theme.playlist-groups.v1': '{"enabled":"no","mode":42}' }),
      ),
    ).toStrictEqual({ enabled: true, mode: DEFAULT_GROUP_MODE });
  });

  it('换依据：先按这一档重排宿主列表再取游程，清掉折叠并落盘；重排被拒照样换档重取', async () => {
    const host = installFakeHost();
    setup(host);
    const storage = memoryStorage();
    const { groups, state } = await start(host, storage);
    groups.collapseAll(MAIN);
    const mode = GROUP_MODES.findIndex((candidate) => candidate.id === 'albumSimple');
    await groups.setMode(MAIN, mode);
    expect(state().collapsed.size).toBe(0);
    await coalesced();
    const methods = host.calls.map((call) => call.method);
    expect(methods.lastIndexOf('playlist.sort')).toBeLessThan(
      methods.lastIndexOf('playlist.getGroupRuns'),
    );
    expect(host.callsTo('playlist.sort').at(-1)).toMatchObject({
      playlistGuid: MAIN,
      pattern: GROUP_MODES[mode]?.sort,
    });
    expect(runCalls(host).at(-1)).toMatchObject({ patterns: ['%album%'] });
    expect(keys(state().runs)).toStrictEqual(['A', 'B']);
    expect(readGroupsPrefs(storage).mode).toBe(mode);
    host.answer('playlist.sort', hostFailure('LOCKED'));
    const artist = GROUP_MODES.findIndex((candidate) => candidate.id === 'artist');
    await groups.setMode(MAIN, artist);
    await coalesced();
    expect(runCalls(host).at(-1)).toMatchObject({ patterns: ['%artist%'] });
  });

  it('切档或内容变了：在途的旧游程晚到不覆盖新的', async () => {
    const host = installFakeHost();
    setup(host);
    const { groups, state } = await start(host);
    const held = host.hold('playlist.getGroupRuns');
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 5 });
    await coalesced();
    expect(held.pending).toHaveLength(1);
    const mode = GROUP_MODES.findIndex((candidate) => candidate.id === 'albumSimple');
    const switching = groups.setMode(MAIN, mode);
    await switching;
    await coalesced();
    expect(held.pending.length).toBeGreaterThanOrEqual(2);
    held.respond(0, {
      playlistGuid: guidOf(0),
      success: true,
      playlist: 0,
      total: 5,
      runs: [{ start: 0, count: 5, key: 'stale' }],
    });
    await wait();
    expect(keys(state().runs)).toStrictEqual([]);
    held.release();
    await wait();
    expect(keys(state().runs)).toStrictEqual(['A', 'B']);
  });

  it('列表删了收起分组；放手后状态回到空，再要时从头取、折叠不留', async () => {
    const host = installFakeHost();
    const lists = setup(host);
    const { groups, state, release } = await start(host);
    groups.collapseAll(MAIN);
    release();
    await wait();
    expect(state()).toStrictEqual({
      runs: [],
      total: 0,
      loading: false,
      failure: null,
      collapsed: new Set(),
    });
    groups.acquire(MAIN);
    await coalesced();
    expect(state().collapsed.size).toBe(0);
    expect(state().runs).toHaveLength(2);
    await host.fb.playlist.remove(MAIN);
    await coalesced();
    expect(lists.items).toHaveLength(0);
    expect(state()).toMatchObject({ runs: [], failure: null, loading: false });
  });
});
