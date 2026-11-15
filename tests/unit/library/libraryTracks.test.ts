import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { albumKeyOf, LIBRARY_COALESCE_MS } from '../../../src/host/libraryContract.ts';
import {
  libraryTracksAtom,
  startLibraryTracks,
  TRACK_PAGE_SIZE,
} from '../../../src/library/libraryTracks.ts';
import type { LibraryMirrorSource } from '../../../src/library/mirror/mirrorSource.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';
import { wholeLibrary } from '../../fixtures/wholeLibrary.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** 不足一页的整库：一次答完 */
function tracksAnswer(tracks: readonly LibraryTrack[]) {
  return {
    success: true as const,
    tracks: [...tracks],
    total: tracks.length,
    offset: 0,
    limit: TRACK_PAGE_SIZE,
    hasMore: false,
  };
}

const BLUE = { albumArtist: 'John Coltrane' };
const LIBRARY = [
  trackRow('Blue Train', 'Locomotion', { ...BLUE, discNumber: 1, trackNumber: 3 }),
  trackRow('Blue Train', 'Blue Train', { ...BLUE, discNumber: 1, trackNumber: 1 }),
  trackRow('Blue Train', 'Bonus', { ...BLUE, discNumber: 2, trackNumber: 1 }),
  trackRow('', 'Loose'),
];
const BLUE_KEY = albumKeyOf({ name: 'Blue Train', albumArtist: 'John Coltrane' });

