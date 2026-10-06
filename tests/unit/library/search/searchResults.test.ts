import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../../src/host/waitForHost.ts';
import { ALBUM_LIMIT, startAlbums } from '../../../../src/library/albums.ts';
import { LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import { searchQuery } from '../../../../src/library/search/searchQuery.ts';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
  SEARCH_RESULT_LIMIT,
  startSearchResults,
} from '../../../../src/library/search/searchResults.ts';
import type { HostResponse } from '../../../fixtures/fakeHost.ts';
import { hostFailure, numberParam } from '../../../fixtures/hostAnswers.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

afterEach(() => vi.useRealTimers());

const changed = { count: 1, timestamp: 1 };
const rows = Array.from({ length: 220 }, (_, i) => trackRow('Album', `Song ${i}`));
const answer = (count = 1, total = count): HostResponse<'library.query'> => ({
  success: true,
  tracks: rows.slice(0, count),
  total,
});
const stats = (totalTracks: number): HostResponse<'library.getStats'> => ({
  success: true,
  totalTracks,
  totalAlbums: 0,
  totalArtists: 0,
  totalDuration: 0,
  totalSize: 0,
  cacheValid: true,
  lastModified: 0,
});

function setup(available = true) {
  const host = installFakeHost({ available });
  host.answer('library.query', answer());
  host.answer('library.getStats', stats(0));
  const store = createStore();
  const catalog = { retry: vi.fn(async () => {}) };
  const service = startSearchResults(store, catalog, host.fb);
  onTestFinished(() => service.dispose());
  return { host, store, service, catalog, state: () => store.get(service.state) };
}

describe('搜索读取', () => {
  it('空词不请求；去抖后先订阅、再确认库可用，提交排序与前缀上限', async () => {
    vi.useFakeTimers();
    const { host, service, state } = setup();
    let subscribed = false;
    host.answer('library.isEnabled', () => {
      subscribed = host.listenerCount('library:itemsRemoved') > 0;
      return { success: true, enabled: true };
    });
    service.setText(' ');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(host.calls).toEqual([]);
    service.setText('n');
    service.setText('nujabes');
    expect(state()).toMatchObject({ text: 'nujabes', status: 'loading', tracks: [], total: null });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(host.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const compiled = searchQuery('nujabes');
    expect(host.callsTo('library.query')).toEqual([
      { query: compiled?.query, sort: compiled?.sort, limit: SEARCH_PAGE_SIZE },
    ]);
    expect(subscribed).toBe(true);
    expect(state()).toMatchObject({ status: 'ready', tracks: [rows[0]], total: 1 });
  });

  it('新词立即清旧结果，旧词在新请求之前或之后答回都不能覆盖', async () => {
    const { host, service, state } = setup();
    const held = host.hold('library.query');
    service.setText('old', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.setText('new');
    held.respond(0, answer(2));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(state()).toMatchObject({ text: 'new', status: 'loading', tracks: [] });
    held.respond(0, answer(3));
    await vi.waitFor(() => expect(state().tracks).toHaveLength(3));
    service.setText('old', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.setText('new', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1, answer(4));
    await vi.waitFor(() => expect(state().tracks).toHaveLength(4));
    held.respond(0, answer(2));
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().tracks).toHaveLength(4);
  });

  it('库变更立即作废在途应答，1 秒合并重读', async () => {
    vi.useFakeTimers();
    const { host, service, state } = setup();
    const held = host.hold('library.query');
    service.setText('x', true);
    await vi.advanceTimersByTimeAsync(0);
    host.emit('library:itemsRemoved', changed);
    held.respond(0, answer(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ status: 'loading', tracks: [] });
    await vi.advanceTimersByTimeAsync(500);
    host.emit('library:itemsModified', changed);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS - 1);
    expect(held.pending).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    held.respond(0, answer(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(state().tracks).toHaveLength(3);
  });

  it('宿主未连接、未启用、空库、零匹配、读取失败分别表达', async () => {
    const { host, service, state } = setup();
    host.answer('library.isEnabled', { success: true, enabled: false });
    service.setText('x', true);
    await vi.waitFor(() => expect(state().status).toBe('disabled'));
    expect(host.callsTo('library.query')).toEqual([]);
    host.answer('library.isEnabled', { success: true, enabled: true });
    host.answer('library.query', answer(0));
    service.retry();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ total: 0, libraryEmpty: true });
    host.answer('library.getStats', stats(40));
    service.retry();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ total: 0, libraryEmpty: false });
    host.answer('library.query', hostFailure('OPERATION_FAILED'));
    service.retry();
    await vi.waitFor(() => expect(state().status).toBe('failed'));
    expect(state().total).toBeNull();
    host.answer('library.query', answer(1));
    service.retry();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().tracks).toHaveLength(1);
  });

  it('等待宿主超时后可重试，释放后不接晚到应答、不留订阅', async () => {
    vi.useFakeTimers();
    const { host, service, state } = setup(false);
    service.setText('x', true);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(state().status).toBe('unavailable');
    expect(host.calls).toEqual([]);
    host.connect();
    const held = host.hold('library.query');
    service.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(held.pending).toHaveLength(1);
    service.dispose();
    const before = state();
    held.respond(0, answer(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toEqual(before);
    expect(host.listenerCount('library:itemsAdded')).toBe(0);
  });

  it('专辑复用已有清单，不用曲目请求成功与否推断专辑零结果', async () => {
    const { host, store, service } = setup();
    const album = albumRow('Modal Soul', 'Nujabes');
    host.answer('library.getAlbums', {
      success: true,
      albums: [album],
      total: 1,
      offset: 0,
      limit: ALBUM_LIMIT,
      hasMore: false,
      includeCover: false,
      fromCache: false,
    });
    const catalog = startAlbums(store, host.fb);
    onTestFinished(() => catalog.dispose());
    await catalog.ready;
    host.answer('library.query', hostFailure('OPERATION_FAILED'));
    service.setText('nujabes soul', true);
    await vi.waitFor(() => expect(store.get(service.state).status).toBe('failed'));
    expect(store.get(service.albums)).toEqual([album]);
    expect(store.get(service.best)).toBeNull();
    host.answer('library.query', answer(1));
    service.retry();
    await vi.waitFor(() => expect(store.get(service.state).status).toBe('ready'));
    expect(store.get(service.best)).toEqual({ kind: 'album', album });
    host.answer('library.getAlbums', {
      success: true,
      albums: [album],
      total: 2,
      offset: 0,
      limit: ALBUM_LIMIT,
      hasMore: true,
      includeCover: false,
      fromCache: false,
    });
    await catalog.retry();
    expect(store.get(service.albums)).toEqual([album]);
    expect(store.get(service.best)).toBeNull();
  });
});

