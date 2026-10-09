import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startAlbums } from '../../../../src/library/albums.ts';
import { startLibraryTracks } from '../../../../src/library/libraryTracks.ts';
import { HOME_STATS_BATCH, startHomeFeed } from '../../../../src/library/home/homeFeed.ts';
import { LIBRARY_COALESCE_MS, trackPathOf } from '../../../../src/host/libraryContract.ts';
import { albumsAnswer } from '../../../fixtures/albumLibrary.ts';
import { hostFailure, listParam } from '../../../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

afterEach(() => vi.useRealTimers());
afterEach(() => vi.restoreAllMocks());
function setup(available = true, count = 2) {
  const host = installFakeHost();
  const album = albumRow('A', 'Artist');
  const rows = Array.from({ length: count }, (_, index) =>
    albumTrackRow('A', 'Artist', String(index)),
  );
  host.answer('library.getAlbums', albumsAnswer([album]));
  host.answer('library.getAll', {
    success: true,
    tracks: rows,
    items: rows,
    total: rows.length,
    offset: 0,
  });
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
  const service = startHomeFeed(store, tracks, host.fb);
  onTestFinished(() => {
    service.dispose();
    tracks.dispose();
    catalog.dispose();
  });
  return { host, service, catalog, rows, album, state: () => store.get(service.state) };
}

describe('首页统计服务', () => {
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
      statistics: { recent: [album], unplayed: [] },
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
    expect(state()).toMatchObject({ unreadCount: 1, statistics: { recent: [album] } });
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
    expect(state()).toMatchObject({ unreadCount: 1, statistics: { recent: [album] } });
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
      statistics: { recent: [album] },
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
    expect(state()).toMatchObject({ unreadCount: 1, statistics: { recent: [album] } });
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
    expect(state().statistics.recent).toEqual([album]);
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
    expect(state().statistics.recent).toEqual([album]);
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
    host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
    probe.respond(0);
    const held = host.hold('playcount.getBatch');
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(held.pending).toHaveLength(1);
    host.emit('library:itemsModified', { count: 1, timestamp: 2 });
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
    expect(state().statistics.recent).toEqual([album]);
  });
  it('就绪后变化不换序，刷新失败留旧数据', async () => {
    const { host, service, state, album } = setup();
    service.activate();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    const previous = state().statistics;
    host.emit('library:itemsRemoved', { count: 1, timestamp: 1 });
    expect(state().statistics).toBe(previous);
    expect(state().dirty).toBe(true);
    host.answer('playcount.getBatch', hostFailure('OPERATION_FAILED'));
    await service.refresh();
    await vi.waitFor(() => expect(state().status).toBe('failed'));
    expect(state().statistics.recent).toEqual([album]);
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
