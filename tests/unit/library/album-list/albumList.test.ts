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
import { trackPathOf } from '../../../../src/host/libraryContract.ts';
import { PLAY_LIMIT } from '../../../../src/playback/libraryView.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';

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

async function setup(tracks = TRACKS) {
  const host = installFakeHost({ config: { 'defaultTheme.browser.dimension': 'genre' } });
  host.answer('library.getAlbums', albumsAnswer(ALBUMS));
  host.answer('library.getAll', {
    success: true,
    tracks,
    items: tracks,
    total: tracks.length,
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
  const played: (readonly string[] | null)[] = [];
  const play = {
    playLoaded: vi.fn(async (load: () => Promise<readonly string[] | null>) => {
      const paths = await load();
      played.push(paths);
      return paths !== null;
    }),
  };
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  const browse = startAlbumBrowse(store, host.fb, createMemoryConfigWriter(host.fb));
  const list = startAlbumList(
    store,
    { stamp: () => 1, updateCollapsed: browse.updateCollapsed, play },
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
  return { host, store, list, sections, played };
}

describe('行序号', () => {
  it('起播等曲目期间更换列头方向，仍使用点击播放时的排序', async () => {
    const first = { ...TRACKS[0]!, title: 'A', trackNumber: 1 };
    const second = {
      ...first,
      title: 'B',
      handle: 'second',
      path: 'E:\\second.flac',
      trackNumber: 2,
    };
    const { host, list, played } = await setup([first, second]);
    const held = host.hold('library.getAll');
    list.prefs.sortTracks('title');
    list.prefs.sortTracks('title');
    const playing = list.playAll('list', false);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    list.prefs.sortTracks('title');
    held.release();
    await playing;
    expect(played.at(-1)).toEqual([second.path, first.path]);
  });

  it('列头降序同步曲目行、多选与整页起播，封面墙仍按专辑原曲序', async () => {
    const first = { ...TRACKS[0]!, title: 'A', trackNumber: 1 };
    const second = {
      ...first,
      title: 'B',
      handle: 'second',
      path: 'E:\\second.flac',
      trackNumber: 2,
    };
    const tracks = [first, second, ...TRACKS.slice(1)];
    const { store, list, played } = await setup(tracks);
    await list.tracks.read();
    list.syncOrders(store.get(albumListOrdersAtom));
    list.selection.activate(0, { ctrl: false, shift: false });
    list.prefs.sortTracks('title');
    list.prefs.sortTracks('title');
    const orders = store.get(albumListOrdersAtom);
    expect(orders.trackAt(0)?.title).toBe('B');
    expect(orders.albumAt(0)?.tracks).toEqual([second, first]);
    list.syncOrders(orders);
    expect(store.get(list.selection.state).ranges).toEqual([]);
    await list.playAll('list', false);
    expect(played.at(-1)?.slice(0, 2)).toEqual([second.path, first.path]);
    await list.playAll('wall', false);
    expect(played.at(-1)?.slice(0, 2)).toEqual([first.path, second.path]);
  });

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
  it('统计排序列被隐藏时仍取统计，统计到达后按曲目值重排', async () => {
    const first = { ...TRACKS[0]!, title: 'A', trackNumber: 1 };
    const second = {
      ...first,
      title: 'B',
      handle: 'second',
      path: 'E:\\second.flac',
      trackNumber: 2,
    };
    const { host, store, list } = await setup([first, second]);
    host.answer('titleformat.evalBatch', (params) => {
      const answer = evalAnswer(params);
      return {
        ...answer,
        results: answer.results.map((row) => ({
          ...row,
          result: `|||${row.path === first.path ? 10 : 2}`,
        })),
      };
    });
    await list.tracks.read();
    await list.stats.probe();
    list.prefs.sortTracks('playCount');
    list.setStatsColumns(false);
    list.syncStats();
    await vi.waitFor(() => expect(store.get(playStatsAtom).byHandle?.size).toBe(2));
    expect(store.get(albumListOrdersAtom).trackAt(0)?.title).toBe('A');
    list.prefs.sortTracks('playCount');
    expect(store.get(albumListOrdersAtom).trackAt(0)?.title).toBe('B');
  });

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

  it('显示统计列时不按统计排序也取统计', async () => {
    const { store, list } = await setup();
    list.tracks.want();
    await vi.waitFor(() => expect(store.get(libraryTracksAtom).status).toBe('ready'));
    list.syncStats();
    await vi.waitFor(() => expect(store.get(playStatsAtom).available).toBe(true));
    list.syncStats();
    expect(store.get(playStatsAtom).byHandle).toBeNull();
    list.setStatsColumns(true);
    list.syncStats();
    await vi.waitFor(() => expect(store.get(playStatsAtom).byHandle?.size).toBe(3));
  });
});

describe('播放全部', () => {
  it('顺序播放只取前一万首，随机播放从整份曲目抽样且不重复', async () => {
    const { host, list, played } = await setup();
    const tracks = Array.from({ length: PLAY_LIMIT + 5 }, (_, index) =>
      trackRow('Blue Train', `曲目 ${index}`, {
        albumArtist: 'John Coltrane',
        trackNumber: index + 1,
      }),
    );
    host.answer('library.getAll', {
      success: true,
      tracks,
      items: tracks,
      total: tracks.length,
      offset: 0,
      limit: TRACK_LIMIT,
    });
    await list.playAll('wall', false);
    expect(played.at(-1)).toEqual(tracks.slice(0, PLAY_LIMIT).map(trackPathOf));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    try {
      await list.playAll('wall', true);
      const shuffled = played.at(-1) ?? [];
      expect(shuffled).toHaveLength(PLAY_LIMIT);
      expect(new Set(shuffled).size).toBe(PLAY_LIMIT);
      expect(shuffled[0]).toBe(trackPathOf(tracks.at(-1)!));
    } finally {
      random.mockRestore();
    }
  });

  it('按显示次序连成一份：封面墙按浏览的节，列表形态按自己的排序；整库曲目没取过就先取', async () => {
    const { store, list, played } = await setup();
    const path = (name: string) =>
      trackPathOf(TRACKS.find((track) => track.album === name) ?? TRACKS[0]!);
    expect(store.get(libraryTracksAtom).status).toBe('idle');
    await expect(list.playAll('wall', false)).resolves.toBe(true);
    expect(played.at(-1)).toEqual([path('Blue Train'), path('Kind of Blue'), path('The Wall')]);
    list.prefs.setField('name');
    list.prefs.setDescending(true);
    await list.playAll('list', false);
    expect(played.at(-1)).toEqual([path('Kind of Blue'), path('Blue Train'), path('The Wall')]);
    await list.playAll('wall', true);
    expect([...(played.at(-1) ?? [])].sort()).toEqual(TRACKS.map(trackPathOf).sort());
  });

  it('整库曲目读不到时不播', async () => {
    const { host, list, played } = await setup();
    host.answer('library.getAll', hostFailure('OPERATION_FAILED'));
    await expect(list.playAll('wall', false)).resolves.toBe(false);
    expect(played.at(-1)).toBeNull();
  });
});
