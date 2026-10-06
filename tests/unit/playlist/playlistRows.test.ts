import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlaylistRows } from '../../../src/playlist/playlistRows.ts';
import { ROWS_COALESCE_MS } from '../../../src/playlist/playlistRowSource.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const MAIN = guidOf(0);
const CHILL = guidOf(1);

const tracks = (list: string, count: number): PlaylistTrack[] =>
  Array.from({ length: count }, (_, row) => makeRow(list, row));

function lists(host: UnitHost) {
  return new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount: 450 }),
      makePlaylist(1, 'Chill', { trackCount: 10 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
}

async function start(host: UnitHost) {
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const refetch = atom(0);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch }, host.fb);
  await playlists.ready;
  await rows.ready;
  await settle();
  return { store, rows, refetch, state: (guid = MAIN) => store.get(rows.stateOf(guid)) };
}

/** 某张列表收到过几个取页请求。 */
const requestsFor = (host: UnitHost, guid: string) =>
  host.callsTo('playlist.getTracks').filter((call) => call['playlistGuid'] === guid).length;

describe('startPlaylistRows', () => {
  it('连上之前就要了：先订阅再取行，状态按清单里的曲目数起', async () => {
    const host = installFakeHost({ available: false });
    lists(host);
    const store = createStore();
    const playlists = startPlaylists(store, host.fb);
    const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
    rows.acquire(MAIN);
    expect(store.get(rows.stateOf(MAIN))).toMatchObject({ status: 'loading', total: 0 });
    const subscribed: number[] = [];
    // 清单服务不订 itemsReordered，数到的只可能是行服务自己的订阅。
    host.answer('playlist.getTracks', () => {
      subscribed.push(host.listenerCount('playlist:itemsReordered'));
      return { success: true, playlist: 0, start: 0, count: 0, total: 0, tracks: [] };
    });
    host.connect();
    await playlists.ready;
    await rows.ready;
    await settle();
    expect(subscribed).toEqual([1]);
    expect(store.get(rows.stateOf(MAIN))).toMatchObject({ status: 'ready', total: 0 });
  });

  it('内容事件按序号换回 GUID，合并后作废那一张；别的列表变了不重取', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { rows } = await start(host);
    rows.acquire(MAIN);
    await settle();
    vi.useFakeTimers();
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(1), playlist: 1, start: 0, count: 2 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(3);
    fake.setTracks(MAIN, tracks('Sorted', 450));
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 450 });
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 450 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(6);
    expect(rows.rowAt(MAIN, 0)?.title).toBe('Sorted 1');
  });

  it('列表重排后按读回的清单换算：挪到第 1 位的列表认序号 1', async () => {
    const host = installFakeHost();
    lists(host);
    const { rows } = await start(host);
    rows.acquire(MAIN);
    await settle();
    await host.fb.playlist.reorderPlaylists([1, 0]);
    await settle();
    vi.useFakeTimers();
    host.emit('playlist:itemsAdded', { playlist: 0, playlistGuid: CHILL, start: 0, count: 2 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(3);
    host.emit('playlist:itemsAdded', { playlist: 1, playlistGuid: MAIN, start: 0, count: 2 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(6);
  });

  it('建、删、重排列表之后到清单读回之前序号不可信：内容事件当作命中每一张', async () => {
    const host = installFakeHost();
    lists(host);
    const { rows } = await start(host);
    rows.acquire(MAIN);
    rows.acquire(CHILL);
    await settle();
    vi.useFakeTimers();
    const reads = host.hold('playlist.getAll');
    host.emit('playlist:created', { guid: guidOf(2), index: 2, name: 'New' });
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(2), playlist: 2, start: 0, count: 2 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect([requestsFor(host, MAIN), requestsFor(host, CHILL)]).toEqual([6, 2]);
    // 读清单失败：版本没动，照旧不可信。
    reads.respond(0, hostFailure('INTERNAL_ERROR'));
    await vi.advanceTimersByTimeAsync(0);
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(2), playlist: 2, start: 0, count: 2 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect([requestsFor(host, MAIN), requestsFor(host, CHILL)]).toEqual([9, 3]);
    reads.release();
  });

  it('改了标签：报的曲目在缓存里或没报全才重取，取回新的标签，不算行的增删', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { rows, state } = await start(host);
    rows.acquire(MAIN);
    await settle();
    vi.useFakeTimers();
    const { contentVersion } = state();
    const changed = (track: PlaylistTrack, count = 1) => ({
      tracks: [{ handle: track.handle, path: track.path, subsong: 0 }],
      count,
      fromHook: false,
      timestamp: 1,
    });
    host.emit('metadb:changed', changed(makeRow('Elsewhere', 0)));
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(3);
    const retitled = tracks('Main', 450).map((track, row) =>
      row === 5 ? { ...track, title: 'Renamed' } : track,
    );
    fake.setTracks(MAIN, retitled);
    host.emit('metadb:changed', changed(makeRow('Main', 5)));
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(rows.rowAt(MAIN, 5)?.title).toBe('Renamed');
    host.emit('metadb:changed', changed(makeRow('Elsewhere', 0), 80));
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(9);
    expect(state().contentVersion).toBe(contentVersion);
  });

  it('评分事件没报全：与同一次标签事件合并，只重取一轮', async () => {
    const host = installFakeHost();
    lists(host);
    const { store, rows, refetch } = await start(host);
    rows.acquire(MAIN);
    await settle();
    vi.useFakeTimers();
    store.set(refetch, 1);
    host.emit('metadb:changed', { tracks: [], count: 80, fromHook: false, timestamp: 1 });
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(requestsFor(host, MAIN)).toBe(6);
  });

  it('列表被删：清单读回后去问宿主，宿主答不存在才记成已删除；撤销了删除再取回来', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { rows, state } = await start(host);
    rows.acquire(CHILL);
    await settle();
    const chill = fake.items[1];
    await host.fb.playlist.remove(CHILL);
    await settle();
    expect(state(CHILL)).toMatchObject({ status: 'gone', total: 0 });
    // 别处的标签没报全：已删除的不跟着重取。
    host.emit('metadb:changed', { tracks: [], count: 80, fromHook: false, timestamp: 1 });
    await new Promise((resolve) => setTimeout(resolve, ROWS_COALESCE_MS + 10));
    expect(requestsFor(host, CHILL)).toBe(2);
    if (chill) fake.items = [...fake.items, { ...chill, index: 1 }];
    host.emit('playlist:created', { guid: guidOf(1), index: 1, name: 'Chill' });
    await settle();
    expect(state(CHILL)).toMatchObject({ status: 'ready', total: 10 });
  });

  it('刚建好、清单还没带回的列表：清单变了也不误判成已删除', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { rows, state } = await start(host);
    const fresh = makePlaylist(2, 'Fresh', { guid: guidOf(7), trackCount: 3 });
    fake.items = [...fake.items, fresh];
    rows.acquire(fresh.guid);
    await settle();
    expect(state(fresh.guid)).toMatchObject({ status: 'ready', total: 3 });
    // 清单读回的还是建之前的那份：不在里面，去问宿主，宿主那边有。
    host.answer('playlist.getAll', {
      success: true,
      playlists: fake.items.slice(0, 2),
      count: 2,
    });
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'Main' });
    await settle();
    expect(state(fresh.guid).status).toBe('ready');
    // 读清单失败：清单的版本没动，不再核对，也就不再去问宿主。
    const asked = requestsFor(host, fresh.guid);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'Main' });
    await settle();
    expect(requestsFor(host, fresh.guid)).toBe(asked);
    expect(state(fresh.guid)).toMatchObject({ status: 'ready', total: 3 });
    expect(rows.rowAt(fresh.guid, 2)?.title).toBe('Fresh 3');
  });

  it('几个页面共用一份；都放手后丢掉缓存，同一次提交里放手又拿起时留着', async () => {
    const host = installFakeHost();
    lists(host);
    const { rows, state } = await start(host);
    const first = rows.acquire(MAIN);
    const second = rows.acquire(MAIN);
    await settle();
    expect(requestsFor(host, MAIN)).toBe(3);
    first();
    first();
    await settle();
    expect(state().status).toBe('ready');
    second();
    const again = rows.acquire(MAIN);
    await settle();
    expect(requestsFor(host, MAIN)).toBe(3);
    again();
    await settle();
    expect(state()).toMatchObject({ status: 'idle', total: 0 });
    expect(rows.rowAt(MAIN, 0)).toBeUndefined();
    rows.acquire(MAIN);
    await settle();
    expect(requestsFor(host, MAIN)).toBe(6);
  });

  it('连不上宿主：记成连不上，不发请求；释放之后再要也不起', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
    rows.acquire(MAIN);
    await vi.advanceTimersByTimeAsync(5000);
    await rows.ready;
    expect(store.get(rows.stateOf(MAIN)).status).toBe('disconnected');
    rows.dispose();
    rows.acquire(CHILL);
    expect(store.get(rows.stateOf(CHILL)).status).toBe('idle');
    expect(host.callsTo('playlist.getTracks')).toEqual([]);
  });
});
