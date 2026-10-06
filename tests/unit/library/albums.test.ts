import type { AlbumInfo } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { ALBUM_LIMIT, albumsAtom, startAlbums } from '../../../src/library/albums.ts';
import { LIBRARY_COALESCE_MS } from '../../../src/host/libraryContract.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

function albumsAnswer(albums: AlbumInfo[], hasMore = false) {
  return {
    success: true as const,
    albums,
    total: albums.length + (hasMore ? 1 : 0),
    offset: 0,
    limit: ALBUM_LIMIT,
    hasMore,
    includeCover: false,
    fromCache: false,
  };
}

function setup(host: UnitHost) {
  const store = createStore();
  const service = startAlbums(store, host.fb);
  return { store, service, state: () => store.get(albumsAtom) };
}

const changed = { count: 1, timestamp: 1 };

describe('初读', () => {
  it('先订四个库事件再读，按固定参数一次取全', async () => {
    const host = installFakeHost();
    const subscribedAtRead: number[] = [];
    host.answer('library.getAlbums', () => {
      subscribedAtRead.push(host.listenerCount('library:itemsAdded'));
      return albumsAnswer([albumRow('A', 'X')]);
    });
    const { service, state } = setup(host);
    await service.ready;
    expect(subscribedAtRead).toEqual([1]);
    expect(host.listenerCount('library:initialized')).toBe(1);
    expect(host.callsTo('library.getAlbums')).toEqual([
      { sort: 'name', limit: ALBUM_LIMIT, useCache: true },
    ]);
    expect(state()).toMatchObject({ status: 'ready', enabled: true, total: 1, truncated: false });
    expect(state().albums.map((album) => album.name)).toEqual(['A']);
  });

  it('库没开时不取清单，报未启用而不是空库', async () => {
    const host = installFakeHost();
    host.answer('library.isEnabled', { success: true, enabled: false });
    const { service, state } = setup(host);
    await service.ready;
    expect(host.callsTo('library.getAlbums')).toEqual([]);
    expect(state()).toMatchObject({ status: 'ready', enabled: false, albums: [] });
  });

  it('宿主答 hasMore 时记下截断', async () => {
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer([albumRow('A', 'X')], true));
    const { service, state } = setup(host);
    await service.ready;
    expect(state()).toMatchObject({ total: 2, truncated: true });
  });

  it('失败信封与 reject 都报读取失败', async () => {
    const host = installFakeHost();
    host.answer('library.getAlbums', hostFailure('OPERATION_FAILED'));
    const first = setup(host);
    await first.service.ready;
    expect(first.state().status).toBe('failed');
    host.answer('library.isEnabled', () => {
      throw new Error('timeout');
    });
    const second = setup(host);
    await second.service.ready;
    expect(second.state().status).toBe('failed');
  });

  it('等不到宿主就停在 idle，一个请求都不发', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const { service, state } = setup(host);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    expect(state().status).toBe('idle');
    expect(host.calls).toEqual([]);
  });
});

describe('库变更', () => {
  it('连发的事件按 1 s 合并成一次重拉，重拉期间旧清单与 ready 留着', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer([albumRow('A', 'X')]));
    const { service, state } = setup(host);
    await service.ready;
    const held = host.hold('library.getAlbums');
    host.emit('library:itemsAdded', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS / 2);
    host.emit('library:itemsModified', changed);
    host.emit('library:itemsRemoved', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS - 1);
    expect(held.pending).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(held.pending).toHaveLength(1);
    expect(state().status).toBe('ready');
    expect(state().albums).toHaveLength(1);
    held.respond(0, albumsAnswer([albumRow('A', 'X'), albumRow('B', 'Y')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(state().albums.map((album) => album.name)).toEqual(['A', 'B']);
  });

  it('先发的重拉晚到时丢掉，以后发的为准', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { service, state } = setup(host);
    await service.ready;
    const held = host.hold('library.getAlbums');
    host.emit('library:itemsAdded', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    void service.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(held.pending).toHaveLength(2);
    held.respond(1, albumsAnswer([albumRow('New', 'X')]));
    await vi.advanceTimersByTimeAsync(0);
    held.respond(0, albumsAnswer([albumRow('Old', 'X')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(state().albums.map((album) => album.name)).toEqual(['New']);
  });

  it('重拉失败时旧清单留着，状态报失败；重试撤掉排着的合并重拉', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer([albumRow('A', 'X')]));
    const { service, state } = setup(host);
    await service.ready;
    host.answer('library.getAlbums', hostFailure('OPERATION_FAILED'));
    await service.retry();
    expect(state()).toMatchObject({ status: 'failed' });
    expect(state().albums).toHaveLength(1);
    host.emit('library:itemsAdded', changed);
    host.answer('library.getAlbums', albumsAnswer([albumRow('B', 'Y')]));
    await service.retry();
    const calls = host.callsTo('library.getAlbums').length;
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS * 2);
    expect(host.callsTo('library.getAlbums')).toHaveLength(calls);
    expect(state()).toMatchObject({ status: 'ready' });
  });

  it('释放后摘掉订阅，排着的重拉不再发', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { service } = setup(host);
    await service.ready;
    host.emit('library:itemsAdded', changed);
    service.dispose();
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getAlbums')).toHaveLength(1);
    expect(host.listenerCount('library:itemsAdded')).toBe(0);
  });
});
