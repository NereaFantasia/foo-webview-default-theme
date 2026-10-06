import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startPlaylistRows } from '../../../src/playlist/playlistRows.ts';
import { startPlaylistSelection } from '../../../src/playlist/playlistSelection.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { rowsOf } from '../../../src/table/rangeSelection.ts';
import { createRowSelection } from '../../../src/table/rowSelection.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const OTHER = guidOf(1);
const PLAIN = { ctrl: false, shift: false };
const SHIFT = { ctrl: false, shift: true };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function lists(host: UnitHost, trackCount = 10) {
  return new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount }),
      makePlaylist(1, 'Other', { trackCount: 5 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
}

async function start(host: UnitHost) {
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  const service = startPlaylistSelection(store, { rows }, host.fb);
  const selection = createRowSelection(store, { total: 0 });
  rows.acquire(MAIN);
  await Promise.all([playlists.ready, rows.ready, service.ready]);
  await settle();
  const detach = service.attach(MAIN, selection);
  await settle();
  const local = () => rowsOf(store.get(selection.state).ranges);
  return { store, service, selection, detach, local };
}

const sent = (host: UnitHost) =>
  host.calls
    .filter((call) => /^playlist\.(setSelection|selectAll|deselectAll)$/.test(call.method))
    .map((call) => [call.method.slice('playlist.'.length), call.params['indices'] ?? null]);

describe('startPlaylistSelection', () => {
  it('本地一改就按 GUID 推给宿主；选满走 selectAll，清空走 deselectAll', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { selection } = await start(host);
    selection.activate(2, PLAIN);
    selection.activate(4, SHIFT);
    await settle();
    selection.selectAll();
    await settle();
    selection.clear();
    await settle();
    expect(sent(host)).toStrictEqual([
      ['setSelection', [2]],
      ['setSelection', [2, 3, 4]],
      ['selectAll', null],
      ['deselectAll', null],
    ]);
    expect(host.callsTo('playlist.setSelection')[0]).toMatchObject({ playlistGuid: MAIN });
    expect(fake.content.selection(MAIN)).toStrictEqual([]);
  });

  it('连着改选中：同时只有一个请求在途，待发的只留最后一个', async () => {
    const host = installFakeHost();
    lists(host);
    const { selection } = await start(host);
    const held = host.hold('playlist.setSelection');
    selection.activate(1, PLAIN);
    selection.activate(2, SHIFT);
    selection.activate(3, SHIFT);
    selection.activate(5, SHIFT);
    await settle();
    expect(held.pending.map((params) => params['indices'])).toStrictEqual([[1]]);
    held.release();
    await settle();
    expect(sent(host)).toStrictEqual([
      ['setSelection', [1]],
      ['setSelection', [1, 2, 3, 4, 5]],
    ]);
  });

  it('挂上时读回宿主那一份；宿主被别处改了本地跟着改，别的列表的事件不理', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    await host.fb.playlist.setSelection(MAIN, [3, 4]);
    const { local } = await start(host);
    expect(local()).toStrictEqual([3, 4]);
    await host.invoke('playlist.setSelection', { playlistGuid: MAIN, indices: [7] });
    await settle();
    expect(local()).toStrictEqual([7]);
    const rereads = host.callsTo('playlist.getSelection').length;
    await host.invoke('playlist.setSelection', { playlistGuid: OTHER, indices: [1] });
    await settle();
    expect(host.callsTo('playlist.getSelection')).toHaveLength(rereads);
    expect(fake.content.selection(MAIN)).toStrictEqual([7]);
  });

  it('自己推上去的变更引来的回查不改本地', async () => {
    const host = installFakeHost();
    lists(host);
    const { store, selection } = await start(host);
    let writes = 0;
    store.sub(selection.state, () => {
      writes += 1;
    });
    selection.activate(6, PLAIN);
    await settle();
    await settle();
    expect(writes).toBe(1);
    expect(host.callsTo('playlist.getSelection').length).toBeGreaterThan(1);
  });

  it('回查途中本地又变过，那份旧结果丢掉', async () => {
    const host = installFakeHost();
    lists(host);
    const { selection, local } = await start(host);
    const held = host.hold('playlist.getSelection');
    await host.invoke('playlist.setSelection', { playlistGuid: MAIN, indices: [8] });
    selection.activate(1, PLAIN);
    // 本地的推送先落地，别处那次改动引来的回查才回来。
    await settle();
    expect(host.callsTo('playlist.setSelection').at(-1)).toMatchObject({ indices: [1] });
    held.respond(0, { playlistGuid: guidOf(0), success: true, items: [8], count: 1, playlist: 0 });
    await settle();
    expect(local()).toStrictEqual([1]);
    held.release();
    await settle();
    expect(local()).toStrictEqual([1]);
  });

  it('行增删之后回查：宿主挪了它那一份，本地跟着；列表变短时越界的裁掉', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { selection, local } = await start(host);
    selection.activate(8, PLAIN);
    selection.activate(9, SHIFT);
    await settle();
    await host.fb.playlist.removeTracks(MAIN, [0, 1]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.content.selection(MAIN)).toStrictEqual([6, 7]);
    expect(local()).toStrictEqual([6, 7]);
  });

  it('宿主不在时只改本地，连上后把最后那份补发出去', async () => {
    const host = installFakeHost({ available: false });
    const fake = lists(host);
    const store = createStore();
    const playlists = startPlaylists(store, host.fb);
    const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
    const service = startPlaylistSelection(store, { rows }, host.fb);
    const selection = createRowSelection(store, { total: 10 });
    rows.acquire(MAIN);
    service.attach(MAIN, selection);
    selection.activate(2, PLAIN);
    selection.activate(3, SHIFT);
    expect(sent(host)).toStrictEqual([]);
    host.connect();
    await Promise.all([playlists.ready, rows.ready, service.ready]);
    await settle();
    expect(sent(host)).toStrictEqual([['setSelection', [2, 3]]]);
    expect(fake.content.selection(MAIN)).toStrictEqual([2, 3]);
  });

  it('settle：没在发时立即答；在途与待发的都发完才答真，宿主停在最后那一份', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { service, selection } = await start(host);
    expect(await service.settle(MAIN)).toBe(true);
    expect(await service.settle(OTHER)).toBe(false);
    const held = host.hold('playlist.setSelection');
    selection.activate(1, PLAIN);
    selection.activate(4, SHIFT);
    const settled = service.settle(MAIN);
    held.release();
    expect(await settled).toBe(true);
    expect(fake.content.selection(MAIN)).toStrictEqual([1, 2, 3, 4]);
  });

  it('settle：推送失败答假并记下失败，下一次推送成功后答真', async () => {
    const host = installFakeHost();
    lists(host);
    const { store, service, selection } = await start(host);
    host.answer('playlist.setSelection', hostFailure('INTERNAL_ERROR'));
    selection.activate(1, PLAIN);
    expect(await service.settle(MAIN)).toBe(false);
    expect(store.get(service.failedAtom)).toBe(true);
    host.answer('playlist.setSelection', () => ({ success: true }));
    expect(await service.settle(MAIN)).toBe(true);
    service.dismissFailure();
    expect(store.get(service.failedAtom)).toBe(false);
  });

  it('卸下与释放：还在等的 settle 答假，之后宿主的变化不再写进本地', async () => {
    const host = installFakeHost();
    lists(host);
    const { service, selection, detach, local } = await start(host);
    host.hold('playlist.setSelection');
    selection.activate(1, PLAIN);
    const settled = service.settle(MAIN);
    detach();
    expect(await settled).toBe(false);
    await host.invoke('playlist.selectAll', { playlistGuid: MAIN });
    await settle();
    expect(local()).toStrictEqual([1]);
    service.dispose();
    expect(await service.settle(MAIN)).toBe(false);
  });
});
