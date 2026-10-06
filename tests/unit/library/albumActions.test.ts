import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import type { AlbumInfo, LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startLocale } from '../../../src/i18n/locale.ts';
import { albumSource, startAlbumActions } from '../../../src/library/albumActions.ts';
import { startAlbumBrowse } from '../../../src/library/albums/albumBrowse.ts';
import {
  albumMenuAtom,
  startAlbumMenu,
  UNION_ALBUM_LIMIT,
} from '../../../src/library/albumMenu.ts';
import { ALBUM_LIMIT } from '../../../src/library/albums.ts';
import { startAlbumSelection } from '../../../src/library/albums/albumSelection.ts';
import { startBrowserPrefs } from '../../../src/library/albums/browserPrefs.ts';
import { LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import type { PlaybackSource } from '../../../src/playback/playbackSource.ts';
import { startTrackActions, trackActionsNoticeAtom } from '../../../src/track/trackActions.ts';
import { hostFailure, listParam, stringParam } from '../../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow, playlistGuid, playlistRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const VIEW = 3;

/** 专用列表在第 3 张、已有 10 行；每张专辑答两首。 */
function libraryHost(options: { available?: boolean } = {}) {
  const host = installFakeHost(options);
  const playlists = [
    playlistRow(0, 'Default'),
    playlistRow(VIEW, LIBRARY_VIEW_PLAYLIST, { trackCount: 10 }),
  ];
  host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
  host.answer('library.getAlbumTracks', (params) => {
    const album = stringParam(params, 'album');
    const albumArtist = stringParam(params, 'albumArtist');
    const tracks: LibraryTrack[] = [1, 2].map((at) =>
      albumTrackRow(album, albumArtist, `${album}${at}`, { trackNumber: at }),
    );
    return {
      success: true,
      album,
      albumArtist,
      tracks,
      items: tracks,
      total: 2,
    };
  });
  host.answer('playlist.createAutoplaylist', (params) => ({
    success: true,
    index: 5,
    guid: '{00000000-0000-0000-0000-000000000005}',
    playlist: 5,
    name: stringParam(params, 'name'),
    query: stringParam(params, 'query'),
  }));
  return host;
}

function setup(host: UnitHost) {
  const store = createStore();
  const menu = startAlbumMenu(store, host.fb);
  const recorded: PlaybackSource[] = [];
  const tracks = startTrackActions(store, { record: (source) => recorded.push(source) }, host.fb);
  const actions = startAlbumActions(store, tracks, host.fb);
  return {
    store,
    menu,
    actions,
    tracks,
    recorded,
    notice: () => store.get(trackActionsNoticeAtom),
  };
}

const pathsOf = (album: string) => [
  `file://E:\\Music\\${album}\\${album}1.flac`,
  `file://E:\\Music\\${album}\\${album}2.flac`,
];

describe('起播', () => {
  it('取这张的曲目整份换进专用列表，从第 index 首起播，来源记成这张专辑', async () => {
    const host = libraryHost();
    const { actions, recorded, notice } = setup(host);
    expect(await actions.play(albumRow('Blue', 'Joni'), 1)).toBe(true);
    expect(host.callsTo('library.getAlbumTracks')).toEqual([
      { album: 'Blue', albumArtist: 'Joni' },
    ]);
    expect(host.callsTo('playlist.clear')).toEqual([{ playlistGuid: playlistGuid(VIEW) }]);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: pathsOf('Blue'), playlistGuid: playlistGuid(VIEW) },
    ]);
    expect(host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: playlistGuid(VIEW), index: 1 },
    ]);
    expect(notice()).toBeNull();
    expect(recorded).toEqual([albumSource(albumRow('Blue', 'Joni'))]);
  });

  it('取曲目失败就不动专用列表，挂播放失败；下一次成功清掉', async () => {
    const host = libraryHost();
    const { actions, recorded, notice } = setup(host);
    host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    expect(await actions.play(albumRow('Blue', 'Joni'))).toBe(false);
    expect(host.callsTo('playlist.clear')).toEqual([]);
    expect(recorded).toEqual([]);
    expect(notice()).toBe('album.playFailed');
    host.answer('library.getAlbumTracks', {
      success: true,
      album: 'A',
      albumArtist: 'X',
      tracks: [albumTrackRow('A', 'X', 'a')],
      items: [],
      total: 1,
    });
    expect(await actions.play(albumRow('A', 'X'))).toBe(true);
    expect(notice()).toBeNull();
  });

  it('一串没跑完时再点不执行，挂忙碌提示；它留到下一次被收下才清', async () => {
    const host = libraryHost();
    const held = host.hold('playlist.playTrack');
    const { actions, notice } = setup(host);
    const first = actions.play(albumRow('A', 'X'));
    expect(await actions.play(albumRow('B', 'X'))).toBe(false);
    expect(notice()).toBe('album.busy');
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.release();
    expect(await first).toBe(true);
    expect(notice()).toBe('album.busy');
    expect(await actions.play(albumRow('B', 'X'))).toBe(true);
    expect(notice()).toBeNull();
    expect(host.callsTo('library.getAlbumTracks').map((call) => call['album'])).toEqual(['A', 'B']);
  });

  it('没连上宿主时一个请求都不发', async () => {
    const host = libraryHost({ available: false });
    const { actions } = setup(host);
    expect(await actions.play(albumRow('A', 'X'))).toBe(false);
    expect(host.calls).toEqual([]);
  });
});

