import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  BATCH_MIN,
  FIRST_BATCH,
  playStatsAtom,
  playcountMissingAtom,
  startPlayStats,
} from '../../../src/library/playStats.ts';
import type { HostParams } from '../../fixtures/fakeHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const TRACKS = Array.from({ length: 700 }, (_, at) =>
  trackRow('Album', `t${at}`, { subsong: at === 0 ? 2 : 0 }),
);

function pathsOf(params: HostParams): string[] {
  const paths: unknown = params['paths'];
  return Array.isArray(paths) ? paths.map(String) : [];
}

/** 第 0 首没有播放记录，foo_playcount 的日期答 N/A。 */
function evalAnswer(params: HostParams) {
  const results = pathsOf(params).map((path, at) => ({
    path,
    success: true,
    result: `2024-01-01 00:00:00|${at === 0 ? 'N/A' : '2024-02-02 00:00:00'}||${at}`,
  }));
  return {
    success: true as const,
    pattern: String(params['pattern']),
    total: results.length,
    successCount: results.length,
    errorCount: 0,
    results,
  };
}

function setup(elapsed: number[] = []) {
  const host = installFakeHost();
  const store = createStore();
  let clock = 0;
  const service = startPlayStats(store, host.fb, () => {
    clock += elapsed.shift() ?? 0;
    return clock;
  });
  onTestFinished(() => service.dispose());
  return {
    host,
    service,
    state: () => store.get(playStatsAtom),
    missing: () => store.get(playcountMissingAtom),
  };
}

describe('探 foo_playcount', () => {
  it('已安装组件且所有播放次数为空时仍可用', async () => {
    const { host, service, state, missing } = setup();
    host.answer('config.getComponents', {
      success: true,
      count: 1,
      components: [{ name: '播放统计信息', version: '3.1.10', filename: 'foo_playcount' }],
    });
    await service.probe();
    expect(state().available).toBe(true);
    expect(missing()).toBe(false);
    expect(host.callsTo('config.getComponents')).toEqual([{}]);
    expect(host.callsTo('titleformat.evalBatch')).toEqual([]);
    await service.probe();
    expect(host.callsTo('config.getComponents')).toHaveLength(1);
  });

  it.each([
    { filename: 'foo_playcount.dll' },
    { fileName: 'foo_playcount' },
    { filename: '', fileName: 'foo_playcount.dll' },
    { filename: 'E:\\foobar2000\\components\\FOO_PLAYCOUNT.DLL' },
    { fileName: 'E:/foobar2000/components/foo_playcount' },
  ])('组件模块名兼容路径、别名和大小写：%j', async (module) => {
    const { host, service, state } = setup();
    host.answer('config.getComponents', {
      success: true,
      count: 1,
      components: [{ name: '播放统计信息', version: '3.1.10', ...module }],
    });
    await service.probe();
    expect(state().available).toBe(true);
  });

  it.each(['foo_playcount_extra.dll', 'other_foo_playcount.dll', 'foo_playcount.dll.bak', ''])(
    '相似模块名或显示名称不能当作组件已安装：%s',
    async (filename) => {
      const { host, service, missing } = setup();
      host.answer('config.getComponents', {
        success: true,
        count: 1,
        components: [{ name: 'foo_playcount', version: '3.1.10', filename }],
      });
      await service.probe();
      expect(missing()).toBe(true);
    },
  );

  it('组件清单为空才报告缺失，即使曲目有播放次数字段', async () => {
    const { host, service, state, missing } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.probe();
    expect(state().available).toBe(false);
    expect(missing()).toBe(true);
    expect(host.callsTo('titleformat.evalBatch')).toEqual([]);
  });

  it.each(['失败信封', '异常'])('组件清单读取%s时不报告缺失，下次可重试', async (failure) => {
    const { host, service, state, missing } = setup();
    host.answer('config.getComponents', () => {
      if (failure === '异常') throw new Error('读取组件清单失败');
      return hostFailure('OPERATION_FAILED');
    });
    await service.probe();
    expect(state().available).toBeNull();
    expect(state().probeFailed).toBe(true);
    expect(missing()).toBe(false);
    host.answer('config.getComponents', {
      success: true,
      count: 1,
      components: [{ name: '播放统计信息', version: '3.1.10', filename: 'foo_playcount' }],
    });
    await service.probe();
    expect(state().available).toBe(true);
    expect(missing()).toBe(false);
    expect(host.callsTo('config.getComponents')).toHaveLength(2);
    expect(state().probeFailed).toBe(false);
  });

  it('进行中的探测不重复请求，释放后晚到的应答不改变状态', async () => {
    const { host, service, state, missing } = setup();
    const held = host.hold('config.getComponents');
    const first = service.probe();
    await service.probe();
    expect(held.pending).toHaveLength(1);
    expect(state().available).toBeNull();
    expect(missing()).toBe(false);
    service.dispose();
    held.respond(0);
    await first;
    expect(state().available).toBeNull();
    expect(missing()).toBe(false);
    await service.probe();
    expect(host.callsTo('config.getComponents')).toHaveLength(1);
  });
});

