import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  albumMenuAtom,
  hasCommandId,
  MENU_HANDLES_LIMIT,
  menuCommandOf,
  menuPathsOf,
  startAlbumMenu,
  UNION_ALBUM_LIMIT,
  UNION_TRACK_LIMIT,
} from '../../../src/library/albumMenu.ts';
import type { ContextTree } from '../../../src/host/contextMenu.ts';
import { hostFailure, stringParam } from '../../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow, playlistGuid } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

/** 每张专辑答两首，第二首是 CUE 分轨。 */
function answerTracks(host: UnitHost, perAlbum = 2) {
  host.answer('library.getAlbumTracks', (params) => {
    const album = stringParam(params, 'album');
    const tracks: LibraryTrack[] = Array.from({ length: perAlbum }, (_, at) =>
      albumTrackRow(album, stringParam(params, 'albumArtist'), `${album}-${at + 1}`, {
        trackNumber: at + 1,
        ...(at === 1 ? { path: `file://E:\\${album}.cue`, subsong: 2 } : {}),
      }),
    );
    return {
      success: true,
      album,
      albumArtist: stringParam(params, 'albumArtist'),
      tracks,
      items: tracks,
      total: tracks.length,
    };
  });
}

function setup(host: UnitHost) {
  const store = createStore();
  const menu = startAlbumMenu(store, host.fb);
  return { store, menu, state: () => store.get(albumMenuAtom) };
}

describe('prepare', () => {
  it('按阅读顺序逐张取曲目首尾相接，读「发送到」目标，再对着这批路径读命令树', async () => {
    const host = installFakeHost();
    answerTracks(host);
    const { menu, state } = setup(host);
    const albums = [albumRow('B', 'X'), albumRow('A', 'Y')];
    await menu.prepare(albums);
    expect(host.callsTo('library.getAlbumTracks')).toEqual([
      { album: 'B', albumArtist: 'X' },
      { album: 'A', albumArtist: 'Y' },
    ]);
    expect(state()).toMatchObject({ albums, loading: false, limited: false, failed: false });
    expect(state().tracks.map((track) => track.title)).toEqual(['B-1', 'B-2', 'A-1', 'A-2']);
    expect(state().targets).toEqual([{ guid: playlistGuid(0), name: 'Default', locked: false }]);
    expect(host.callsTo('menu.getContextMenu')).toEqual([
      {
        mode: 'handles',
        handles: [
          'file://E:\\Music\\B\\B-1.flac',
          'file://E:\\B.cue|subsong:2',
          'file://E:\\Music\\A\\A-1.flac',
          'file://E:\\A.cue|subsong:2',
        ],
        locale: 'en',
      },
    ]);
    expect(menuPathsOf(state())).toHaveLength(4);
  });

  it('多选过了张数或首数上限就不取曲目，命令一直不可用', async () => {
    const host = installFakeHost();
    const { menu, state } = setup(host);
    const many = Array.from({ length: UNION_ALBUM_LIMIT + 1 }, (_, at) => albumRow(`A${at}`, 'X'));
    await menu.prepare(many);
    expect(state()).toMatchObject({ limited: true, loading: false });
    const heavy = [
      albumRow('A', 'X', { trackCount: UNION_TRACK_LIMIT }),
      albumRow('B', 'X', { trackCount: 1 }),
    ];
    await menu.prepare(heavy);
    expect(state().limited).toBe(true);
    expect(host.callsTo('library.getAlbumTracks')).toEqual([]);
    expect(menuPathsOf(state())).toBeNull();
    const single = albumRow('Huge', 'X', { trackCount: UNION_TRACK_LIMIT * 2 });
    await menu.prepare([single]);
    expect(state().limited).toBe(false);
  });

  it('曲目过了建树的上限就不读命令树', async () => {
    const host = installFakeHost();
    answerTracks(host, MENU_HANDLES_LIMIT + 1);
    const { menu, state } = setup(host);
    await menu.prepare([albumRow('A', 'X')]);
    expect(state().tracks).toHaveLength(MENU_HANDLES_LIMIT + 1);
    expect(host.callsTo('menu.getContextMenu')).toEqual([]);
  });

  it('取曲目失败记下 failed，命令不可用', async () => {
    const host = installFakeHost();
    host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    const { menu, state } = setup(host);
    await menu.prepare([albumRow('A', 'X')]);
    expect(state()).toMatchObject({ failed: true, loading: false, tracks: [] });
    expect(menuPathsOf(state())).toBeNull();
  });

  it('连着打开两次，先打开的那一批晚到的曲目丢掉', async () => {
    const host = installFakeHost();
    answerTracks(host);
    const held = host.hold('library.getAlbumTracks');
    const { menu, state } = setup(host);
    const first = menu.prepare([albumRow('Old', 'X')]);
    await Promise.resolve();
    const second = menu.prepare([albumRow('New', 'X')]);
    await Promise.resolve();
    held.respond(1);
    await second;
    held.respond(0);
    await first;
    expect(state().albums.map((album) => album.name)).toEqual(['New']);
    expect(state().tracks.map((track) => track.album)).toEqual(['New', 'New']);
  });

  it('名字带双引号的专辑建不了智能列表', async () => {
    const host = installFakeHost();
    answerTracks(host);
    const { menu, state } = setup(host);
    await menu.prepare([albumRow('Say "Hi"', 'X')]);
    expect(state().canCreateAutoplaylist).toBe(false);
    await menu.prepare([albumRow('Blue', 'X')]);
    expect(state().canCreateAutoplaylist).toBe(true);
  });

  it('没连上宿主时只记下作用对象，一个请求都不发', async () => {
    const host = installFakeHost({ available: false });
    const { menu, state } = setup(host);
    await menu.prepare([albumRow('A', 'X')]);
    expect(state()).toMatchObject({ loading: false, tracks: [] });
    expect(host.calls).toEqual([]);
  });
});