describe('专辑菜单的命令作用于准备好的那一批', () => {
  it('发送到已有列表按这批曲目', async () => {
    const host = libraryHost();
    const { store, menu, actions } = setup(host);
    await menu.prepare([albumRow('A', 'X'), albumRow('B', 'Y')]);
    const [target] = store.get(albumMenuAtom).targets;
    expect(await actions.sendTo(target!)).toBe(true);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: [...pathsOf('A'), ...pathsOf('B')], playlistGuid: playlistGuid(0) },
    ]);
  });

  it('发送到新列表：一张叫专辑名，多张叫「首张 等 N 张」', async () => {
    const host = libraryHost();
    const { store, menu, actions } = setup(host);
    await startLocale(store, host.fb).ready;
    await menu.prepare([albumRow('Blue', 'Joni')]);
    await actions.sendToNew();
    await menu.prepare([albumRow('A', 'X'), albumRow('B', 'X'), albumRow('C', 'X')]);
    await actions.sendToNew();
    expect(host.callsTo('playlist.create').map((call) => call['name'])).toEqual([
      'Blue',
      'A 等 3 张',
    ]);
  });

  it('下拉里右键一首曲目：发送只作用于这一首，发送到新列表叫曲名', async () => {
    const host = libraryHost();
    const { store, menu, actions } = setup(host);
    await startLocale(store, host.fb).ready;
    const album = albumRow('Blue', 'Joni');
    const track = albumTrackRow('Blue', 'Joni', 'River', { trackNumber: 2 });
    await menu.prepareTracks(album, [track], 1);
    const [target] = store.get(albumMenuAtom).targets;
    expect(await actions.sendTo(target!)).toBe(true);
    expect(host.callsTo('library.addToPlaylist').at(-1)).toEqual({
      paths: ['file://E:\\Music\\Blue\\River.flac'],
      playlistGuid: playlistGuid(0),
    });
    await actions.sendToNew();
    expect(host.callsTo('playlist.create').map((call) => call['name'])).toEqual(['River']);
  });

  it('下拉多选发送全部所选曲目，新列表用专辑名', async () => {
    const host = libraryHost();
    const { store, menu, actions } = setup(host);
    await startLocale(store, host.fb).ready;
    const album = albumRow('Blue', 'Joni');
    const tracks = ['River', 'Blue'].map((title) => albumTrackRow('Blue', 'Joni', title));
    await menu.prepareTracks(album, tracks, 1);
    expect(await actions.sendToNew()).toBe(true);
    expect(host.callsTo('library.addToPlaylist').at(-1)?.['paths']).toEqual(
      tracks.map((track) => track.path),
    );
    expect(host.callsTo('playlist.create').at(-1)?.['name']).toBe('Blue');
  });

  it('没有专辑名的专辑取不到曲目，发送到新列表不建', async () => {
    const host = libraryHost();
    const { menu, actions } = setup(host);
    await menu.prepare([albumRow('', 'X')]);
    expect(await actions.sendToNew()).toBe(false);
    expect(host.callsTo('playlist.create')).toEqual([]);
  });

  it('发送到已有列表按 GUID 发；列表锁着或已经删了，宿主拒收时挂命令失败', async () => {
    const host = libraryHost();
    const { store, menu, actions, tracks, notice } = setup(host);
    await menu.prepare([albumRow('A', 'X')]);
    const [target] = store.get(albumMenuAtom).targets;
    expect(target).toEqual({ guid: playlistGuid(0), name: 'Default', locked: false });
    expect(await actions.sendTo(target!)).toBe(true);
    host.answer('library.addToPlaylist', hostFailure('LOCKED'));
    expect(await actions.sendTo(target!)).toBe(false);
    expect(notice()).toBe('album.commandFailed');
    tracks.dismissNotice();
    host.answer('library.addToPlaylist', hostFailure('NOT_FOUND'));
    expect(await actions.sendTo(target!)).toBe(false);
    expect(notice()).toBe('album.commandFailed');
    expect(host.callsTo('library.addToPlaylist')).toHaveLength(3);
  });

  it('建智能列表按取曲目同一口径拼查询，建成后切为活动列表', async () => {
    const host = libraryHost();
    const { menu, actions } = setup(host);
    await menu.prepare([albumRow('Mix', 'DJ A')]);
    expect(await actions.createAutoplaylist()).toBe(true);
    expect(host.callsTo('playlist.createAutoplaylist')).toEqual([
      {
        name: 'Mix',
        query: 'album IS "Mix" AND ("album artist" IS "DJ A" OR artist IS "DJ A")',
        keepSorted: false,
      },
    ]);
    expect(host.callsTo('playlist.setActive')).toEqual([{ playlist: 5 }]);
    await menu.prepare([albumRow('Say "Hi"', 'X')]);
    expect(await actions.createAutoplaylist()).toBe(false);
    expect(host.callsTo('playlist.createAutoplaylist')).toHaveLength(1);
  });

  it('曲目没到手或过了上限时不发', async () => {
    const host = libraryHost();
    const held = host.hold('library.getAlbumTracks');
    const { store, menu, actions } = setup(host);
    const pending = menu.prepare([albumRow('A', 'X')]);
    expect(store.get(albumMenuAtom).loading).toBe(true);
    expect(await actions.sendToNew()).toBe(false);
    held.release();
    await pending;
    const many = Array.from({ length: UNION_ALBUM_LIMIT + 1 }, (_, at) => albumRow(`A${at}`, 'X'));
    await menu.prepare(many);
    expect(await actions.sendToNew()).toBe(false);
    expect(host.callsTo('library.addToPlaylist')).toEqual([]);
    expect(host.callsTo('playlist.create')).toEqual([]);
  });
});