describe('取统计', () => {
  it('一条路径被拒绝时隔离它，发布其他曲目统计，同代次可以重试补齐', async () => {
    const { host, service, state } = setup();
    const denied = TRACKS[1]!.path;
    host.answer('titleformat.evalBatch', (params) =>
      pathsOf(params).includes(denied) ? hostFailure('PERMISSION_DENIED') : evalAnswer(params),
    );
    await service.fetch(TRACKS, 1);
    expect(state()).toMatchObject({ generation: 1, loading: false, readFailed: true });
    expect(state().byHandle?.size).toBe(TRACKS.length - 1);
    expect(state().byHandle?.has(TRACKS[1]!.handle)).toBe(false);
    expect(state().byHandle?.has(TRACKS.at(-1)!.handle)).toBe(true);
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS, 1);
    expect(state().byHandle?.size).toBe(TRACKS.length);
    expect(state().readFailed).toBe(false);
  });

  it('逐行失败或元数据不可用时保留成功行，不把未读到的次数填成零', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', (params) => {
      const answer = evalAnswer(params);
      return {
        ...answer,
        results: answer.results.map((row, at) =>
          at === 0 ? { ...row, success: false } : { ...row, infoAvailable: at !== 1 },
        ),
      };
    });
    await service.fetch(TRACKS.slice(0, 3), 1);
    expect(state()).toMatchObject({ generation: 1, loading: false, readFailed: true });
    expect([...(state().byHandle?.keys() ?? [])]).toEqual([TRACKS[2]!.handle]);
  });

  it('后续批次异常时保留已读统计，整库拒绝时额外请求有上限', async () => {
    const { host, service, state } = setup([0, 80]);
    host.answer('titleformat.evalBatch', (params) => {
      if (pathsOf(params)[0] !== `${TRACKS[0]!.path}|subsong:2`)
        return hostFailure('OPERATION_FAILED');
      return evalAnswer(params);
    });
    await service.fetch(TRACKS, 1);
    expect(state().byHandle?.size).toBe(FIRST_BATCH);
    expect(state().readFailed).toBe(true);
    host.answer('titleformat.evalBatch', hostFailure('PERMISSION_DENIED'));
    const before = host.callsTo('titleformat.evalBatch').length;
    await service.fetch(TRACKS, 2);
    expect(host.callsTo('titleformat.evalBatch').length - before).toBeLessThan(160);
    expect(state().generation).toBe(1);
    expect(state().byHandle?.size).toBe(FIRST_BATCH);
  });

  it('头一批取定量，之后按耗时换算批量；取完才整份换上', async () => {
    const { host, service, state } = setup([0, 80, 0, 10, 0, 10]);
    const sizes: number[] = [];
    host.answer('titleformat.evalBatch', (params) => {
      sizes.push(pathsOf(params).length);
      expect(state().byHandle).toBeNull();
      return evalAnswer(params);
    });
    await service.fetch(TRACKS, 1);
    expect(sizes[0]).toBe(FIRST_BATCH);
    expect(sizes[1]).toBe(BATCH_MIN);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(TRACKS.length);
    expect(pathsOf(host.callsTo('titleformat.evalBatch')[0] ?? {})[0]).toBe(
      `${TRACKS[0]?.path}|subsong:2`,
    );
    expect(state()).toMatchObject({ generation: 1, loading: false });
    expect(state().byHandle?.get(TRACKS[0]?.handle ?? '')).toEqual({
      added: '2024-01-01 00:00:00',
      lastPlayed: '',
      firstPlayed: '',
      playCount: 0,
    });
    expect(state().byHandle?.get(TRACKS[5]?.handle ?? '')?.playCount).toBe(5);
  });

  it('同一代取过不再取；新的一代让还在取的旧一代作废；失败的一代下次重取', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    await service.fetch(TRACKS.slice(0, 3), 1);
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);
    const held = host.hold('titleformat.evalBatch');
    const old = service.fetch(TRACKS.slice(0, 3), 2);
    const next = service.fetch(TRACKS.slice(3, 4), 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.release();
    await Promise.all([old, next]);
    expect(state().generation).toBe(3);
    expect([...(state().byHandle?.keys() ?? [])]).toEqual([TRACKS[3]?.handle]);
    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    await service.fetch(TRACKS.slice(0, 1), 4);
    expect(state()).toMatchObject({ generation: 3, loading: false, readFailed: true });
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 1), 4);
    expect(state().generation).toBe(4);
    expect(state().readFailed).toBe(false);
  });
});

