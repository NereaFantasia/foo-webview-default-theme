import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startAlbumBrowse } from '../../../../src/library/albums/albumBrowse.ts';
import {
  albumListOrdersAtom,
  startAlbumList,
} from '../../../../src/library/album-list/albumList.ts';
import { startBrowserPrefs } from '../../../../src/library/albums/browserPrefs.ts';
import { libraryTracksAtom, TRACK_LIMIT } from '../../../../src/library/libraryTracks.ts';
import { playStatsAtom } from '../../../../src/library/playStats.ts';
import { albumsAnswer } from '../../../fixtures/albumLibrary.ts';
import type { HostParams } from '../../../fixtures/fakeHost.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const ALBUMS = [
  albumRow('Blue Train', 'John Coltrane', { genre: 'Jazz', trackCount: 1 }),
  albumRow('Kind of Blue', 'Miles Davis', { genre: 'Jazz', trackCount: 1 }),
  albumRow('The Wall', 'Pink Floyd', { genre: 'Rock', trackCount: 1 }),
];
const TRACKS: LibraryTrack[] = ALBUMS.map((album) =>
  trackRow(album.name, `${album.name} 1`, { albumArtist: album.albumArtist }),
);

function evalAnswer(params: HostParams) {
  const paths: unknown = params['paths'];
  const list = Array.isArray(paths) ? paths.map(String) : [];
  const pattern = String(params['pattern']);
  const results = list.map((path) => ({
    path,
    success: true,
    result: '2024-01-01 00:00:00|||3',
  }));
  const total = results.length;
  return { success: true as const, pattern, total, successCount: total, errorCount: 0, results };
}

async function setup() {
  const host = installFakeHost({ config: { 'defaultTheme.browser.dimension': 'genre' } });
  host.answer('library.getAlbums', albumsAnswer(ALBUMS));
  host.answer('library.getAll', {
    success: true,
    tracks: TRACKS,
    items: TRACKS,
    total: TRACKS.length,
    offset: 0,
    limit: TRACK_LIMIT,
  });
  host.answer('titleformat.evalBatch', evalAnswer);
  host.answer('config.getComponents', {
    success: true,
    count: 1,
    components: [{ name: '播放统计信息', version: '3.1.10', filename: 'foo_playcount' }],
  });
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  const browse = startAlbumBrowse(store, host.fb, createMemoryConfigWriter(host.fb));
  const list = startAlbumList(
    store,
    { stamp: () => 1, updateCollapsed: browse.updateCollapsed },
    host.fb,
    createMemoryConfigWriter(host.fb),
  );
  onTestFinished(() => {
    list.dispose();
    browse.dispose();
    prefs.dispose();
  });
  await Promise.all([prefs.ready, browse.ready, list.prefs.ready]);
  const sections = () =>
    store
      .get(albumListOrdersAtom)
      .sections.map((section) => [section.key, section.albums.map((entry) => entry.album.name)]);
  return { host, store, list, sections };
}

describe('行序号', () => {
  it('浏览给的节按列表形态自己的排序与节序重排，曲目到手后按真实曲目排', async () => {
    const { store, list, sections } = await setup();
    expect(sections()).toEqual([
      ['Jazz', ['Blue Train', 'Kind of Blue']],
      ['Rock', ['The Wall']],
    ]);
    list.prefs.setField('name');
    list.prefs.setDescending(true);
    list.prefs.setSectionOrder('count');
    expect(sections()).toEqual([
      ['Jazz', ['Kind of Blue', 'Blue Train']],
      ['Rock', ['The Wall']],
    ]);
    expect(store.get(albumListOrdersAtom).trackAt(0)).toBeUndefined();
    list.tracks.want();
    await vi.waitFor(() => expect(store.get(libraryTracksAtom).status).toBe('ready'));
    expect(store.get(albumListOrdersAtom).trackAt(0)?.title).toBe('Kind of Blue 1');
  });

  it('行序号换了一批才清空选中；同一批不动', async () => {
    const { store, list } = await setup();
    const orders = store.get(albumListOrdersAtom);
    list.syncOrders(orders);
    list.selection.activate(1, { ctrl: false, shift: false });
    list.syncOrders(orders);
    expect(store.get(list.selection.state).ranges).not.toEqual([]);
    list.prefs.setField('year');
    list.syncOrders(store.get(albumListOrdersAtom));
    expect(store.get(list.selection.state).ranges).toEqual([]);
  });
});

describe('播放统计', () => {
  it('曲目到手先探装没装；只在按播放统计排序时取，取到后重排', async () => {
    const { host, store, list } = await setup();
    list.syncStats();
    expect(host.callsTo('titleformat.evalBatch')).toEqual([]);
    list.tracks.want();
    await vi.waitFor(() => expect(store.get(libraryTracksAtom).status).toBe('ready'));
    list.syncStats();
    await vi.waitFor(() => expect(store.get(playStatsAtom).available).toBe(true));
    list.syncStats();
    expect(host.callsTo('config.getComponents')).toEqual([{}]);
    expect(host.callsTo('titleformat.evalBatch')).toEqual([]);
    list.prefs.setField('playCount');
    list.syncStats();
    await vi.waitFor(() => expect(store.get(playStatsAtom).byHandle?.size).toBe(3));
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);
  });
});