function setup(host: UnitHost = installFakeHost()) {
  const store = createStore();
  let stamps = 0;
  const service = startLibraryTracks(store, () => ++stamps, host.fb);
  onTestFinished(() => service.dispose());
  const titles = () =>
    (store.get(libraryTracksAtom).byAlbum.get(BLUE_KEY) ?? []).map((track) => track.title);
  return { host, store, service, titles, state: () => store.get(libraryTracksAtom) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const changed = { count: 1, handles: [], truncated: false, fromHook: false, timestamp: 1 };

describe('取曲目', () => {
  it('临时读取等待刷新完成，ready 的旧缓存不能提前作为结果', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY.slice(0, 1)));
    expect((await service.read())?.byHandle.size).toBe(1);
    host.answer('library.search', tracksAnswer(LIBRARY));
    host.emit('library:itemsModified', changed);
    const held = host.hold('library.search');
    let settled = false;
    const reading = service.read().then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(state().status).toBe('ready');
    expect(settled).toBe(false);
    held.release();
    expect((await reading)?.byHandle.size).toBe(4);
    expect(state().generation).toBe(2);
  });

  it('临时读取失败时不返回旧缓存，释放服务会结束尚未完成的读取', async () => {
    const { host, service } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    await service.read();
    host.answer('library.search', hostFailure('OPERATION_FAILED'));
    host.emit('library:itemsModified', changed);
    await expect(service.read()).resolves.toBeNull();
    // 上次读取失败，再要时自动重取
    const held = host.hold('library.search');
    const reading = service.read();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.dispose();
    await expect(reading).resolves.toBeNull();
    held.release();
  });

  it('没人要时不取；要了先订库变更再一次取全，按专辑分好、碟号曲号排好，戳在发请求前拿', async () => {
    const host = installFakeHost();
    const subscribed: number[] = [];
    host.answer('library.search', () => {
      subscribed.push(host.listenerCount('library:itemsModified'));
      return tracksAnswer(LIBRARY);
    });
    const { service, titles, state } = setup(host);
    await flush();
    expect(host.callsTo('library.search')).toEqual([]);
    expect(state().status).toBe('idle');
    service.want();
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(subscribed).toEqual([1]);
    expect(host.callsTo('library.search')).toEqual([
      { query: 'ALL', limit: TRACK_PAGE_SIZE, offset: 0 },
    ]);
    expect(titles()).toEqual(['Blue Train', 'Locomotion', 'Bonus']);
    expect(state().byAlbum.size).toBe(1);
    expect(state()).toMatchObject({ stamp: 1, generation: 1 });
    // 按 handle 的那张表收整库每一首，没有专辑名的也在
    expect([...state().byHandle.keys()]).toEqual(LIBRARY.map((track) => track.handle));
    expect(state().byHandle.get(LIBRARY[3]?.handle ?? '')?.title).toBe('Loose');
  });

  it('库变更按 1 s 合并后重取，重取期间旧的一份留着、状态不退回读取中', async () => {
    const { host, service, titles, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY.slice(0, 1)));
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    vi.useFakeTimers();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const held = host.hold('library.search');
    host.emit('library:itemsAdded', changed);
    host.emit('library:itemsModified', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(held.pending).toHaveLength(1);
    expect(state().status).toBe('ready');
    expect(titles()).toEqual(['Locomotion']);
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(titles()).toEqual(['Blue Train', 'Locomotion', 'Bonus']);
    expect(state().generation).toBe(2);
  });

  it('评分的重取信号：头一次只记下，变了才重取，没变不取', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    service.syncRefetch(3);
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    service.syncRefetch(3);
    await flush();
    expect(host.callsTo('library.search')).toHaveLength(1);
    service.syncRefetch(4);
    await vi.waitFor(() => expect(state().generation).toBe(2));
    expect(host.callsTo('library.search')).toHaveLength(2);
  });

  it('读失败留着旧的一份并报失败；晚到的旧应答丢掉', async () => {
    const { host, service, titles, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    host.answer('library.search', hostFailure('OPERATION_FAILED'));
    await service.retry();
    expect(state().status).toBe('failed');
    expect(titles()).toHaveLength(3);
    const held = host.hold('library.search');
    const first = service.retry();
    const second = service.retry();
    await flush();
    held.respond(1, tracksAnswer(LIBRARY.slice(0, 1)));
    held.respond(0, tracksAnswer([]));
    await Promise.all([first, second]);
    expect(titles()).toEqual(['Locomotion']);
  });

  it('撤到没人要后库变更只记下过时，重新要时补取一次', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const release = service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    release();
    vi.useFakeTimers();
    host.emit('library:itemsModified', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.search')).toHaveLength(1);
    service.want();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.search')).toHaveLength(2);
  });

  it('撤到没人要后库没变，重新要时沿用手上的一份，不再取', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const release = service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    release();
    service.want();
    await flush();
    expect(host.callsTo('library.search')).toHaveLength(1);
    expect(state().generation).toBe(1);
  });

  it('读取进行中撤回又重新要，接着用同一个请求，不重发', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const held = host.hold('library.search');
    const release = service.want();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    release();
    service.want();
    await flush();
    expect(held.pending).toHaveLength(1);
    held.release();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(host.callsTo('library.search')).toHaveLength(1);
    expect(state().generation).toBe(1);
  });

  it('读取进行中撤到没人要，应答回来照常收下，下次要时不再取', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const held = host.hold('library.search');
    const release = service.want();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    release();
    held.release();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    service.want();
    await flush();
    expect(host.callsTo('library.search')).toHaveLength(1);
  });

  it('读取进行中库变了，重新要时再取一次，旧的应答丢掉', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const held = host.hold('library.search');
    const release = service.want();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    release();
    host.emit('library:itemsModified', changed);
    service.want();
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(0, tracksAnswer([]));
    held.respond(0, tracksAnswer(LIBRARY));
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().byHandle.size).toBe(4);
    expect(state().generation).toBe(1);
  });

  it('库变更的合并等待还没到期时重新要，只取一次', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const release = service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    release();
    vi.useFakeTimers();
    host.emit('library:itemsModified', changed);
    service.want();
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS * 2);
    expect(host.callsTo('library.search')).toHaveLength(2);
  });

  it('连上宿主之前登记两次，库变更的监听只挂一个，释放服务后摘干净', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    service.want();
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    await flush();
    expect(host.listenerCount('library:itemsModified')).toBe(1);
    service.dispose();
    expect(host.listenerCount('library:itemsModified')).toBe(0);
  });

  it('还有人要时撤回一处，库变更照旧重取', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    const release = service.want();
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    release();
    vi.useFakeTimers();
    host.emit('library:itemsModified', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.search')).toHaveLength(2);
  });
});

