import { expect, it, onTestFinished, vi } from 'vitest';
import {
  genresActionNoticeAtom,
  startGenresActions,
} from '../../../../src/library/genres/genresActions.ts';
import { LIBRARY_VIEW_PLAYLIST, exclusive } from '../../../../src/playback/libraryView.ts';
import { GENRE_TRACKS, genresLibrary } from '../../../fixtures/genresLibrary.ts';
import { playlistRow } from '../../../fixtures/libraryRows.ts';

const VIEW = playlistRow(2, LIBRARY_VIEW_PLAYLIST);
async function setup() {
  const env = genresLibrary();
  await env.ready();
  const deps = { record: vi.fn(), openSongs: vi.fn() };
  const actions = startGenresActions(env.store, deps, env.host.fb);
  onTestFinished(() => actions.dispose());
  env.host.answer('playlist.getAll', { success: true, playlists: [VIEW], count: 1 });
  env.host.answer('library.query', {
    success: true,
    total: 1,
    tracks: [
      {
        index: 0,
        handle: GENRE_TRACKS[1]!.handle,
        path: GENRE_TRACKS[1]!.path,
        subsong: GENRE_TRACKS[1]!.subsong,
      },
    ],
  });
  env.host.answer('library.addToPlaylist', (params) => ({
    success: true,
    added: (params['paths'] as unknown[] | undefined)?.length ?? 0,
  }));
  env.host.answer('playlist.getTracks', {
    success: true,
    playlist: 2,
    start: 0,
    count: 1,
    total: 2,
    tracks: [{ index: 0, handle: GENRE_TRACKS[1]!.handle }],
  });
  return { ...env, deps, actions, notice: () => env.store.get(genresActionNoticeAtom) };
}
it('页头播放从宿主排序后的第一首核对，成功才记流派来源', async () => {
  const env = await setup();
  expect(await env.actions.play(['Rock'], 'Rock')).toBe(true);
  expect(env.host.callsTo('library.query')[0]).toMatchObject({
    query: 'genre IS "Rock"',
    limit: 1,
    fields: ['handle'],
  });
  expect(env.host.callsTo('playlist.playTrack')).toEqual([{ playlistGuid: VIEW.guid, index: 0 }]);
  expect(env.deps.record.mock.calls).toEqual([[['Rock'], 'Rock']]);
});
it('专用列表忙时不交错清空；多选歌曲入口把整批流派交出去', async () => {
  const env = await setup();
  let release = () => {};
  const busy = exclusive(
    env.store,
    () =>
      new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      }),
  );
  expect(await env.actions.play(['Rock'], 'Rock')).toBe(false);
  expect(env.notice()).toBe('busy');
  expect(env.host.callsTo('playlist.clear')).toEqual([]);
  release();
  await busy;
  env.actions.openSongs(['Rock', 'Jazz']);
  expect(env.deps.openSongs.mock.calls).toEqual([[['Rock', 'Jazz']]]);
  env.actions.openSongs(['Gone']);
  expect(env.notice()).toBe('gone');
});
it('向宿主要曲目途中释放：不清空专用列表、不起播，也不记录来源', async () => {
  const env = await setup();
  const held = env.host.hold('library.query');
  const pending = env.actions.play(['Rock'], 'Rock', 'shuffle');
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.actions.dispose();
  held.release();
  expect(await pending).toBe(false);
  expect(env.host.callsTo('playlist.clear')).toEqual([]);
  expect(env.host.callsTo('playlist.playTrack')).toEqual([]);
  expect(env.deps.record.mock.calls).toEqual([]);
});
it('新列表建成前释放时补删该列表；不清空其他列表', async () => {
  const env = await setup();
  const held = env.host.hold('playlist.create');
  const pending = env.actions.send(['Rock'], 'Rock', false);
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.actions.dispose();
  held.release();
  expect(await pending).toBe(false);
  expect(env.host.callsTo('playlist.remove')).toEqual([
    { playlistGuid: '{00000000-0000-0000-0000-000000000001}' },
  ]);
  expect(env.host.callsTo('playlist.clear')).toEqual([]);
});
