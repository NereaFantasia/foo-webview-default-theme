import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { albumKeyOf, LIBRARY_COALESCE_MS } from '../../../src/host/libraryContract.ts';
import {
  libraryTracksAtom,
  startLibraryTracks,
  TRACK_LIMIT,
} from '../../../src/library/libraryTracks.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

function tracksAnswer(tracks: readonly LibraryTrack[]) {
  return {
    success: true as const,
    tracks: [...tracks],
    items: [...tracks],
    total: tracks.length,
    offset: 0,
    limit: TRACK_LIMIT,
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
const changed = { count: 1, timestamp: 1 };

describe('取曲目', () => {
  it('没人要时不取；要了先订库变更再一次取全，按专辑分好、碟号曲号排好，戳在发请求前拿', async () => {
    const host = installFakeHost();
    const subscribed: number[] = [];
    host.answer('library.getAll', () => {
      subscribed.push(host.listenerCount('library:itemsModified'));
      return tracksAnswer(LIBRARY);
    });
    const { service, titles, state } = setup(host);
    await flush();
    expect(host.callsTo('library.getAll')).toEqual([]);
    expect(state().status).toBe('idle');
    service.want();
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(subscribed).toEqual([1]);
    expect(host.callsTo('library.getAll')).toEqual([
      { offset: 0, limit: TRACK_LIMIT, asyncResult: true },
    ]);
    expect(titles()).toEqual(['Blue Train', 'Locomotion', 'Bonus']);
    expect(state().byAlbum.size).toBe(1);
    expect(state()).toMatchObject({ stamp: 1, generation: 1 });
    // 按 handle 的那张表收整库每一首，没有专辑名的也在。
    expect([...state().byHandle.keys()]).toEqual(LIBRARY.map((track) => track.handle));
    expect(state().byHandle.get(LIBRARY[3]?.handle ?? '')?.title).toBe('Loose');
  });

  it('库变更按 1 s 合并后重取，重取期间旧的一份留着、状态不退回读取中', async () => {
    const { host, service, titles, state } = setup();
    host.answer('library.getAll', tracksAnswer(LIBRARY.slice(0, 1)));
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    vi.useFakeTimers();
    host.answer('library.getAll', tracksAnswer(LIBRARY));
    const held = host.hold('library.getAll');
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
    host.answer('library.getAll', tracksAnswer(LIBRARY));
    service.syncRefetch(3);
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    service.syncRefetch(3);
    await flush();
    expect(host.callsTo('library.getAll')).toHaveLength(1);
    service.syncRefetch(4);
    await vi.waitFor(() => expect(state().generation).toBe(2));
    expect(host.callsTo('library.getAll')).toHaveLength(2);
  });

  it('读失败留着旧的一份并报失败；晚到的旧应答丢掉', async () => {
    const { host, service, titles, state } = setup();
    host.answer('library.getAll', tracksAnswer(LIBRARY));
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    host.answer('library.getAll', hostFailure('OPERATION_FAILED'));
    await service.retry();
    expect(state().status).toBe('failed');
    expect(titles()).toHaveLength(3);
    const held = host.hold('library.getAll');
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
    host.answer('library.getAll', tracksAnswer(LIBRARY));
    const release = service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    release();
    vi.useFakeTimers();
    host.emit('library:itemsModified', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getAll')).toHaveLength(1);
    service.want();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.getAll')).toHaveLength(2);
  });

  it('还有人要时撤回一处，库变更照旧重取', async () => {
    const { host, service, state } = setup();
    host.answer('library.getAll', tracksAnswer(LIBRARY));
    const release = service.want();
    service.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    release();
    vi.useFakeTimers();
    host.emit('library:itemsModified', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getAll')).toHaveLength(2);
  });
});