describe('prepareTracks', () => {
  it('作用对象只是这一首：记下它在专辑里是第几首，对着它一条路径读命令树与发送目标', async () => {
    const host = installFakeHost();
    const { menu, state } = setup(host);
    const album = albumRow('A', 'X');
    const track = albumTrackRow('A', 'X', 'A-2', { path: 'file://E:\\A.cue', subsong: 2 });
    await menu.prepareTracks(album, [track], 1);
    expect(state()).toMatchObject({ albums: [album], tracks: [track], trackIndex: 1 });
    expect(state()).toMatchObject({ loading: false, canCreateAutoplaylist: false });
    expect(state().targets).toEqual([{ guid: playlistGuid(0), name: 'Default', locked: false }]);
    expect(host.callsTo('library.getAlbumTracks')).toEqual([]);
    expect(host.callsTo('menu.getContextMenu')).toEqual([
      { mode: 'handles', handles: ['file://E:\\A.cue|subsong:2'], locale: 'en' },
    ]);
    expect(menuPathsOf(state())).toEqual(['file://E:\\A.cue|subsong:2']);
  });

  it('专辑菜单与曲目菜单共用一份状态，后开的作数；专辑菜单的 trackIndex 为 null', async () => {
    const host = installFakeHost();
    answerTracks(host);
    const { menu, state } = setup(host);
    const held = host.hold('menu.getContextMenu');
    const first = menu.prepareTracks(albumRow('A', 'X'), [albumTrackRow('A', 'X', 'A-1')], 0);
    const second = menu.prepare([albumRow('B', 'X')]);
    await expect.poll(() => held.pending.length).toBe(2);
    held.release();
    await Promise.all([first, second]);
    expect(state()).toMatchObject({ trackIndex: null, albums: [albumRow('B', 'X')] });
  });

  it('下拉多选按给定曲序建命令树，保留评分戳和落点', async () => {
    const host = installFakeHost();
    const { menu, state } = setup(host);
    const album = albumRow('A', 'X');
    const tracks = [albumTrackRow('A', 'X', 'A-1'), albumTrackRow('A', 'X', 'A-3')];
    await menu.prepareTracks(album, tracks, 2, 19);
    const paths = tracks.map((track) => track.path);
    expect(state()).toMatchObject({ tracks, trackIndex: 2, ratingStamp: 19 });
    expect(menuPathsOf(state())).toEqual(paths);
    expect(host.callsTo('menu.getContextMenu')).toEqual([
      { mode: 'handles', handles: paths, locale: 'en' },
    ]);
  });
});

describe('「更多命令」', () => {
  const rate = { type: 'command', label: 'Rate', commandId: 3 } as const;
  const tree: ContextTree = {
    target: { mode: 'handles', handles: ['file://E:\\a.flac'] },
    roots: [
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Playback Statistics',
        displayLabel: 'Playback Statistics',
        path: 'Playback Statistics',
        displayPath: 'Playback Statistics',
        children: [
          { ...rate, displayLabel: 'Rate', path: 'Rate', displayPath: 'Rate', available: true },
        ],
      },
    ],
  };

  it('有编号的命令才能执行；子菜单、分隔符与没有编号的命令不能', () => {
    expect(hasCommandId({ type: 'command', label: 'Rate', commandId: 3 })).toBe(true);
    expect(hasCommandId({ type: 'command', label: 'Guid only', guid: '{A}' })).toBe(false);
    expect(hasCommandId({ type: 'submenu', label: 'More', commandId: 4 })).toBe(false);
    expect(hasCommandId({ type: 'separator' })).toBe(false);
  });

  it('点中的节点按对象认回这棵树里的命令，子菜单里的也认得出', () => {
    const inner = tree.roots[1]?.type === 'submenu' ? tree.roots[1].children[0] : undefined;
    expect(inner).toBeDefined();
    expect(menuCommandOf(tree, inner!)).toBe(inner);
  });

  it('别的树里一模一样的节点认不回命令：编号只在生成它的那棵树里有意义', () => {
    const inner = tree.roots[1]?.type === 'submenu' ? tree.roots[1].children[0] : undefined;
    expect(menuCommandOf(tree, { ...inner! })).toBeUndefined();
  });

  it('子菜单与分隔符不是命令', () => {
    expect(menuCommandOf(tree, tree.roots[1]!)).toBeUndefined();
    expect(menuCommandOf(tree, tree.roots[0]!)).toBeUndefined();
  });
});
