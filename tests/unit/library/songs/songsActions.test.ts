import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { exclusive, LIBRARY_VIEW_PLAYLIST } from '../../../../src/playback/libraryView.ts';
import {
  songsActionsNoticeAtom,
  startSongsActions,
  type SongsRun,
} from '../../../../src/library/songs/songsActions.ts';
import type { RecordedSource } from '../../../../src/playback/playbackSource.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { playlistRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const VIEW = playlistRow(2, LIBRARY_VIEW_PLAYLIST);
const RUN: SongsRun = {
  fill: { query: '%__encoding% IS lossless', sort: '%title%', descending: false },
  label: '无损',
};

function setup() {
  const host = installFakeHost();
  host.answer('playlist.getAll', { success: true, playlists: [VIEW], count: 1 });
  host.answer('library.query', {
    success: true,
    total: 1,
    tracks: [{ handle: 'h', path: 'file://E:/h.flac', subsong: 0 }],
  });
  host.answer('library.addToPlaylist', (params) => ({
    success: true,
    added: (params['paths'] as unknown[] | undefined)?.length ?? 0,
  }));
  host.answer('playlist.getTracks', {
    success: true,
    playlist: 2,
    start: 0,
    count: 1,
    total: 1,
    tracks: [{ index: 0, handle: 'h' }],
  });
  const store = createStore();
  const recorded: RecordedSource[] = [];
  const actions = startSongsActions(store, { record: (source) => recorded.push(source) }, host.fb);
  onTestFinished(() => actions.dispose());
  return { host, store, actions, recorded, notice: () => store.get(songsActionsNoticeAtom) };
}

describe('歌曲页的起播', () => {
  it('向宿主要路径途中释放：不清空专用列表、不起播、不记来源', async () => {
    const { host, actions, recorded } = setup();
    const held = host.hold('library.query');
    const pending = actions.play(RUN, 'shuffle');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    actions.dispose();
    held.release();
    expect(await pending).toBe(false);
    expect(host.callsTo('playlist.clear')).toEqual([]);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('新建列表的应答晚于释放时，移除本次新建的列表，不填表', async () => {
    const { host, actions } = setup();
    const held = host.hold('playlist.create');
    const pending = actions.sendToNew(RUN, '歌曲');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    actions.dispose();
    held.release();
    expect(await pending).toBe(false);
    expect(host.callsTo('playlist.remove')).toEqual([
      { playlistGuid: '{00000000-0000-0000-0000-000000000001}' },
    ]);
    expect(host.callsTo('playlist.clear')).toEqual([]);
  });

  it('起播成功后记下来源：主体是查询、名字是条件', async () => {
    const { actions, recorded, notice } = setup();
    expect(await actions.play(RUN, { row: 0, handle: 'h' })).toBe(true);
    expect(recorded).toEqual([{ kind: 'songs', subject: RUN.fill.query, name: '无损' }]);
    expect(notice()).toBeNull();
  });

  it('失败挂横幅、不记来源；专用列表正忙时不跑、挂忙碌提示', async () => {
    const { host, store, actions, recorded, notice } = setup();
    host.answer('playlist.clear', hostFailure('LOCKED'));
    expect(await actions.play(RUN, 'shuffle')).toBe(false);
    expect(notice()).toBe('songs.playFailed');
    let release = () => {};
    const busy = exclusive(
      store,
      () => new Promise<boolean>((done) => (release = () => done(true))),
    );
    expect(await actions.play(RUN, 'shuffle')).toBe(false);
    expect(notice()).toBe('album.busy');
    release();
    await busy;
    expect(recorded).toEqual([]);
  });
});

describe('成批命令', () => {
  it('建自动列表与发送到新列表都按查询，失败挂命令失败', async () => {
    const { host, actions, notice } = setup();
    host.answer('playlist.createAutoplaylist', hostFailure('OPERATION_FAILED'));
    expect(await actions.createAutoplaylist(RUN, '歌曲 · 无损')).toBe(false);
    expect(notice()).toBe('songs.commandFailed');
    expect(await actions.sendToNew(RUN, '歌曲 · 无损')).toBe(true);
    expect(host.callsTo('playlist.create')).toEqual([{ name: '歌曲 · 无损' }]);
    expect(notice()).toBeNull();
  });
});