describe('有序前缀续取', () => {
  it('全选读取完整结果，较早续页晚到也不能缩回部分结果', async () => {
    const { host, service, state } = setup();
    host.answer('library.query', (params) => answer(numberParam(params, 'limit'), 220));
    service.setText('x', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    const held = host.hold('library.query');
    const more = service.more();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const all = service.all();
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1, answer(220));
    expect(await all).toEqual(rows);
    held.respond(0, answer(200, 220));
    await more;
    expect(state().tracks).toEqual(rows);
    expect(host.callsTo('library.query').at(-1)?.['limit']).toBe(220);
  });

  it('全选读取失败或途中换查询，不返回部分曲目', async () => {
    const { host, service, state } = setup();
    host.answer('library.query', answer(100, 220));
    service.setText('x', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    host.answer('library.query', hostFailure('OPERATION_FAILED'));
    expect(await service.all()).toBeNull();
    expect(state().tracks).toHaveLength(100);
    const held = host.hold('library.query');
    const all = service.all();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.setText('new', true);
    held.respond(0, answer(220));
    expect(await all).toBeNull();
    held.release();
  });

  it('扩大前缀整份替换并按身份去重，沿用宿主全库顺序', async () => {
    const { host, service, state } = setup();
    host.answer('library.query', (params) => answer(numberParam(params, 'limit'), 220));
    service.setText('x', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().tracks).toHaveLength(100);
    await service.more();
    expect(state().tracks).toEqual(rows.slice(0, 200));
    await service.more();
    expect(state().tracks).toEqual(rows);
    expect(host.callsTo('library.query').map((call) => call['limit'])).toEqual([100, 200, 300]);
    const before = state();
    await service.more();
    expect(await service.all()).toEqual(rows);
    expect(state()).toBe(before);
  });

  it('续页失败保留已加载内容，重试同一前缀；无增长不伪装成功', async () => {
    const { host, service, state } = setup();
    host.answer('library.query', answer(100, 220));
    service.setText('x', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    host.answer('library.query', hostFailure('OPERATION_FAILED'));
    await service.more();
    expect(state()).toMatchObject({ status: 'ready', moreFailed: true, loadingMore: false });
    expect(state().tracks).toHaveLength(100);
    host.answer('library.query', {
      success: true,
      tracks: [...rows.slice(0, 100), ...rows.slice(0, 100)],
      total: 220,
    });
    await service.more();
    expect(state().moreFailed).toBe(true);
    expect(state().tracks).toHaveLength(100);
    host.answer('library.query', answer(200, 220));
    await service.more();
    expect(state().moreFailed).toBe(false);
    expect(state().tracks).toHaveLength(200);
  });

  it('续页途中改词，旧页不能并进新结果；同次续页不能并发', async () => {
    const { host, service, state } = setup();
    host.answer('library.query', answer(100, 220));
    service.setText('old', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    const held = host.hold('library.query');
    const more = service.more();
    void service.more();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.setText('new', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1, answer(1));
    await vi.waitFor(() => expect(state().tracks).toHaveLength(1));
    held.respond(0, answer(200, 220));
    await more;
    expect(state()).toMatchObject({ text: 'new', total: 1, moreFailed: false });
    expect(state().tracks).toHaveLength(1);
  });

  it('达到显示上限保留真实总数并标明受限，不再发送续页', async () => {
    const { host, service, state } = setup();
    const large = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, i) => ({ handle: `h${i}` }));
    host.answer('library.query', {
      success: true,
      tracks: large,
      total: SEARCH_RESULT_LIMIT + 1,
    });
    service.setText('x', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ limited: true, total: SEARCH_RESULT_LIMIT + 1 });
    const before = state();
    await service.more();
    expect(await service.all()).toBeNull();
    expect(state()).toBe(before);
  });
});