describe('右键的作用对象到命令', () => {
  const ALBUMS = ['A', 'B', 'C'].map((name) => albumRow(name, 'X'));
  const PLAIN = { ctrl: false, shift: false };
  const CTRL = { ctrl: true, shift: false };

  async function wall() {
    const host = libraryHost();
    const answer: {
      success: true;
      albums: AlbumInfo[];
      total: number;
      offset: number;
      limit: number;
      hasMore: boolean;
      includeCover: boolean;
      fromCache: boolean;
    } = {
      success: true,
      albums: ALBUMS,
      total: 3,
      offset: 0,
      limit: ALBUM_LIMIT,
      hasMore: false,
      includeCover: false,
      fromCache: false,
    };
    host.answer('library.getAlbums', answer);
    const parts = setup(host);
    startBrowserPrefs(parts.store, host.fb, createMemoryConfigWriter(host.fb));
    await startAlbumBrowse(parts.store, host.fb, createMemoryConfigWriter(host.fb)).ready;
    const selection = startAlbumSelection(parts.store);
    selection.activate(ALBUMS[0]!, PLAIN);
    selection.activate(ALBUMS[1]!, CTRL);
    const send = () => parts.actions.sendTo(parts.store.get(albumMenuAtom).targets[0]!);
    const sent = () =>
      host.callsTo('library.addToPlaylist').map((call) => listParam(call, 'paths').length);
    return { ...parts, selection, send, sent };
  }

  it('封面在选择里：整个选择都发送', async () => {
    const { menu, selection, send, sent } = await wall();
    await menu.prepare(selection.menuTargets(ALBUMS[1]!));
    await send();
    expect(sent()).toEqual([4]);
  });

  it('封面不在选择里：只发送这一张', async () => {
    const { menu, selection, send, sent } = await wall();
    await menu.prepare(selection.menuTargets(ALBUMS[2]!));
    await send();
    expect(sent()).toEqual([2]);
  });
});
