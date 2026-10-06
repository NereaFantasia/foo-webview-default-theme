import { describe, expect, it } from 'vitest';
import { LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import {
  INSERT_NEXT_BATCH,
  queueLast,
  queueNext,
  readSendTargets,
  sendToNewPlaylist,
  sendToPlaylist,
} from '../../../src/track/trackListActions.ts';
import { hostFailure, listParam } from '../../fixtures/hostAnswers.ts';
import { playlistGuid, playlistRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const paths = (count: number) => Array.from({ length: count }, (_, at) => `file://E:\\${at}.flac`);

function hostWithView(trackCount = 10) {
  const host = installFakeHost();
  const playlists = [
    playlistRow(0, 'Default'),
    playlistRow(1, 'Locked', { isLocked: true }),
    playlistRow(2, LIBRARY_VIEW_PLAYLIST, { trackCount }),
  ];
  host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
  return host;
}

describe('queueNext', () => {
  it('直接按路径入队，不写入或读取专用列表', async () => {
    const host = hostWithView(10);
    expect(await queueNext(host.fb, paths(2))).toBe(true);
    expect(host.callsTo('queue.insertNext')).toEqual([
      {
        paths: paths(2),
        position: 0,
      },
    ]);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
    expect(host.callsTo('playlist.getAll')).toEqual([]);
  });

  it('每次至多 256 条分批发，后一批插在前一批落下的位置之后', async () => {
    const host = hostWithView(0);
    // 替身按宿主的样子答：已在队列里的算挪动，新的算插入。
    host.answer('queue.insertNext', (params) => {
      const count = listParam(params, 'paths').length;
      const moved = count === INSERT_NEXT_BATCH ? 6 : 0;
      return {
        success: true,
        insertedCount: count - moved,
        movedCount: moved,
        queueCount: count,
        invalidCount: 0,
      };
    });
    expect(await queueNext(host.fb, paths(600))).toBe(true);
    const calls = host.callsTo('queue.insertNext');
    expect(calls.map((call) => listParam(call, 'paths').length)).toEqual([256, 256, 88]);
    expect(calls.map((call) => call['position'])).toEqual([0, 256, 512]);
    expect(listParam(calls[1]!, 'paths')[0]).toEqual(paths(600)[256]);
    expect(listParam(calls[2]!, 'paths').at(-1)).toEqual(paths(600)[599]);
  });

  it('某一批失败即停', async () => {
    const host = hostWithView(0);
    let calls = 0;
    host.answer('queue.insertNext', () => {
      calls += 1;
      return calls === 2
        ? hostFailure('INVALID_PARAMS')
        : { success: true, insertedCount: 256, movedCount: 0, queueCount: 256, invalidCount: 0 };
    });
    expect(await queueNext(host.fb, paths(700))).toBe(false);
    expect(host.callsTo('queue.insertNext')).toHaveLength(2);
  });

  it('专用列表不可写也不影响入队', async () => {
    const host = hostWithView();
    host.answer('library.addToPlaylist', hostFailure('LOCKED'));
    expect(await queueNext(host.fb, paths(2))).toBe(true);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
  });
});

describe('queueLast', () => {
  it('按路径插入当前队尾，不改专用列表', async () => {
    const host = hostWithView(4);
    host.answer('queue.getCount', { success: true, count: 7, hasItems: true });
    expect(await queueLast(host.fb, paths(3))).toBe(true);
    expect(host.callsTo('queue.insertNext')).toEqual([{ paths: paths(3), position: 7 }]);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
  });
});

describe('发送到', () => {
  it('目标清单按 GUID 认，带锁定标记；读不到就是空的', async () => {
    const host = hostWithView();
    expect(await readSendTargets(host.fb)).toEqual([
      { guid: playlistGuid(0), name: 'Default', locked: false },
      { guid: playlistGuid(1), name: 'Locked', locked: true },
      { guid: playlistGuid(2), name: LIBRARY_VIEW_PLAYLIST, locked: false },
    ]);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    expect(await readSendTargets(host.fb)).toEqual([]);
  });

  it('宿主自己建的两张不进目标清单', async () => {
    const host = installFakeHost();
    const playlists = [
      playlistRow(0, '[WebView Queue]'),
      playlistRow(1, 'Default'),
      playlistRow(2, '__webview_buffer__', { isLocked: true }),
    ];
    host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
    expect(await readSendTargets(host.fb)).toEqual([
      { guid: playlistGuid(1), name: 'Default', locked: false },
    ]);
  });

  it('复制到已有列表：按 GUID 发，不再现读清单', async () => {
    const host = hostWithView();
    const [target] = await readSendTargets(host.fb);
    expect(await sendToPlaylist(host.fb, paths(2), target!)).toBe(true);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: paths(2), playlistGuid: playlistGuid(0) },
    ]);
    expect(host.callsTo('playlist.getAll')).toHaveLength(1);
  });

  it('菜单开着期间前面的同名列表被删、选的那张挪到了前面：照打开菜单时的 GUID 发，不重读清单', async () => {
    const host = hostWithView();
    const twins = [playlistRow(0, 'Mix'), playlistRow(1, 'Other'), playlistRow(2, 'Mix')];
    host.answer('playlist.getAll', { success: true, playlists: twins, count: 3 });
    const second = (await readSendTargets(host.fb))[2];
    const shifted = [
      playlistRow(0, 'Other', { guid: playlistGuid(1) }),
      playlistRow(1, 'Mix', { guid: playlistGuid(2) }),
    ];
    host.answer('playlist.getAll', { success: true, playlists: shifted, count: 2 });
    expect(await sendToPlaylist(host.fb, paths(1), second!)).toBe(true);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: paths(1), playlistGuid: playlistGuid(2) },
    ]);
    expect(host.callsTo('playlist.getAll')).toHaveLength(1);
  });

  it('那张列表已经删了（NOT_FOUND）或锁着（LOCKED）：宿主拒收，答 false', async () => {
    const host = hostWithView();
    const [target] = await readSendTargets(host.fb);
    host.answer('library.addToPlaylist', hostFailure('NOT_FOUND'));
    expect(await sendToPlaylist(host.fb, paths(2), target!)).toBe(false);
    host.answer('library.addToPlaylist', hostFailure('LOCKED'));
    expect(await sendToPlaylist(host.fb, paths(2), target!)).toBe(false);
  });

  it('没有曲目不发', async () => {
    const host = hostWithView();
    const [target] = await readSendTargets(host.fb);
    expect(await sendToPlaylist(host.fb, [], target!)).toBe(false);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
  });

  it('新建一张再按它的 GUID 复制进去；建不成就不复制', async () => {
    const host = hostWithView();
    host.answer('playlist.create', { success: true, index: 3, guid: playlistGuid(3) });
    expect(await sendToNewPlaylist(host.fb, paths(1), 'Blue')).toBe(true);
    expect(host.callsTo('playlist.create')).toEqual([{ name: 'Blue' }]);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: paths(1), playlistGuid: playlistGuid(3) },
    ]);
    host.answer('playlist.create', hostFailure('OPERATION_FAILED'));
    expect(await sendToNewPlaylist(host.fb, paths(1), 'Blue')).toBe(false);
    expect(host.callsTo('library.addToPlaylist')).toHaveLength(1);
  });
});
