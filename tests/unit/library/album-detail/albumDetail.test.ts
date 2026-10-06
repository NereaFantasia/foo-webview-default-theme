import type { AlbumInfo } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import {
  albumDetailsAtom,
  startAlbumDetail,
} from '../../../../src/library/album-detail/albumDetail.ts';
import { startAlbums } from '../../../../src/library/albums.ts';
import { albumKeyOf, LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import { albumsAnswer, albumTracksAnswer, libraryAnswers } from '../../../fixtures/albumLibrary.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const BLUE = albumRow('Blue', 'Joni');
const HEJIRA = albumRow('Hejira', 'Joni');
const KEY = albumKeyOf(BLUE);
const changed = { count: 1, timestamp: 1 };

async function setup(albums: readonly AlbumInfo[] = [BLUE, HEJIRA], host?: UnitHost) {
  const fake = host ?? installFakeHost({ answers: libraryAnswers(albums) });
  const store = createStore();
  const history = startNavHistory(store);
  const list = startAlbums(store, fake.fb);
  let stamps = 0;
  const refetch = atom(0);
  const detail = startAlbumDetail(store, { history, stamp: () => ++stamps, refetch }, fake.fb);
  onTestFinished(() => {
    detail.dispose();
    list.dispose();
  });
  await list.ready;
  const of = (key: string = KEY) => store.get(albumDetailsAtom).get(key);
  const titles = (key: string = KEY) => of(key)?.tracks.map((track) => track.title);
  return { host: fake, store, history, detail, refetch, of, titles };
}

/** 发一次库变更，等过合并窗口。 */
async function libraryChanged(host: UnitHost): Promise<void> {
  host.emit('library:itemsModified', changed);
  await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS + 10);
}

describe('页面要一张专辑', () => {
  it('曲目查找按专辑艺术家首值匹配，同名不同艺人不混用，当前详情可识别', async () => {
    const other = albumRow('Blue', 'Other');
    const { detail, store, history } = await setup([BLUE, other]);
    expect(store.get(detail.catalog).albums).toEqual([BLUE, other]);
    expect(detail.findAlbum({ album: 'Blue', albumArtists: ['Other', 'Joni'] })).toEqual(other);
    expect(detail.findAlbum({ album: 'Blue', artists: ['Joni'] })).toEqual(BLUE);
    expect(detail.findAlbum({ album: '' })).toBeNull();
    expect(detail.isCurrent(BLUE)).toBe(false);
    history.navigate({ id: 'album', subject: KEY });
    expect(detail.isCurrent(BLUE)).toBe(true);
    expect(detail.isCurrent(other)).toBe(false);
  });
  it('手上没有就去取：先是 loading，曲目到了是 ready，格式与碟副标题随后到', async () => {
    const { detail, of, titles } = await setup();
    detail.want(KEY);
    expect(of()?.phase).toBe('loading');
    expect(of()?.album).toEqual(BLUE);
    await vi.waitFor(() => expect(of()?.phase).toBe('ready'));
    expect(titles()).toEqual(['Blue 1', 'Blue 2']);
    expect(of()?.stamp).toBe(1);
    await vi.waitFor(() => expect(of()?.facts).not.toBeNull());
  });

  it('清单里没有这张：直接标成不在媒体库，不去取曲目', async () => {
    const { host, detail, of } = await setup();
    detail.want(albumKeyOf(albumRow('Court', 'Joni')));
    expect(of(albumKeyOf(albumRow('Court', 'Joni')))?.phase).toBe('missing');
    expect(host.callsTo('library.getAlbumTracks')).toEqual([]);
  });

  it('清单还没读回时先等着，读回了再取', async () => {
    const host = installFakeHost({ answers: libraryAnswers([BLUE]) });
    const held = host.hold('library.getAlbums');
    const store = createStore();
    const history = startNavHistory(store);
    const list = startAlbums(store, host.fb);
    const detail = startAlbumDetail(store, { history, stamp: () => 1, refetch: atom(0) }, host.fb);
    onTestFinished(() => {
      detail.dispose();
      list.dispose();
    });
    detail.want(KEY);
    expect(store.get(albumDetailsAtom).get(KEY)).toMatchObject({ phase: 'loading', album: null });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.release();
    await vi.waitFor(() => expect(store.get(albumDetailsAtom).get(KEY)?.phase).toBe('ready'));
    expect(store.get(albumDetailsAtom).get(KEY)?.album).toEqual(BLUE);
  });

  it('宿主答了空：标成不在媒体库', async () => {
    const { host, detail, of } = await setup();
    host.answer('library.getAlbumTracks', (params) => ({
      ...albumTracksAnswer(params),
      tracks: [],
    }));
    detail.want(KEY);
    await vi.waitFor(() => expect(of()?.phase).toBe('missing'));
  });

  it('取失败：挂失败，重试成了就清掉', async () => {
    const { host, detail, of, titles } = await setup();
    host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    detail.want(KEY);
    await vi.waitFor(() => expect(of()?.failed).toBe(true));
    host.answer('library.getAlbumTracks', albumTracksAnswer);
    detail.retry(KEY);
    await vi.waitFor(() => expect(of()?.failed).toBe(false));
    expect(titles()).toEqual(['Blue 1', 'Blue 2']);
  });
});

