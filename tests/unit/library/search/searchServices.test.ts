import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startNavHistory } from '../../../../src/nav/navHistory.ts';
import { startSearchServices } from '../../../../src/library/search/searchServices.ts';
import { trackPathOf } from '../../../../src/host/libraryContract.ts';
import { albumSource } from '../../../../src/library/albumActions.ts';
import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

function setup() {
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
    findAlbum: () => album,
  });
  onTestFinished(() => search.dispose());
  return { host, search, history, tracks, album, playPaths };
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