describe('hook 刷新', () => {
  const hook = (handles: string[]) => ({
    count: handles.length,
    handles,
    truncated: false,
    fromHook: true as const,
    timestamp: 1,
  });

  /** 重取回的新值：added 进位、次数按路径分出 99 与 42。 */
  function refreshedAnswer(params: HostParams) {
    const results = pathsOf(params).map((path) => ({
      path,
      success: true,
      result: `2024-03-03 00:00:00|2024-04-04 00:00:00|2024-01-02 00:00:00|${
        path.includes('\\t1.flac') ? 99 : 42
      }`,
    }));
    return {
      success: true as const,
      pattern: String(params['pattern']),
      total: results.length,
      successCount: results.length,
      errorCount: 0,
      results,
    };
  }

  it('已发布的统计按 handles 精确重取并合并；未知曲目不取，其余沿用旧值', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    host.answer('titleformat.evalBatch', refreshedAnswer);
    host.emit('library:itemsModified', {
      ...hook([TRACKS[1]!.handle, TRACKS[2]!.handle, 'E:\\unknown.flac']),
      count: 3,
    });
    await vi.waitFor(() => expect(state().byHandle?.get(TRACKS[1]!.handle)?.playCount).toBe(99));
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(2);
    expect(pathsOf(host.callsTo('titleformat.evalBatch')[1] ?? {})).toEqual([
      TRACKS[1]!.handle,
      TRACKS[2]!.handle,
    ]);
    expect(state().byHandle?.get(TRACKS[2]!.handle)).toMatchObject({
      added: '2024-03-03 00:00:00',
      playCount: 42,
    });
    expect(state().byHandle?.get(TRACKS[0]!.handle)).toMatchObject({
      added: '2024-01-01 00:00:00',
      playCount: 0,
    });
    expect(state()).toMatchObject({ generation: 1, loading: false, readFailed: false });
  });

  it('重取请求失败时保留已发布的旧值', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    host.answer('titleformat.evalBatch', refreshedAnswer);
    host.emit('library:itemsModified', hook([TRACKS[2]!.handle]));
    await vi.waitFor(() => expect(state().byHandle?.get(TRACKS[2]!.handle)?.playCount).toBe(42));
    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    host.emit('library:itemsModified', hook([TRACKS[1]!.handle]));
    await vi.waitFor(() => expect(host.callsTo('titleformat.evalBatch')).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state().byHandle?.get(TRACKS[1]!.handle)?.playCount).toBe(1);
    expect(state().byHandle?.get(TRACKS[2]!.handle)?.playCount).toBe(42);
    expect(state().readFailed).toBe(false);
  });

  it('还没发布过统计时不发请求', async () => {
    const { host } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    host.emit('library:itemsModified', hook([TRACKS[1]!.handle]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.callsTo('titleformat.evalBatch')).toEqual([]);
  });

  it('宿主晚到时订阅在就绪后补建', async () => {
    const host = installFakeHost({ available: false });
    const store = createStore();
    const service = startPlayStats(store, host.fb);
    onTestFinished(() => service.dispose());
    const state = () => store.get(playStatsAtom);
    expect(host.listenerCount('library:itemsModified')).toBe(0);
    host.connect();
    await vi.waitFor(() => expect(host.listenerCount('library:itemsModified')).toBeGreaterThan(0));
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    host.answer('titleformat.evalBatch', refreshedAnswer);
    host.emit('library:itemsModified', hook([TRACKS[1]!.handle]));
    await vi.waitFor(() => expect(state().byHandle?.get(TRACKS[1]!.handle)?.playCount).toBe(99));
  });

  it('整取进行中不发请求，回来的一轮本来就有新值', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    const held = host.hold('titleformat.evalBatch');
    const refetch = service.fetch(TRACKS, 2);
    expect(state().loading).toBe(true);
    host.emit('library:itemsModified', hook([TRACKS[1]!.handle]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(2);
    held.release();
    await refetch;
    expect(state().generation).toBe(2);
    expect(
      host.callsTo('titleformat.evalBatch').some((params) => pathsOf(params).length === 1),
    ).toBe(false);
  });

  it('truncated 时按上一轮曲目整取', async () => {
    const { host, service, state } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    host.answer('titleformat.evalBatch', refreshedAnswer);
    host.emit('library:itemsModified', {
      count: 6000,
      handles: [],
      truncated: true,
      fromHook: true,
      timestamp: 1,
    });
    await vi.waitFor(() => expect(state().byHandle?.get(TRACKS[1]!.handle)?.playCount).toBe(99));
    expect(pathsOf(host.callsTo('titleformat.evalBatch')[1] ?? {})).toHaveLength(3);
    expect(state()).toMatchObject({ generation: 1, loading: false, readFailed: false });
  });

  it('释放后不再发请求', async () => {
    const { host, service } = setup();
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 3), 1);
    service.dispose();
    host.emit('library:itemsModified', hook([TRACKS[1]!.handle]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);
  });
});
