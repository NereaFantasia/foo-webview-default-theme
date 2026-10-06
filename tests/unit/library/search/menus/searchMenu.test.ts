import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startNavHistory } from '../../../../../src/nav/navHistory.ts';
import { startAlbums } from '../../../../../src/library/albums.ts';
import { UNION_TRACK_LIMIT } from '../../../../../src/library/albumMenu.ts';
import { trackPathOf } from '../../../../../src/host/libraryContract.ts';
import { startSearchMenu } from '../../../../../src/library/search/menus/searchMenu.ts';
import { startSearchResults } from '../../../../../src/library/search/searchResults.ts';
import { albumRow, albumTrackRow } from '../../../../fixtures/libraryRows.ts';
import { hostFailure, stringParam } from '../../../../fixtures/hostAnswers.ts';
import { albumsAnswer } from '../../../../fixtures/albumLibrary.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';
import type { SearchHit } from '../../../../../src/library/search/searchQuery.ts';

async function setup(multiple = false) {
  const host = installFakeHost();
  const store = createStore();
  const history = startNavHistory(store);
  const album = albumRow('Album', 'Artist');
  const first = albumTrackRow('Album', 'Artist', 'First');
  const second = albumTrackRow('Album', 'Artist', 'Second', { subsong: 2 });
  const tracks = [first, second];
  const other = albumRow('Album B', 'Artist');
  const albums = multiple ? [album, other] : [album];
  host.answer('library.getAlbums', albumsAnswer(albums));
  host.answer('library.query', { success: true, tracks, total: tracks.length });
  host.answer('library.getAlbumTracks', (params) => {
    const name = stringParam(params, 'album');
    const rows = name === album.name ? tracks : [albumTrackRow(name, 'Artist', 'Other')];
    return {
      success: true,
      album: name,
      albumArtist: album.albumArtist,
      tracks: rows,
      items: rows,
      total: rows.length,
    };
  });
  const catalog = startAlbums(store, host.fb);
  const results = startSearchResults(store, catalog, host.fb);
  results.setText('Album', true);
  await vi.waitFor(() => expect(store.get(results.albums)).toHaveLength(albums.length));
  await vi.waitFor(() => expect(store.get(results.state).status).toBe('ready'));
  const menu = startSearchMenu(store, results, { findAlbum: () => album, stamp: () => 9 }, host.fb);
  onTestFinished(() => {
    menu.dispose();
    results.dispose();
    catalog.dispose();
  });
  return {
    host,
    store,
    history,
    album,
    albums,
    catalog,
    tracks,
    first,
    second,
    results,
    menu,
    state: () => store.get(menu.state),
  };
}

