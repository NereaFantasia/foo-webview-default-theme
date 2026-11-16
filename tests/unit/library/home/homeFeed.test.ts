import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startAlbums } from '../../../../src/library/albums.ts';
import { startLibraryTracks } from '../../../../src/library/libraryTracks.ts';
import { HOME_STATS_BATCH, startHomeFeed } from '../../../../src/library/home/homeFeed.ts';
import { createHomeStatsCache } from '../../../../src/library/home/homeStatsCache.ts';
import { LIBRARY_COALESCE_MS, trackPathOf } from '../../../../src/host/libraryContract.ts';
import { albumsAnswer } from '../../../fixtures/albumLibrary.ts';
import { hostFailure, listParam } from '../../../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';
import { wholeLibrary } from '../../../fixtures/wholeLibrary.ts';
import { FakeLibrary } from '../../../fixtures/mirrorEnv.ts';
import { startLibraryMirror } from '../../../../backend/library/libraryMirror.ts';
import { LIBRARY_MIRROR_ACTIONS } from '../../../../src/server/libraryMirrorProtocol.ts';
import { readLibraryStatsStatus } from '../../../../src/server/libraryStatsProtocol.ts';

afterEach(() => vi.useRealTimers());
afterEach(() => vi.restoreAllMocks());
async function cacheBackend() {
  const directory = await mkdtemp(join(tmpdir(), 'theme-home-stats-'));
  const mirror = startLibraryMirror(directory);
  onTestFinished(async () => {
    mirror.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    port: atom<number | null>(1),
    request: async (path: string, body?: unknown): Promise<unknown> => {
      const action = LIBRARY_MIRROR_ACTIONS.find((item) => `/library/${item}` === path);
      if (!action) throw new Error('未知动作');
      return mirror.request(action, body);
    },
  };
}

function setup(available = true, count = 2, backend?: Parameters<typeof startHomeFeed>[3]) {
  const host = installFakeHost();
  const album = albumRow('A', 'Artist');
  const rows = Array.from({ length: count }, (_, index) =>
    albumTrackRow('A', 'Artist', String(index)),
  );
  host.answer('library.getAlbums', albumsAnswer([album]));
  host.answer('library.search', wholeLibrary(rows));
  host.answer('config.getComponents', {
    success: true,
    count: available ? 1 : 0,
    components: available
      ? [{ name: 'Playback Statistics', version: '3', filename: 'foo_playcount.dll' }]
      : [],
  });
  host.answer('playcount.getBatch', (params) => {
    const paths = listParam(params, 'paths');
    return {
      success: true,
      count: paths.length,
      results: paths.map((path) => ({
        success: true,
        path: String(path),
        lastPlayed: '2026-09-01 00:00:00',
        added: '2025-01-01 00:00:00',
        playCount: 1,
      })),
    };
  });
  const store = createStore();
  const catalog = startAlbums(store, host.fb);
  const tracks = startLibraryTracks(store, () => 0, host.fb);
  const service = startHomeFeed(store, tracks, host.fb, backend);
  onTestFinished(() => {
    service.dispose();
    tracks.dispose();
    catalog.dispose();
  });
  return {
    host,
    service,
    catalog,
    rows,
    album,
    store,
    tracks,
    state: () => store.get(service.state),
  };
}

describe('首页统计服务', () => {
  it('旧缓存分页晚到不能抹掉新一轮统计，最新修订号仍能持久保存', async () => {
    const backend = await cacheBackend();
    const env = setup(true, 1, backend);
    const library = new FakeLibrary(env.rows);
    env.host.answer('library.getChanges', (params) => library.changes(params));
    env.service.activate();
    await vi.waitFor(() => expect(env.state().status).toBe('ready'));
    env.service.dispose();
    const changed = env.rows[0]!;
    library.edit([changed]);
    let release: () => void = () => {};
    let arrived: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let firstPage = true;
    const cache = createHomeStatsCache(
      env.host.fb,
      {
        request: async (path, body) => {
          const reply = await backend.request(path, body);
          if (path === '/library/stats-page' && firstPage) {
            firstPage = false;
            arrived();
            await held;
          }
          return reply;
        },
      },
      () => true,
    );
    let current = true;
    const oldRead = cache.read(env.rows, () => current);
    await started;
    current = false;
    const next = await cache.read(env.rows, () => true);
    next.rows.set(changed.handle, {
      handle: changed.handle,
      path: trackPathOf(changed),
      success: true,
      playCount: 9,
    });
    release();
    await oldRead;
    await cache.save(next, () => true);
    expect(readLibraryStatsStatus(await backend.request('/library/stats-status'))).toMatchObject({
      ready: true,
      revision: 2,
    });
  });

  it('等待缓存开关读回，关闭时只读宿主，重新开启后补存统计', async () => {
    const backend = await cacheBackend();
    const enabled = atom(false);
    let loaded: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    const env = setup(true, 2, { ...backend, enabled, ready });
    const library = new FakeLibrary(env.rows);
    env.host.answer('library.getChanges', (params) => library.changes(params));
    env.service.activate();
    await vi.waitFor(() => expect(env.state().status).toBe('loading'));
    loaded();
    await vi.waitFor(() => expect(env.state().status).toBe('ready'));
    expect(env.state().statistics.mostPlayed.plays).toBe(2);
    expect(readLibraryStatsStatus(await backend.request('/library/stats-status'))?.ready).toBe(
      false,
    );
    vi.useFakeTimers();
    env.store.set(enabled, true);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    await vi.waitFor(async () =>
      expect(readLibraryStatsStatus(await backend.request('/library/stats-status'))).toMatchObject({
        ready: true,
        revision: 1,
      }),
    );
  });
  it('冷读全库时批间允许交互，所有曲目的统计仍完整', async () => {
    vi.useFakeTimers();
    const { host, service, state } = setup(true, 41);
    let inputHandled = false;
    let lastReadAfterInput = false;
    host.answer('playcount.getBatch', (params) => {
      lastReadAfterInput = inputHandled;
      setTimeout(() => {
        inputHandled = true;
      }, 0);
      const paths = listParam(params, 'paths');
      return {
        success: true,
        count: paths.length,
        results: paths.map((path) => ({ path: String(path), success: true, playCount: 1 })),
      };
    });
    service.activate();
    await vi.advanceTimersByTimeAsync(100);
    expect(state()).toMatchObject({ status: 'ready', unreadCount: 0 });
    expect(state().statistics.mostPlayed.tracks.played).toBe(41);
    expect(lastReadAfterInput).toBe(true);
  });

  it('UNC 子曲目统计持久保存，重启同修订号时不重读宿主', async () => {
    const backend = await cacheBackend();
    const env = setup(true, 2, backend);
    env.rows[0] = {
      ...env.rows[0]!,
      path: 'file://\\\\nas\\music\\album.cue',
      handle: '\\\\nas\\music\\album.cue|subsong:2',
      subsong: 2,
    };
    const library = new FakeLibrary(env.rows);
    env.host.answer('library.getChanges', (params) => library.changes(params));
    env.service.activate();
    await vi.waitFor(() => expect(env.state().status).toBe('ready'));
    expect(readLibraryStatsStatus(await backend.request('/library/stats-status'))).toMatchObject({
      ready: true,
      revision: 1,
    });
    const before = env.state().statistics;
    env.service.dispose();
    library.floor = library.revision;
    env.host.answer('playcount.getBatch', hostFailure('OPERATION_FAILED'));
    const restarted = startHomeFeed(env.store, env.tracks, env.host.fb, backend);
    onTestFinished(() => restarted.dispose());
    restarted.activate();
    await vi.waitFor(() => expect(env.store.get(restarted.state).status).toBe('ready'));
    expect(env.store.get(restarted.state).statistics).toEqual(before);
    expect(env.store.get(restarted.state).unreadCount).toBe(0);
  });

  it('统计 hook 只补变化曲目，当前首页不换序，重启读取更新后的缓存', async () => {
    const backend = await cacheBackend();
    const env = setup(true, 3, backend);
    const library = new FakeLibrary(env.rows);
    env.host.answer('library.getChanges', (params) => library.changes(params));
    env.service.activate();
    await vi.waitFor(() => expect(env.state().status).toBe('ready'));
    const previous = env.state().statistics;
    const changed = env.rows[0]!;
    library.edit([changed]);
    env.host.answer('playcount.getBatch', (params) => {
      const paths = listParam(params, 'paths');
      if (paths.some((path) => path !== trackPathOf(changed)))
        return hostFailure('OPERATION_FAILED');
      return {
        success: true,
        count: 1,
        results: [
          {
            path: trackPathOf(changed),
            success: true,
            playCount: 9,
            lastPlayed: '2026-11-15 12:00:00',
          },
        ],
      };
    });
    vi.useFakeTimers();
    env.host.emit('library:itemsModified', {
      count: 1,
      handles: [changed.handle],
      truncated: false,
      fromHook: true,
      timestamp: 1,
    });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    await vi.waitFor(async () =>
      expect(readLibraryStatsStatus(await backend.request('/library/stats-status'))).toMatchObject({
        revision: 2,
      }),
    );
    expect(env.state().statistics).toBe(previous);
    expect(env.state().dirty).toBe(true);
    env.service.dispose();
    library.floor = library.revision;
    env.host.answer('playcount.getBatch', hostFailure('OPERATION_FAILED'));
    const restarted = startHomeFeed(env.store, env.tracks, env.host.fb, backend);
    onTestFinished(() => restarted.dispose());
    restarted.activate();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(env.store.get(restarted.state).status).toBe('ready'));
    expect(env.store.get(restarted.state).statistics.mostPlayed.plays).toBe(11);
  });

  it('初读遇到库变化保留已完成批次，只补变化与尚未读取的曲目', async () => {
    vi.useFakeTimers();
    const env = setup(true, HOME_STATS_BATCH + 1);
    const library = new FakeLibrary(env.rows);
    env.host.answer('library.getChanges', (params) => library.changes(params));
    env.service.activate();
    await vi.advanceTimersByTimeAsync(0);
    const changed = env.rows[0]!;
    library.edit([changed]);
    env.host.answer('playcount.getBatch', (params) => {
      const paths = listParam(params, 'paths');
      if (
        paths.some(
          (path) => path !== trackPathOf(changed) && path !== trackPathOf(env.rows.at(-1)!),
        )
      )
        return hostFailure('OPERATION_FAILED');
      return {
        success: true,
        count: paths.length,
        results: paths.map((path) => ({ path: String(path), success: true, playCount: 2 })),
      };
    });
    env.host.emit('library:itemsModified', {
      count: 1,
      handles: [changed.handle],
      truncated: false,
      fromHook: true,
      timestamp: 1,
    });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS + 100);
    expect(env.state()).toMatchObject({ status: 'ready', unreadCount: 0 });
    expect(env.state().statistics.mostPlayed.plays).toBe(HOME_STATS_BATCH + 3);
  });

  it('单曲失败仍发布成功统计，失败曲目不当成从未播放', async () => {
    const { host, service, state, album } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.answer('playcount.getBatch', (params) => ({
      success: true,
      count: 2,
      results: listParam(params, 'paths').map((path, index) =>
        index === 0
          ? { path: String(path), success: false, error: 'Failed to open file' }
          : { path: String(path), success: true, playCount: 1, lastPlayed: '2026-09-01 00:00:00' },
      ),
    }));
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({
      unreadCount: 1,
      statistics: { recent: [{ album }], unplayed: [] },
    });
  });

  it('一条路径被拒时拆批隔离，其余曲目仍能读到', async () => {
    const { host, service, state, album, rows } = setup(true, 5);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const denied = trackPathOf(rows[2]!);
    host.answer('playcount.getBatch', (params) => {
      const paths = listParam(params, 'paths');
      if (paths.includes(denied)) return hostFailure('PERMISSION_DENIED');
      return {
        success: true,
        count: paths.length,
        results: paths.map((path) => ({
          path: String(path),
          success: true,
          playCount: 1,
          lastPlayed: '2026-09-01 00:00:00',
        })),
      };
    });
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ unreadCount: 1, statistics: { recent: [{ album }] } });
  });

  it('后续批次超时保留已读数据，并记录异常与批次位置', async () => {
    const { host, service, state, album } = setup(true, HOME_STATS_BATCH + 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.answer('playcount.getBatch', (params) => {
      const paths = listParam(params, 'paths');
      if (paths.length === 1) throw new Error('Request timeout');
      return {
        success: true,
        count: paths.length,
        results: paths.map((path) => ({
          path: String(path),
          success: true,
          playCount: 1,
          lastPlayed: '2026-09-01 00:00:00',
        })),
      };
    });
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ unreadCount: 1, statistics: { recent: [{ album }] } });
    expect(warn).toHaveBeenCalledWith(
      '播放统计读取失败',
      expect.objectContaining({
        method: 'playcount.getBatch',
        error: 'Request timeout',
        offset: HOME_STATS_BATCH,
        count: 1,
      }),
    );
  });

  it('全部路径被拒时限制拆批次数，重试成功清除未读计数', async () => {
    const { host, service, state, album } = setup(true, HOME_STATS_BATCH);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.answer('playcount.getBatch', hostFailure('PERMISSION_DENIED'));
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('failed'));
    expect(state().unreadCount).toBe(HOME_STATS_BATCH);
    expect(host.callsTo('playcount.getBatch').length).toBeLessThanOrEqual(33);
    host.answer('playcount.getBatch', (params) => {
      const paths = listParam(params, 'paths');
      return {
        success: true,
        count: paths.length,
        results: paths.map((path) => ({
          path: String(path),
          success: true,
          playCount: 1,
          lastPlayed: '2026-09-01 00:00:00',
        })),
      };
    });
    await service.refresh();
    expect(state()).toMatchObject({
      status: 'ready',
      unreadCount: 0,
      statistics: { recent: [{ album }] },
    });
  });

  it('缺少应答行只计入未读，不丢弃同批成功行', async () => {
    const { host, service, state, album, rows } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.answer('playcount.getBatch', {
      success: true,
      count: 1,
      results: [
        {
          path: trackPathOf(rows[0]!),
          success: true,
          playCount: 1,
          lastPlayed: '2026-09-01 00:00:00',
        },
      ],
    });
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ unreadCount: 1, statistics: { recent: [{ album }] } });
  });

  it('组件清单失败记录实际错误，刷新恢复后清除失败阶段', async () => {
    const { host, service, state } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.answer(
      'config.getComponents',
      hostFailure('OPERATION_FAILED', 'component list unavailable'),
    );
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('failed'));
    expect(state().failure).toBe('components');
    expect(warn).toHaveBeenCalledWith(
      '播放统计读取失败',
      expect.objectContaining({
        method: 'config.getComponents',
        code: 'OPERATION_FAILED',
        error: 'component list unavailable',
      }),
    );
    host.answer('config.getComponents', {
      success: true,
      count: 1,
      components: [{ filename: 'foo_playcount', name: '', version: '3.1.9' }],
    });
    await service.refresh();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().failure).toBeNull();
  });

  it('释放后的权限失败不继续拆批，也不记录过期错误', async () => {
    const { host, service, state } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const held = host.hold('playcount.getBatch');
    service.activate();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const previous = state();
    service.dispose();
    held.respond(0, hostFailure('PERMISSION_DENIED'));
    await Promise.resolve();
    await Promise.resolve();
    expect(state()).toBe(previous);
    expect(warn).not.toHaveBeenCalled();
    expect(host.callsTo('playcount.getBatch')).toHaveLength(1);
  });
  it.each([
    { filename: 'foo_playcount', fileName: 'foo_playcount' },
    { fileName: 'E:\\foobar2000\\components\\foo_playcount' },
    { filename: 'E:\\foobar2000\\components\\FOO_PLAYCOUNT.DLL' },
  ])('组件模块名有无扩展名均可识别：%j', async (module) => {
    const { host, service, state, album } = setup();
    host.answer('config.getComponents', {
      success: true,
      count: 1,
      components: [{ ...module, name: '播放统计信息', version: '3.1.5' }],
    });
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().available).toBe(true);
    expect(state().statistics.recent.map((item) => item.album)).toEqual([album]);
  });
  it('缺少组件不请求统计也不伪装从未播放', async () => {
    const { host, service, state } = setup(false);
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ available: false, statistics: { recent: [], unplayed: [] } });
    expect(host.callsTo('playcount.getBatch')).toEqual([]);
  });
  it('批量统计按公开SDK路径取数，结果折回专辑', async () => {
    const { host, service, state, album } = setup(true, HOME_STATS_BATCH + 1);
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().statistics.recent.map((item) => item.album)).toEqual([album]);
    expect(state().statistics.added).toEqual([album]);
    expect(
      host.callsTo('playcount.getBatch').map((params) => listParam(params, 'paths').length),
    ).toEqual([HOME_STATS_BATCH, 1]);
  });
  it('首次探测途中库事件不丢失初读，旧统计应答丢弃后能够完成新读', async () => {
    vi.useFakeTimers();
    const { host, service, state, rows, album } = setup();
    const probe = host.hold('config.getComponents');
    service.activate();
    await vi.advanceTimersByTimeAsync(0);
    host.emit('library:itemsAdded', { count: 1, handles: [], truncated: false, timestamp: 1 });
    probe.respond(0);
    const held = host.hold('playcount.getBatch');
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(held.pending).toHaveLength(1);
    host.emit('library:itemsModified', {
      count: 1,
      handles: [],
      truncated: false,
      fromHook: false,
      timestamp: 2,
    });
    held.respond(0, {
      success: true,
      count: rows.length,
      results: rows.map((track) => ({
        path: trackPathOf(track),
        success: true,
        playCount: 0,
      })),
    });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(held.pending).toHaveLength(1);
    held.respond(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    for (let pending = held.pending.length; pending > 0; pending -= 1) held.respond(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ status: 'ready', dirty: false });
    expect(state().statistics.recent.map((item) => item.album)).toEqual([album]);
  });
  it('就绪后变化不换序，刷新失败留旧数据', async () => {
    const { host, service, state, album } = setup();
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    const previous = state().statistics;
    host.emit('library:itemsRemoved', { count: 1, handles: [], truncated: false, timestamp: 1 });
    expect(state().statistics).toBe(previous);
    expect(state().dirty).toBe(true);
    host.answer('playcount.getBatch', hostFailure('OPERATION_FAILED'));
    await service.refresh();
    await vi.waitFor(() => expect(state().status).toBe('failed'));
    expect(state().statistics.recent.map((item) => item.album)).toEqual([album]);
  });
  it('释放后不收应答、不留监听', async () => {
    const { host, service, state } = setup();
    const held = host.hold('playcount.getBatch');
    service.activate();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.dispose();
    const previous = state();
    held.respond(0);
    await Promise.resolve();
    expect(state()).toBe(previous);
    expect(host.listenerCount('playback:trackChanged')).toBe(0);
  });
});
