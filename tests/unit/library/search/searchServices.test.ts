import { atom, createStore } from 'jotai/vanilla';
import type { MusicPlatform } from '../../../../src/server/musicObjects.ts';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startNavHistory } from '../../../../src/nav/navHistory.ts';
import { startSearchServices } from '../../../../src/library/search/searchServices.ts';
import { trackPathOf } from '../../../../src/host/libraryContract.ts';
import { albumSource } from '../../../../src/library/albumActions.ts';
import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

type Music = Parameters<typeof startSearchServices>[1]['music'];

function setup(music: Music = { search: () => Promise.reject(new Error('本组用例不搜在线')) }) {
  const selected = atom<MusicPlatform>('wy');
  const host = installFakeHost();
  const store = createStore();
  const history = startNavHistory(store);
  const album = albumRow('Album', 'Artist');
  const tracks = [
    albumTrackRow('Album', 'Artist', 'First', { trackNumber: 1 }),
    albumTrackRow('Album', 'Artist', 'Second', { trackNumber: 2, subsong: 1 }),
  ];
  host.answer('library.getAlbumTracks', {
    success: true,
    album: album.name,
    albumArtist: album.albumArtist,
    tracks: [...tracks].reverse(),
    items: [...tracks].reverse(),
    total: tracks.length,
  });
  const playPaths = vi.fn(async () => true);
  const search = startSearchServices(store, {
    catalog: { retry: async () => {} },
    actions: { playPaths },
    configWriter: createMemoryConfigWriter(host.fb),
    music,
    sources: { selected },
    findAlbum: () => album,
    stamp: () => 0,
  });
  onTestFinished(() => search.dispose());
  return { host, store, search, history, tracks, album, playPaths, selected };
}

describe('搜索起播', () => {
  it('按 handle 在整张专辑中定位，交给公共起播并带上专辑来源', async () => {
    const { search, tracks, album, playPaths } = setup();
    const track = tracks[1];
    if (!track) throw new Error('缺少曲目');
    expect(await search.play({ kind: 'track', track })).toBe(true);
    expect(playPaths.mock.calls).toEqual([[tracks.map(trackPathOf), 1, albumSource(album)]]);
  });

  it('曲目消失时不拿搜索序号起播', async () => {
    const { search, tracks, playPaths } = setup();
    const track = tracks[1];
    if (!track) throw new Error('缺少曲目');
    expect(await search.play({ kind: 'track', track: { ...track, handle: 'missing' } })).toBe(
      false,
    );
    expect(playPaths.mock.calls).toEqual([]);
  });

  it('取专辑期间离开页面或释放服务，不在晚到应答后起播', async () => {
    const { host, search, history, album, playPaths } = setup();
    const held = host.hold('library.getAlbumTracks');
    const playing = search.play({ kind: 'album', album });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    history.navigate({ id: 'settings' });
    held.respond(0);
    expect(await playing).toBe(false);
    expect(playPaths.mock.calls).toEqual([]);
    search.dispose();
    expect(await search.play({ kind: 'album', album })).toBe(false);
  });
});

describe('结果页的在线结果', () => {
  it('同一查询词回到结果页时沿用已取到的结果，不再向平台要；只留最近四个查询词', async () => {
    const searched = vi.fn();
    const music: Music = {
      async search(input) {
        searched(input.query);
        return { items: [], nextCursor: null, total: 0, discardedCount: 0 };
      },
    };
    const { store, search } = setup(music);
    const first = search.online('陈奕迅');
    first.load(['track']);
    await vi.waitFor(() => expect(store.get(first.kinds.track).status).toBe('ready'));
    expect(search.online('陈奕迅')).toBe(first);
    search.online('陈奕迅').load(['track']);
    expect(searched).toHaveBeenCalledTimes(1);
    for (const text of ['a', 'b', 'c', 'd']) search.online(text);
    expect(search.online('陈奕迅')).not.toBe(first);
  });

  it('下拉里的在线预览与结果页读同一个所选来源，各自按它搜', async () => {
    const asked: string[] = [];
    const music: Music = {
      async search(input) {
        asked.push(`${input.platform}:${input.kind}`);
        return { items: [], nextCursor: null, total: 0, discardedCount: 0 };
      },
    };
    const { store, search, selected } = setup(music);
    const page = search.online('陈奕迅');
    expect(store.get(page.platform)).toBe('wy');
    expect(store.get(search.onlinePreview.platform)).toBe('wy');
    store.set(selected, 'kw');
    expect(store.get(page.platform)).toBe('kw');
    expect(store.get(search.onlinePreview.platform)).toBe('kw');
    page.load(['track', 'album']);
    search.onlinePreview.setText('陈奕迅');
    search.onlinePreview.load(['track']);
    await vi.waitFor(() => expect(asked).toEqual(['kw:track', 'kw:track']));
  });
});
