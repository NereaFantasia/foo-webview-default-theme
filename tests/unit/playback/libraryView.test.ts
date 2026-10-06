import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  appendToLibraryView,
  ensureLibraryView,
  exclusive,
  LIBRARY_VIEW_PLAYLIST,
  libraryViewBusyAtom,
  replaceAndPlay,
} from '../../../src/playback/libraryView.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { playlistRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { installFakeQueue, queueTracks } from '../../fixtures/fakeQueue.ts';

const PATHS = ['file://E:\\a.flac', 'file://E:\\b.cue|subsong:2'];

function hostWithView(trackCount = 3) {
  const host = installFakeHost();
  const playlists = [
    playlistRow(0, 'Default'),
    playlistRow(4, LIBRARY_VIEW_PLAYLIST, { trackCount }),
  ];
  host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
  return host;
}

describe('ensureLibraryView', () => {
  it('按名字现读清单找专用列表，带回它的 GUID 与此刻的行数', async () => {
    const host = hostWithView(7);
    const view = playlistRow(4, LIBRARY_VIEW_PLAYLIST);
    expect(await ensureLibraryView(host.fb)).toEqual({ index: 4, guid: view.guid, trackCount: 7 });
    expect(host.callsTo('playlist.create')).toEqual([]);
    expect(host.callsTo('playlist.removeAutoplaylist')).toEqual([]);
  });

  it('上一次按查询填表半途失败、留成了自动列表：先变回普通列表；变不回来答 null', async () => {
    const host = installFakeHost();
    const view = playlistRow(4, LIBRARY_VIEW_PLAYLIST, { isAutoplaylist: true, isLocked: true });
    host.answer('playlist.getAll', { success: true, playlists: [view], count: 1 });
    host.answer('playlist.removeAutoplaylist', {
      playlistGuid: view.guid,
      success: true,
      playlist: 4,
      source: 'sdk',
    });
    expect(await ensureLibraryView(host.fb)).toMatchObject({ index: 4, guid: view.guid });
    expect(host.callsTo('playlist.removeAutoplaylist')).toEqual([{ playlistGuid: view.guid }]);
    host.answer('playlist.removeAutoplaylist', {
      playlistGuid: view.guid,
      success: true,
      playlist: 4,
      source: 'dui',
    });
    expect(await ensureLibraryView(host.fb)).toBeNull();
    host.answer('playlist.removeAutoplaylist', hostFailure('NOT_FOUND'));
    expect(await ensureLibraryView(host.fb)).toBeNull();
  });

  it('没有就建一张；清单读不到或建不成时为 null', async () => {
    const host = installFakeHost();
    expect(await ensureLibraryView(host.fb)).toMatchObject({ index: 1, trackCount: 0 });
    expect(host.callsTo('playlist.create')).toEqual([{ name: LIBRARY_VIEW_PLAYLIST }]);
    host.answer('playlist.create', hostFailure('OPERATION_FAILED'));
    expect(await ensureLibraryView(host.fb)).toBeNull();
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    expect(await ensureLibraryView(host.fb)).toBeNull();
  });
});

describe('replaceAndPlay', () => {
  it('媒体库起播保留已有手动队列，目标按当前 GUID 寻址', async () => {
    const host = hostWithView();
    const queue = installFakeQueue(host, queueTracks('queued-a', 'queued-b'));
    expect(await replaceAndPlay(host.fb, PATHS, 1)).toBe(true);
    expect(queue.titles()).toEqual(['queued-a', 'queued-b']);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
    expect(host.callsTo('queue.insertNext')).toEqual([
      { items: [{ playlist: 4, item: 1 }], position: 0 },
    ]);
  });
  it('找表、清空、加入、起播四步串行，起播不切活动列表', async () => {
    const host = hostWithView();
    expect(await replaceAndPlay(host.fb, PATHS, 1)).toBe(true);
    expect(host.calls.map((call) => call.method)).toEqual([
      'playlist.getAll',
      'playlist.clear',
      'library.addToPlaylist',
      'queue.getCount',
      'playlist.playTrack',
    ]);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: PATHS, playlistGuid: playlistRow(4, LIBRARY_VIEW_PLAYLIST).guid },
    ]);
    expect(host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: playlistRow(4, LIBRARY_VIEW_PLAYLIST).guid, index: 1 },
    ]);
    expect(host.callsTo('playlist.setActive')).toEqual([]);
  });

  it('清空失败就停，不半途起播', async () => {
    const host = hostWithView();
    host.answer('playlist.clear', hostFailure('LOCKED'));
    expect(await replaceAndPlay(host.fb, PATHS, 0)).toBe(false);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
  });

  it('加进去的比给的少时不起播：第 n 行已是另一首', async () => {
    const host = hostWithView();
    host.answer('library.addToPlaylist', { success: true, added: 1 });
    expect(await replaceAndPlay(host.fb, PATHS, 1)).toBe(false);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
  });

  it('起始行越界时一个请求都不发', async () => {
    const host = hostWithView();
    expect(await replaceAndPlay(host.fb, PATHS, 2)).toBe(false);
    expect(await replaceAndPlay(host.fb, [], 0)).toBe(false);
    expect(host.calls).toEqual([]);
  });
});

describe('appendToLibraryView', () => {
  it('追加在末尾、不清空，按原有行数算新行号', async () => {
    const host = hostWithView(5);
    expect(await appendToLibraryView(host.fb, PATHS)).toEqual({ playlist: 4, rows: [5, 6] });
    expect(host.callsTo('playlist.clear')).toEqual([]);
  });

  it('加进去的对不上就答 null', async () => {
    const host = hostWithView();
    host.answer('library.addToPlaylist', { success: true, added: 1 });
    expect(await appendToLibraryView(host.fb, PATHS)).toBeNull();
  });
});

describe('exclusive', () => {
  it('一串没跑完时第二串不跑，答 busy；跑完放开', async () => {
    const store = createStore();
    let release = () => {};
    const first = exclusive(
      store,
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    expect(store.get(libraryViewBusyAtom)).toBe(true);
    expect(await exclusive(store, async () => true)).toBe('busy');
    release();
    expect(await first).toBe(true);
    expect(store.get(libraryViewBusyAtom)).toBe(false);
    expect(await exclusive(store, async () => false)).toBe(false);
  });

  it('抛错也放开', async () => {
    const store = createStore();
    await expect(
      exclusive(store, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.get(libraryViewBusyAtom)).toBe(false);
  });
});
