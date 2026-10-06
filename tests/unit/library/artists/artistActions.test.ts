import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { translateAtom } from '../../../../src/i18n/locale.ts';
import { artistQuery, startArtistActions } from '../../../../src/library/artists/artistActions.ts';
import type { ArtistRow } from '../../../../src/library/artists/artistIndex.ts';
import {
  artistAlbumTracks,
  NUJABES_CREDITS,
  readyAlbums,
} from '../../../fixtures/artistsLibrary.ts';
import { albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

function setup() {
  const host = installFakeHost();
  host.answer('library.getAlbumTracks', artistAlbumTracks);
  const store = createStore();
  const playPaths = vi.fn(async () => true);
  const service = startArtistActions(
    store,
    {
      albums: atom(readyAlbums()),
      credited: atom<readonly ArtistRow[] | null>([NUJABES_CREDITS]),
      openSongs: vi.fn(),
      actions: {
        playPaths,
        queuePaths: vi.fn(async () => true),
        sendPathsTo: vi.fn(async () => true),
        sendPathsToNew: vi.fn(async () => true),
      },
    },
    host.fb,
  );
  return { host, store, service, playPaths };
}
describe('艺人操作', () => {
  it('按右半行起播，带上第一位艺人作来源；没写艺术家时名字用缺省的那一句', async () => {
    const env = setup();
    const shown = [albumTrackRow('X', 'A', 'One'), albumTrackRow('Y', 'A', 'Two')];
    expect(await env.service.play(['A', 'B'], false, shown, 1)).toBe(true);
    expect(env.playPaths).toHaveBeenLastCalledWith(
      shown.map((track) => track.path),
      1,
      { kind: 'artist', subject: 'A', name: 'A' },
    );
    expect(await env.service.play([''], false, shown)).toBe(true);
    expect(env.playPaths).toHaveBeenLastCalledWith(
      shown.map((track) => track.path),
      0,
      {
        kind: 'artist',
        subject: '',
        name: env.store.get(translateAtom)('artists.unknown'),
      },
    );
    env.playPaths.mockResolvedValueOnce(false);
    expect(await env.service.play(['B'], false, shown)).toBe(false);
    expect(env.store.get(env.service.failed)).toBe(true);
    env.service.dispose();
  });
  it('从专辑和参与取完整操作对象，参与专辑里不属于他的曲目不混进来', async () => {
    const env = setup();
    const tracks = await env.service.tracksOf(['Nujabes']);
    expect(tracks?.map((track) => track.title)).toContain('Luv(sic) Part 3');
    expect(tracks?.map((track) => track.title)).not.toContain('Luv(sic) Part 6');
    expect(tracks).toHaveLength(5);
    env.service.dispose();
  });
  it('查询拒绝通配符、引号、空名和只差大小写的同名', () => {
    for (const name of ['A*', 'A?', 'A"', ''])
      expect(artistQuery([name], 'credited', [name])).toBeNull();
    expect(artistQuery(['A'], 'credited', ['A', 'a'])).toBeNull();
    expect(artistQuery(['Nujabes'], 'credited', ['Nujabes'])).toBe('artist IS "Nujabes"');
  });
});
