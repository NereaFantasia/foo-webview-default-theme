import { expect, it, vi } from 'vitest';
import { foldersWrite } from '../../../../../src/library/folders/actions/foldersWrites.ts';
import { LIBRARY_VIEW_PLAYLIST } from '../../../../../src/playback/libraryView.ts';
import { installFakeQueue, queueTracks } from '../../../../fixtures/fakeQueue.ts';
import { playlistRow } from '../../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

it('文件夹按路径入队保留分轨，不读取或追加专用列表', async () => {
  const host = installFakeHost();
  const queue = installFakeQueue(host, queueTracks('queued'));
  const paths = ['E:/Music/disc.cue|subsong:2', 'E:/Music/b.flac'];
  expect(await foldersWrite(host.fb, paths, 'next', '', 0, () => true)).toBe(true);
  expect(host.callsTo('queue.insertNext')[0]).toEqual({ paths, position: 0 });
  expect(queue.items).toHaveLength(3);
  expect(host.callsTo('playlist.getAll')).toEqual([]);
  expect(host.callsTo('library.addToPlaylist')).toEqual([]);
});

it('文件夹起播保留已有手动队列', async () => {
  const host = installFakeHost();
  const list = playlistRow(2, LIBRARY_VIEW_PLAYLIST, { trackCount: 2 });
  host.answer('playlist.getAll', { success: true, playlists: [list], count: 1 });
  const queue = installFakeQueue(host, queueTracks('queued'));
  expect(await foldersWrite(host.fb, ['E:/a.flac', 'E:/b.flac'], 'play', '', 1, () => true)).toBe(
    true,
  );
  expect(queue.titles()).toEqual(['queued']);
  expect(host.callsTo('queue.insertNext')[0]).toEqual({
    items: [{ playlist: 2, item: 1 }],
    position: 0,
  });
  expect(host.callsTo('playlist.playTrack')).toEqual([]);
});

it('文件夹操作等待队尾长度期间取消，不再发送曲目', async () => {
  const host = installFakeHost();
  let active = true;
  const held = host.hold('queue.getCount');
  const pending = foldersWrite(host.fb, ['E:/a.flac'], 'queue', '', 0, () => active);
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  active = false;
  held.release();
  expect(await pending).toBe(false);
  expect(host.callsTo('queue.insertNext')).toEqual([]);
});
