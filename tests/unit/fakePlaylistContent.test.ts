import type { PlaylistTrack } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import type { HostEvent } from '../fixtures/fakeHost.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../fixtures/fakePlaylists.ts';
import { installFakeHost } from '../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const LOCKED = guidOf(1);
const GONE = guidOf(9);

interface Pushed {
  readonly event: HostEvent;
  readonly payload: unknown;
  /** 推出时这次调用答了没有：宿主先推事件再应答。 */
  readonly answered: boolean;
}

function setup(rows = 5) {
  const host = installFakeHost();
  const pushed: Pushed[] = [];
  let answered = false;
  const lists = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount: rows }),
      makePlaylist(1, 'Auto', { isLocked: true, isAutoplaylist: true, trackCount: 3 }),
    ],
    (event, payload) => {
      pushed.push({ event, payload, answered });
      host.emit(event, payload);
    },
  );
  /** 调一次宿主，调完之前推出的事件记作「应答前」。 */
  async function call<T>(run: () => Promise<T>): Promise<T> {
    answered = false;
    const result = await run();
    answered = true;
    return result;
  }
  const rowsOf = (guid = MAIN) => {
    const list = lists.items.find((item) => item.guid === guid);
    if (!list) throw new Error(`清单里没有 ${guid}`);
    return lists.tracksOf(list);
  };
  const titles = (guid = MAIN) => rowsOf(guid).map((track) => track.title);
  return { host, lists, pushed, call, rowsOf, titles, playlist: host.fb.playlist };
}

const named = (list: string, names: readonly string[], extra: Partial<PlaylistTrack>[] = []) =>
  names.map((title, row) => makeRow(list, row, { title, ...extra[row] }));

