import { describe, expect, it } from 'vitest';
import { LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import {
  readSendTargets,
  sendToNewPlaylist,
  sendToPlaylist,
} from '../../../src/track/trackListActions.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
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

describe('发送到', () => {
  it('目标清单按 GUID 认，带锁定标记，不列主题的专用列表；读不到就是空的', async () => {
    const host = hostWithView();
    expect(await readSendTargets(host.fb)).toEqual([
      { guid: playlistGuid(0), name: 'Default', locked: false },
      { guid: playlistGuid(1), name: 'Locked', locked: true },
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