describe('搜索菜单', () => {
  it('多专辑合并曲目，创建的自动列表包含每张专辑', async () => {
    const { menu, state, host, albums, tracks } = await setup(true);
    const hits: SearchHit[] = albums.map((album) => ({ kind: 'album', album }));
    await menu.open(hits[0]!, hits);
    expect(state().paths).toEqual([
      ...tracks.map(trackPathOf),
      trackPathOf(albumTrackRow('Album B', 'Artist', 'Other')),
    ]);
    await menu.createAutoplaylist();
    const command = host.callsTo('playlist.createAutoplaylist').at(-1);
    expect(command?.['query']).toContain('album IS "Album"');
    expect(command?.['query']).toContain(' OR ');
    expect(command?.['query']).toContain('album IS "Album B"');
  });

  it('多专辑超过批量上限时不读取曲目，也不留下部分路径', async () => {
    const { menu, state, host, albums, catalog } = await setup(true);
    const large = albums.map((album) => ({ ...album, trackCount: UNION_TRACK_LIMIT }));
    host.answer('library.getAlbums', albumsAnswer(large));
    await catalog.retry();
    const hits: SearchHit[] = large.map((album) => ({ kind: 'album', album }));
    await menu.open(hits[0]!, hits);
    expect(state()).toMatchObject({ limited: true, loading: false, paths: [], tracks: [] });
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(0);
  });

  it('多选同专辑曲目只读一次，命令树包含整个选择且保持给定顺序', async () => {
    const { menu, state, host, second, first } = await setup();
    const hits: SearchHit[] = [second, first].map((track) => ({ kind: 'track', track }));
    await menu.open(hits[0]!, hits);
    const paths = [second, first].map(trackPathOf);
    expect(state()).toMatchObject({ hits, paths, failed: false, stamp: 9 });
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(1);
    expect(host.callsTo('menu.getContextMenu').at(-1)?.['handles']).toEqual(paths);
  });

  it('选择中任一曲目已不在专辑内时，不留下可执行的部分路径', async () => {
    const { menu, state, host, album, first, second } = await setup();
    host.answer('library.getAlbumTracks', {
      success: true,
      album: album.name,
      albumArtist: album.albumArtist,
      tracks: [first],
      items: [first],
      total: 1,
    });
    const hits: SearchHit[] = [first, second].map((track) => ({ kind: 'track', track }));
    await menu.open(hits[0]!, hits);
    expect(state()).toMatchObject({ failed: true, paths: [], tracks: [] });
    expect(host.callsTo('menu.getContextMenu')).toHaveLength(0);
  });

  it('专辑和其中曲目重叠时按路径去重，不重复发送', async () => {
    const { menu, state, album, first, tracks } = await setup();
    const hit: SearchHit = { kind: 'album', album };
    await menu.open(hit, [hit, { kind: 'track', track: first }]);
    expect(state().paths).toEqual(tracks.map(trackPathOf));
  });

  it('曲目只作用于该 handle，专辑作用于整张，保留读取前的评分戳', async () => {
    const { menu, state, album, tracks, second } = await setup();
    await menu.open({ kind: 'track', track: second });
    expect(state()).toMatchObject({
      tracks: [second],
      paths: [trackPathOf(second)],
      stamp: 9,
      failed: false,
    });
    await menu.open({ kind: 'album', album });
    expect(state().paths).toEqual(tracks.map(trackPathOf));
  });

  it.each(['query', 'navigation', 'dispose'] as const)(
    '%s 立即作废菜单，晚到曲目不重新打开',
    async (change) => {
      const { host, menu, state, first, results, history } = await setup();
      const held = host.hold('library.getAlbumTracks');
      const opening = menu.open({ kind: 'track', track: first });
      await vi.waitFor(() => expect(held.pending).toHaveLength(1));
      if (change === 'query') results.setText('different');
      else if (change === 'navigation') history.navigate({ id: 'settings' });
      else menu.dispose();
      expect(state().hit).toBeNull();
      held.release();
      await opening;
      expect(state().paths).toEqual([]);
      expect(menu.isCurrent()).toBe(false);
    },
  );

  it('快速改菜单对象，旧应答不能覆盖后开的曲目', async () => {
    const { host, menu, state, first, second } = await setup();
    const held = host.hold('library.getAlbumTracks');
    const earlier = menu.open({ kind: 'track', track: first });
    const later = menu.open({ kind: 'track', track: second });
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1);
    await later;
    held.respond(0);
    await earlier;
    expect(state().paths).toEqual([trackPathOf(second)]);
  });

  it('目标曲目已从专辑移除时，不拿搜索位置代替身份', async () => {
    const { host, menu, state, first, second, album } = await setup();
    host.answer('library.getAlbumTracks', {
      success: true,
      album: album.name,
      albumArtist: album.albumArtist,
      tracks: [first],
      items: [first],
      total: 1,
    });
    await menu.open({ kind: 'track', track: second });
    expect(state()).toMatchObject({ failed: true, paths: [], tracks: [] });
  });

  it('超过扩展菜单上限的专辑保留完整路径，不向宿主请求超量菜单', async () => {
    const { host, menu, state, album } = await setup();
    const tracks = Array.from({ length: 501 }, (_, index) =>
      albumTrackRow('Album', 'Artist', `Track ${index}`),
    );
    host.answer('library.getAlbumTracks', {
      success: true,
      album: album.name,
      albumArtist: album.albumArtist,
      tracks,
      items: tracks,
      total: tracks.length,
    });
    await menu.open({ kind: 'album', album });
    expect(state().paths).toEqual(tracks.map(trackPathOf));
    expect(state()).toMatchObject({ failed: false, loading: false, tree: { loading: false } });
    expect(host.callsTo('menu.getContextMenu')).toHaveLength(0);
  });

  it('创建自动列表失败保留页面提示；菜单关闭不吞掉已发出的命令结果', async () => {
    const { host, menu, store, album } = await setup();
    await menu.open({ kind: 'album', album });
    host.answer('playlist.createAutoplaylist', hostFailure('OPERATION_FAILED', 'failed'));
    const held = host.hold('playlist.createAutoplaylist');
    const creating = menu.createAutoplaylist();
    menu.close();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0, hostFailure('OPERATION_FAILED', 'failed'));
    await creating;
    expect(store.get(menu.notice)).toBe(true);
  });
});
