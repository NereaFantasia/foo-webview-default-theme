import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { MAIN_COMMANDS } from '../../../src/playlist/playlistActions.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import {
  createPlaylistTrackActions,
  QUEUE_NEXT_BATCH,
  SEND_TO_INLINE_LIMIT,
} from '../../../src/playlist/playlistTrackActions.ts';
import type { SelectionRanges } from '../../../src/table/rangeSelection.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { installFakeQueue } from '../../fixtures/fakeQueue.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const OTHER = guidOf(1);
const LOCKED = guidOf(2);

const span = (start: number, end: number): SelectionRanges => [{ start, end }];

async function setup(host: UnitHost, trackCount = 10) {
  const lists = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount }),
      makePlaylist(1, 'Other', { trackCount: 2 }),
      makePlaylist(2, 'Auto', { isLocked: true, isAutoplaylist: true, trackCount: 3 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  let settled = true;
  const actions = createPlaylistTrackActions(
    store,
    { selection: { settle: () => Promise.resolve(settled) } },
    host.fb,
  );
  await playlists.ready;
  return {
    lists,
    actions,
    failed: () => store.get(actions.failedAtom),
    unsynced: () => {
      settled = false;
    },
  };
}

describe('createPlaylistTrackActions', () => {
  it('移除按宿主那份选中删；选中没落地就不发，锁定的列表按失败报', async () => {
    const host = installFakeHost();
    const { lists, actions, failed, unsynced } = await setup(host);
    await host.fb.playlist.setSelection(MAIN, [1, 2]);
    expect(await actions.remove(MAIN)).toBe(true);
    expect(lists.items[0]?.trackCount).toBe(8);
    expect(await actions.remove(LOCKED)).toBe(false);
    expect(failed()).toBe(true);
    unsynced();
    const sent = host.callsTo('playlist.removeSelectedTracks').length;
    expect(await actions.remove(MAIN)).toBe(false);
    expect(host.callsTo('playlist.removeSelectedTracks')).toHaveLength(sent);
  });

  it('裁剪先等选中落地，再确认这张是活动列表，才发主菜单的裁剪命令', async () => {
    const host = installFakeHost();
    const { actions, failed } = await setup(host);
    host.answer('menu.runMainMenuCommand', { success: true });
    expect(await actions.crop(MAIN)).toBe(true);
    expect(host.callsTo('menu.runMainMenuCommand').at(-1)).toMatchObject({
      command: MAIN_COMMANDS.cropSelection,
    });
    expect(await actions.crop(OTHER)).toBe(false);
    expect(host.callsTo('menu.runMainMenuCommand')).toHaveLength(1);
    expect(failed()).toBe(true);
  });

  it('排序、打乱、反转、撤销与重做按 GUID 发；锁着的与没有可撤的不提示，别的失败提示', async () => {
    const host = installFakeHost();
    const { actions, failed } = await setup(host);
    expect(await actions.sort(MAIN, '%title%', true)).toBe(true);
    expect(host.callsTo('playlist.sort').at(-1)).toMatchObject({
      playlistGuid: MAIN,
      pattern: '%title%',
      descending: true,
    });
    expect(await actions.shuffle(MAIN)).toBe(true);
    expect(await actions.reverse(MAIN)).toBe(true);
    expect(await actions.undo(MAIN)).toBe(true);
    expect(await actions.redo(MAIN)).toBe(true);
    expect(await actions.sort(LOCKED, '%title%', false)).toBe(false);
    expect(await actions.undo(OTHER)).toBe(false);
    expect(failed()).toBe(false);
    host.answer('playlist.reverse', hostFailure('INTERNAL_ERROR'));
    expect(await actions.reverse(MAIN)).toBe(false);
    expect(failed()).toBe(true);
    actions.dismissFailure();
    expect(failed()).toBe(false);
  });

  it('下一首播放按行序读路径，按批依次插到队首', async () => {
    const host = installFakeHost();
    const { actions } = await setup(host, QUEUE_NEXT_BATCH + 10);
    expect(await actions.queueNext(MAIN, span(0, QUEUE_NEXT_BATCH + 3))).toBe(true);
    const calls = host.callsTo('queue.insertNext');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.['position']).toBe(0);
    expect(calls[1]).toMatchObject({
      paths: [0, 1, 2].map((offset) => makeRow('Main', QUEUE_NEXT_BATCH + offset).handle),
      position: QUEUE_NEXT_BATCH,
    });
  });

  it('加入队列保留选中行顺序，按路径写队尾；空选中不发', async () => {
    const host = installFakeHost();
    const { actions } = await setup(host);
    host.answer('queue.getCount', { success: true, count: 4, hasItems: true });
    expect(await actions.queueLast(MAIN, [...span(1, 3), ...span(5, 6)])).toBe(true);
    expect(host.callsTo('queue.insertNext')).toEqual([
      { paths: [1, 2, 5].map((row) => makeRow('Main', row).handle), position: 4 },
    ]);
    expect(await actions.queueLast(MAIN, [])).toBe(false);
  });

  it('读取选中行期间来源重排，拒绝用旧行号入队', async () => {
    const host = installFakeHost();
    const { actions, failed } = await setup(host);
    const held = host.hold('playlist.getTracks');
    const pending = actions.queueNext(MAIN, span(0, 2));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    host.emit('playlist:itemsReordered', { playlistGuid: guidOf(0), playlist: 0, count: 10 });
    held.release();
    expect(await pending).toBe(false);
    expect(host.callsTo('queue.insertNext')).toEqual([]);
    expect(failed()).toBe(true);
  });

  it('沿用宿主句柄，同一文件的不同分轨分别入队', async () => {
    const host = installFakeHost();
    const { lists, actions } = await setup(host);
    const tracks = [1, 2].map((subsong, row) =>
      makeRow('Main', row, { path: 'file://E:/Music/disc.flac', subsong }),
    );
    lists.setTracks(MAIN, tracks);
    const queue = installFakeQueue(host, [], tracks);
    expect(await actions.queueNext(MAIN, span(0, 2))).toBe(true);
    expect(queue.items.map((item) => item.track.handle)).toEqual([
      'E:/Music/disc.flac|subsong:1',
      'E:/Music/disc.flac|subsong:2',
    ]);
    expect(queue.items.every((item) => item.playlist === null)).toBe(true);
  });

  it('发送到：先读路径再插到目标末尾；新建列表时先读再建；超过上限不发', async () => {
    const host = installFakeHost();
    const { lists, actions, failed } = await setup(host);
    expect(await actions.sendTo(MAIN, span(0, 2), OTHER)).toBe(true);
    expect(lists.items[1]?.trackCount).toBe(4);
    expect(await actions.sendToNew(MAIN, span(3, 4), 'Fresh')).toBe(true);
    expect(lists.names()).toContain('Fresh');
    expect(lists.items.find((item) => item.name === 'Fresh')?.trackCount).toBe(1);
    const creates = host.callsTo('playlist.create').length;
    expect(await actions.sendToNew(MAIN, span(8, 20), 'Broken')).toBe(false);
    expect(host.callsTo('playlist.create')).toHaveLength(creates);
    expect(failed()).toBe(true);
    const reads = host.callsTo('playlist.getTracks').length;
    expect(await actions.sendTo(MAIN, span(0, SEND_TO_INLINE_LIMIT + 1), OTHER)).toBe(false);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(reads);
  });
});
