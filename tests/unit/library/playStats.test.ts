import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
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
    expect(state()).toMatchObject({ generation: 3, loading: false });
    host.answer('titleformat.evalBatch', evalAnswer);
    await service.fetch(TRACKS.slice(0, 1), 4);
    expect(state().generation).toBe(4);
  });
});