describe('FakePlaylistContent 的选中', () => {
  it('setSelection 缺省替换、clearOthers 为 false 时并进来，越界的不收，真变了才推事件', async () => {
    const { playlist, pushed, call } = setup();
    await call(() => playlist.setSelection(MAIN, [3, 1, 99]));
    expect(await playlist.getSelection(MAIN)).toStrictEqual({
      success: true,
      items: [1, 3],
      count: 2,
      playlist: 0,
      playlistGuid: MAIN,
    });
    await call(() => playlist.setSelection(MAIN, [0], false));
    await call(() => playlist.setSelection(MAIN, [0, 1, 3]));
    expect(pushed).toStrictEqual([
      {
        event: 'playlist:selectionChanged',
        payload: { playlist: 0, playlistGuid: MAIN },
        answered: false,
      },
      {
        event: 'playlist:selectionChanged',
        payload: { playlist: 0, playlistGuid: MAIN },
        answered: false,
      },
    ]);
  });

  it('全选、全不选与取选中的曲目；负的行号答 INVALID_PARAMS', async () => {
    const { playlist, lists } = setup(3);
    await playlist.selectAll(MAIN);
    expect(lists.content.selection(MAIN)).toStrictEqual([0, 1, 2]);
    await playlist.setSelection(MAIN, [2]);
    const selected = await playlist.getSelectedTracks(MAIN);
    expect(selected.success && selected.tracks.map((track) => track.title)).toStrictEqual([
      'Main 3',
    ]);
    await playlist.deselectAll(MAIN);
    expect(lists.content.selection(MAIN)).toStrictEqual([]);
    expect(await playlist.setSelection(MAIN, [-1])).toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('列表不在答 NOT_FOUND；没给列表时认活动列表', async () => {
    const { host, playlist } = setup();
    expect(await playlist.getSelection(GONE)).toMatchObject({ code: 'NOT_FOUND' });
    expect(await host.invoke('playlist.getSelection', {})).toMatchObject({ playlist: 0 });
  });
});

describe('FakePlaylistContent 的增删与挪动', () => {
  it('删选中的行：先推 itemsRemoved 再应答，选中跟着行走', async () => {
    const { playlist, lists, pushed, call, titles } = setup();
    await playlist.setSelection(MAIN, [1, 3]);
    pushed.length = 0;
    await call(() => playlist.removeTracks(MAIN, [0]));
    expect(titles()).toStrictEqual(['Main 2', 'Main 3', 'Main 4', 'Main 5']);
    expect(lists.content.selection(MAIN)).toStrictEqual([0, 2]);
    await call(() => playlist.removeSelectedTracks(MAIN));
    expect(titles()).toStrictEqual(['Main 3', 'Main 5']);
    expect(lists.items[0]?.trackCount).toBe(2);
    expect(pushed).toStrictEqual([
      {
        event: 'playlist:itemsRemoved',
        payload: { playlist: 0, playlistGuid: MAIN, oldCount: 5, newCount: 4 },
        answered: false,
      },
      {
        event: 'playlist:itemsRemoved',
        payload: { playlist: 0, playlistGuid: MAIN, oldCount: 4, newCount: 2 },
        answered: false,
      },
    ]);
  });

  it('锁定的列表上改内容答 LOCKED，读照常', async () => {
    const { playlist } = setup();
    expect(await playlist.removeTracks(LOCKED, [0])).toMatchObject({ code: 'LOCKED' });
    expect(await playlist.sort(LOCKED, '%title%')).toMatchObject({ code: 'LOCKED' });
    expect(await playlist.undo(LOCKED)).toMatchObject({ code: 'LOCKED' });
    expect(await playlist.getLockInfo(LOCKED)).toStrictEqual({
      success: true,
      playlist: 1,
      playlistGuid: LOCKED,
      isLocked: true,
    });
  });

  it('插入：两种写法都认，认不得的记进 invalidCount，一条都认不得答 NOT_FOUND', async () => {
    const { host, pushed, rowsOf, titles } = setup(3);
    // 认不得的一项类型上传不进 SDK 的包装，直接走线协议。
    const insert = (position: number, handles: readonly unknown[]) =>
      host.invoke('playlist.insertTracks', { playlistGuid: MAIN, position, handles });
    const handles = ['E:/New/a.flac', { path: 'file://E:/New/b.cue', subsong: 2 }, 42];
    expect(await insert(1, handles)).toStrictEqual({
      success: true,
      playlist: 0,
      playlistGuid: MAIN,
      insertIndex: 1,
      requestedCount: 3,
      addedCount: 2,
      invalidCount: 1,
      countBefore: 3,
      totalCount: 5,
    });
    expect(titles()).toStrictEqual(['Main 1', 'Inserted 1', 'Inserted 2', 'Main 2', 'Main 3']);
    const rows = rowsOf();
    expect(rows[1]?.path).toBe('file://E:/New/a.flac');
    expect(rows[2]?.handle).toBe('E:/New/b.cue|subsong:2');
    expect(pushed.at(-1)).toMatchObject({ payload: { playlist: 0, start: 1, count: 2 } });
    expect(await insert(0, [42])).toMatchObject({ code: 'NOT_FOUND' });
    expect(await host.fb.playlist.insertTracks(MAIN, 99, ['E:/New/c.flac'])).toMatchObject({
      insertIndex: 5,
      totalCount: 6,
    });
  });

  it('挪动：给了 items 先换选中，被挡住的不越过，选中跟着挪', async () => {
    const { playlist, lists, titles } = setup();
    await playlist.moveTracks(MAIN, [1], 2);
    expect(titles()).toStrictEqual(['Main 1', 'Main 3', 'Main 4', 'Main 2', 'Main 5']);
    expect(lists.content.selection(MAIN)).toStrictEqual([3]);
    await playlist.setSelection(MAIN, [0, 3]);
    await playlist.moveTracks(MAIN, [], -10);
    expect(titles()).toStrictEqual(['Main 1', 'Main 2', 'Main 3', 'Main 4', 'Main 5']);
    expect(lists.content.selection(MAIN)).toStrictEqual([0, 1]);
  });
});

describe('FakePlaylistContent 的排序与撤销', () => {
  it('按串排、不分大小写；selectedOnly 只在选中的位置之间排；descending 排完把整张倒过来', async () => {
    const { playlist, lists, titles } = setup();
    // 曲号按原来的行号：d 1、B 2、a 3、e 4、c 5。
    lists.setTracks(MAIN, named('Main', ['d', 'B', 'a', 'e', 'c']));
    await playlist.sort(MAIN, '%title%');
    expect(titles()).toStrictEqual(['a', 'B', 'c', 'd', 'e']);
    await playlist.setSelection(MAIN, [1, 3]);
    await playlist.sort(MAIN, '%tracknumber%', false, true);
    expect(titles()).toStrictEqual(['a', 'd', 'c', 'B', 'e']);
    await playlist.sort(MAIN, '%title%', true);
    expect(titles()).toStrictEqual(['e', 'd', 'c', 'B', 'a']);
  });

  it('打乱是确定的，反转照倒', async () => {
    const { playlist, titles } = setup();
    await playlist.shuffle(MAIN);
    expect(titles()).toStrictEqual(['Main 1', 'Main 3', 'Main 5', 'Main 2', 'Main 4']);
    await playlist.reverse(MAIN);
    expect(titles()).toStrictEqual(['Main 4', 'Main 2', 'Main 5', 'Main 3', 'Main 1']);
  });

  it('撤销与重做来回；没有可撤的答 NOT_FOUND；新的改动清掉重做', async () => {
    const { playlist, pushed, titles } = setup(3);
    expect(await playlist.undo(MAIN)).toMatchObject({ code: 'NOT_FOUND' });
    await playlist.removeTracks(MAIN, [1]);
    await playlist.undo(MAIN);
    expect(titles()).toStrictEqual(['Main 1', 'Main 2', 'Main 3']);
    expect(pushed.at(-1)).toMatchObject({ event: 'playlist:itemsAdded' });
    await playlist.redo(MAIN);
    expect(titles()).toStrictEqual(['Main 1', 'Main 3']);
    await playlist.undo(MAIN);
    await playlist.reverse(MAIN);
    expect(await playlist.redo(MAIN)).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FakePlaylistContent 的分组游程', () => {
  it('相邻的同键行并成一段，只按 ASCII 不分大小写；第二个串分出子段，行号按整张列表算', async () => {
    const { playlist, lists } = setup();
    const albums = ['X', 'x', 'Y', 'Y', 'Z'];
    const discs = [1, 1, 1, 2, 1];
    lists.setTracks(
      MAIN,
      albums.map((album, row) => makeRow('Main', row, { album, discNumber: discs[row] ?? 1 })),
    );
    const answer = await playlist.getGroupRuns(['%album%', '$if2(%discnumber%,)'], MAIN);
    expect(answer).toStrictEqual({
      success: true,
      playlist: 0,
      playlistGuid: MAIN,
      total: 5,
      runs: [
        { start: 0, count: 2, key: 'X', sub: [{ start: 0, count: 2, key: '1' }] },
        {
          start: 2,
          count: 2,
          key: 'Y',
          sub: [
            { start: 2, count: 1, key: '1' },
            { start: 3, count: 1, key: '2' },
          ],
        },
        { start: 4, count: 1, key: 'Z', sub: [{ start: 4, count: 1, key: '1' }] },
      ],
    });
  });

  it('串的个数不对或有空串答 INVALID_PARAMS；setRuns 盖过现算的', async () => {
    const { playlist, lists } = setup();
    expect(await playlist.getGroupRuns([], MAIN)).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(await playlist.getGroupRuns(['%album%', ''], MAIN)).toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(await playlist.getGroupRuns(['a', 'b', 'c'], MAIN)).toMatchObject({
      code: 'INVALID_PARAMS',
    });
    lists.content.setRuns(MAIN, [{ start: 0, count: 5, key: 'fixed' }]);
    expect(await playlist.getGroupRuns(['%album%'], MAIN)).toMatchObject({
      runs: [{ start: 0, count: 5, key: 'fixed' }],
    });
  });
});

describe('FakePlaylistContent 的正在播放与入队', () => {
  it('起播记下位置，前面删了行跟着前移，那一行被删了答没有位置', async () => {
    const { host, playlist } = setup();
    await playlist.playTrack(MAIN, 2);
    expect(await host.fb.player.getCurrentTrackIndex()).toStrictEqual({
      success: true,
      found: true,
      playlist: 0,
      playlistGuid: MAIN,
      index: 2,
    });
    await playlist.removeTracks(MAIN, [0]);
    const withTrack = await host.fb.player.getCurrentTrackIndex(true);
    expect(withTrack).toMatchObject({ found: true, index: 1, track: { title: 'Main 3' } });
    await playlist.removeTracks(MAIN, [1]);
    expect(await host.fb.player.getCurrentTrackIndex()).toStrictEqual({
      success: true,
      found: false,
      playlist: null,
      playlistGuid: null,
      index: null,
    });
  });

  it('按列表坐标入队：越界的跳过，一条都不在答 INVALID_INDEX，负的答 INVALID_PARAMS', async () => {
    const { host, lists, pushed } = setup(3);
    expect(await host.fb.queue.add({ playlistGuid: MAIN, tracks: [2, 0, 99] })).toStrictEqual({
      success: true,
      addedCount: 2,
      queueCount: 2,
    });
    expect(lists.content.queued).toStrictEqual([
      { guid: MAIN, row: 2 },
      { guid: MAIN, row: 0 },
    ]);
    expect(pushed.at(-1)).toMatchObject({
      event: 'playback:queueChanged',
      payload: { origin: 'user_added', count: 2 },
    });
    expect(await host.fb.queue.add({ playlistGuid: MAIN, track: 7 })).toMatchObject({
      code: 'INVALID_INDEX',
    });
    expect(await host.fb.queue.add({ playlistGuid: MAIN, tracks: [-1] })).toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(await host.fb.queue.add({ playlistGuid: GONE, track: 0 })).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