describe('跟着库变', () => {
  it('被看着的重取，途中旧曲目留着；又失败时旧曲目照旧显示', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { host, detail, of, titles } = await setup();
    detail.want(KEY);
    await vi.waitFor(() => expect(of()?.phase).toBe('ready'));
    const held = host.hold('library.getAlbumTracks');
    await libraryChanged(host);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(titles()).toEqual(['Blue 1', 'Blue 2']);
    expect(of()?.phase).toBe('ready');
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await vi.waitFor(() => expect(of()?.failed).toBe(true));
    expect(titles()).toEqual(['Blue 1', 'Blue 2']);
  });

  it('库变了就另发一个请求，不等变化之前发出的那个；晚到的旧应答丢掉', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { host, detail, of, titles } = await setup();
    const held = host.hold('library.getAlbumTracks');
    detail.want(KEY);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    await libraryChanged(host);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    const retitled = (title: string) => {
      const answer = albumTracksAnswer({ album: 'Blue', albumArtist: 'Joni' });
      if (answer.success === false) throw new Error('替身没给出曲目');
      return { ...answer, tracks: answer.tracks.map((track) => ({ ...track, title })) };
    };
    held.respond(1, retitled('new'));
    await vi.waitFor(() => expect(titles()).toEqual(['new', 'new']));
    held.respond(0, retitled('old'));
    await vi.advanceTimersByTimeAsync(10);
    expect(titles()).toEqual(['new', 'new']);
    expect(of()?.phase).toBe('ready');
  });

  it('取的途中这张移出了媒体库：晚到的曲目丢掉，仍是不在媒体库', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { host, detail, of } = await setup();
    const held = host.hold('library.getAlbumTracks');
    detail.want(KEY);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    host.answer('library.getAlbums', albumsAnswer([HEJIRA]));
    await libraryChanged(host);
    await vi.waitFor(() => expect(of()?.phase).toBe('missing'));
    held.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(of()?.phase).toBe('missing');
    expect(of()?.tracks).toEqual([]);
  });

  it('移出媒体库：标成不在、历史认不得它；回到库里重新取', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { host, history, detail, of } = await setup();
    const exists = vi.spyOn(history, 'subjectsChanged');
    detail.want(KEY);
    await vi.waitFor(() => expect(of()?.phase).toBe('ready'));
    host.answer('library.getAlbums', albumsAnswer([HEJIRA]));
    await libraryChanged(host);
    await vi.waitFor(() => expect(of()?.phase).toBe('missing'));
    expect(of()?.tracks).toEqual([]);
    expect(of()?.album).toEqual(BLUE);
    expect(exists).toHaveBeenCalled();

    host.answer('library.getAlbums', albumsAnswer([BLUE, HEJIRA]));
    await libraryChanged(host);
    await vi.waitFor(() => expect(of()?.phase).toBe('ready'));
    expect(of()?.tracks).toHaveLength(2);
  });

  it('历史越过已移出媒体库的专辑记录', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { host, store, history } = await setup();
    history.navigate({ id: 'album', subject: KEY });
    history.navigate({ id: 'songs' });
    expect(store.get(historyAtom).previous).toEqual({ id: 'album', subject: KEY });
    host.answer('library.getAlbums', albumsAnswer([HEJIRA]));
    await libraryChanged(host);
    await vi.waitFor(() => expect(store.get(historyAtom).previous).toEqual({ id: 'albums' }));
  });

  it('评分的重取信号一变，被看着的重取并换新戳', async () => {
    const { host, store, detail, refetch, of } = await setup();
    detail.want(KEY);
    await vi.waitFor(() => expect(of()?.phase).toBe('ready'));
    const before = of()?.stamp ?? 0;
    store.set(refetch, 1);
    await vi.waitFor(() => expect(host.callsTo('library.getAlbumTracks')).toHaveLength(2));
    await vi.waitFor(() => expect(of()?.stamp).toBeGreaterThan(before));
  });
});

describe('放手', () => {
  it('新旧两层同时要同一张共用一份，都放手后留着；库一变没人看的就丢掉', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { host, detail, of } = await setup();
    const first = detail.want(KEY);
    const second = detail.want(KEY);
    await vi.waitFor(() => expect(of()?.phase).toBe('ready'));
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(1);
    first();
    second();
    second();
    expect(of()?.phase).toBe('ready');
    await libraryChanged(host);
    expect(of()).toBeUndefined();
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(1);
  });

  it('没人看的至多留四张，先放手的先丢', async () => {
    const albums = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => albumRow(name, 'Joni'));
    const { detail, of } = await setup(albums);
    for (const album of albums) {
      const release = detail.want(albumKeyOf(album));
      await vi.waitFor(() => expect(of(albumKeyOf(album))?.phase).toBe('ready'));
      release();
    }
    const kept = albums.filter((album) => of(albumKeyOf(album)) !== undefined);
    expect(kept.map((album) => album.name)).toEqual(['C', 'D', 'E', 'F']);
  });
});