describe('按页取整库', () => {
  const MANY = Array.from({ length: TRACK_PAGE_SIZE + 3 }, (_, index) =>
    trackRow('Many', `Track ${index}`, { albumArtist: 'Artist', trackNumber: index + 1 }),
  );

  it('超过一页就按已取的行数接着取，合成一份', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', wholeLibrary(MANY));
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(host.callsTo('library.search')).toEqual([
      { query: 'ALL', limit: TRACK_PAGE_SIZE, offset: 0 },
      { query: 'ALL', limit: TRACK_PAGE_SIZE, offset: TRACK_PAGE_SIZE },
    ]);
    expect(state().byHandle.size).toBe(MANY.length);
  });

  it('翻页途中被新的一次取代，旧的一次不再取后面的页', async () => {
    const { host, service, state } = setup();
    host.answer('library.search', wholeLibrary(MANY));
    const held = host.hold('library.search');
    service.want();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const second = service.retry();
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    // 旧的一次拿到第一页，它已被取代，不该再要第二页
    held.respond(0);
    await flush();
    held.release();
    await second;
    expect(host.callsTo('library.search')).toHaveLength(3);
    expect(state().byHandle.size).toBe(MANY.length);
    expect(state().generation).toBe(1);
  });

  it('中间一页读失败，整份算失败，手上的旧一份留着', async () => {
    const { host, service, titles, state } = setup();
    host.answer('library.search', tracksAnswer(LIBRARY));
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    const first = wholeLibrary(MANY);
    host.answer('library.search', (params) =>
      params['offset'] === 0 && typeof first === 'function'
        ? first(params)
        : hostFailure('OPERATION_FAILED'),
    );
    await service.retry();
    expect(state().status).toBe('failed');
    expect(titles()).toHaveLength(3);
    expect(state().byHandle.size).toBe(LIBRARY.length);
  });
});

describe('读镜像', () => {
  function withMirror(answer: LibraryTrack[] | null) {
    const host = installFakeHost();
    host.answer('library.search', tracksAnswer(LIBRARY.slice(0, 1)));
    const store = createStore();
    const tracks = vi.fn<LibraryMirrorSource['tracks']>(() => Promise.resolve(answer));
    const service = startLibraryTracks(store, () => 1, host.fb, { tracks });
    onTestFinished(() => service.dispose());
    return { host, store, service, tracks };
  }

  it('镜像读得到就用镜像的一份，不向宿主翻页', async () => {
    const { host, service, store } = withMirror(LIBRARY);
    expect((await service.read())?.byHandle.size).toBe(LIBRARY.length);
    expect(store.get(libraryTracksAtom).status).toBe('ready');
    expect(host.callsTo('library.search')).toHaveLength(0);
  });

  it('镜像读不到（没建好、落后、后端没连）就退回宿主翻页', async () => {
    const { host, service, tracks } = withMirror(null);
    expect((await service.read())?.byHandle.size).toBe(1);
    expect(tracks).toHaveBeenCalledTimes(1);
    expect(host.callsTo('library.search')).toHaveLength(1);
  });

  it('镜像因这一次已被取代而放弃时，不再向宿主要一份', async () => {
    const { host, service, tracks } = withMirror(null);
    tracks.mockImplementationOnce((stale) => {
      void service.retry();
      expect(stale?.()).toBe(true);
      return Promise.resolve(null);
    });
    await service.read();
    expect(host.callsTo('library.search')).toHaveLength(1);
  });
});
