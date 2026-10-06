import { createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import {
  ROOTS_SETTLE_MS,
  watchOnboardingLibrary,
} from '../../../../src/settings/onboarding/onboardingLibrary.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

interface Library {
  enabled: boolean;
  count: number;
  initialized: boolean;
  roots: string[];
}

function setup(initial: Partial<Library> = {}) {
  const library: Library = { enabled: true, count: 0, initialized: true, roots: [], ...initial };
  const host = installFakeHost({
    answers: {
      config: {
        getLibraryStatus: () => ({
          success: true,
          enabled: library.enabled,
          itemCount: library.count,
          initialized: library.initialized,
        }),
      },
      library: {
        getStatus: () => ({
          success: true,
          enabled: library.enabled,
          initialized: library.enabled,
          scanning: false,
          itemCount: library.count,
          count: library.count,
        }),
        getRoots: () => ({
          success: true,
          enabled: library.enabled,
          roots: library.roots.map((path) => ({
            id: path,
            displayName: path,
            rawPath: path,
            absolutePath: path,
            trackCount: 10,
          })),
          total: library.roots.length,
          indexedTracks: library.count,
          skippedTracks: 0,
          fromCache: false,
        }),
      },
    },
  });
  const store = createStore();
  const watch = watchOnboardingLibrary(store, host.fb);
  onTestFinished(watch.dispose);
  return { host, store, watch, library, read: () => store.get(watch.state) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('第 1 步的媒体库', () => {
  it('第一次应答回来之前是「正在读取」', async () => {
    const { read } = setup();
    expect(read()).toEqual({ phase: 'reading' });
    await vi.advanceTimersByTimeAsync(0);
    expect(read()).toEqual({ phase: 'enabled', count: 0, roots: [], moreRoots: 0 });
  });

  it('没有媒体库文件夹时是「尚未添加」', async () => {
    const { read } = setup({ enabled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(read()).toEqual({ phase: 'disabled' });
  });

  it('媒体库没载完时先不读，等 library:initialized', async () => {
    const { host, read, library } = setup({ initialized: false, count: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(read()).toEqual({ phase: 'reading' });
    expect(host.callsTo('library.getStatus')).toHaveLength(0);
    library.initialized = true;
    host.emit('library:initialized', { timestamp: 1 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(read()).toMatchObject({ phase: 'enabled', count: 5 });
  });

  it('第一次就读失败是「读取失败」；读到过之后再失败保留上一次', async () => {
    const failing = setup();
    failing.host.answer('library.getStatus', hostFailure('OPERATION_FAILED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(failing.read()).toEqual({ phase: 'failed' });

    const env = setup({ count: 3 });
    await vi.advanceTimersByTimeAsync(0);
    env.host.answer('library.getStatus', hostFailure('OPERATION_FAILED'));
    env.watch.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.read()).toMatchObject({ phase: 'enabled', count: 3 });
  });

  it('媒体库事件按 1 秒节流：扫描中连发也照样一秒一读', async () => {
    const { host, read, library } = setup();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i <= 5; i += 1) {
      library.count = i * 100;
      host.emit('library:itemsAdded', { count: 100, timestamp: i });
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(host.callsTo('library.getStatus').length).toBeGreaterThanOrEqual(2);
    expect(host.callsTo('library.getStatus').length).toBeLessThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(read()).toMatchObject({ count: 500 });
  });

  it('曲目数停下来才取根目录，多出的只报个数', async () => {
    const { host, read } = setup({
      count: 60,
      roots: ['D:\\Music', 'E:\\Hi-Res', 'F:\\A', 'F:\\B', 'F:\\C', 'F:\\D'],
    });
    await vi.advanceTimersByTimeAsync(ROOTS_SETTLE_MS - 1);
    expect(host.callsTo('library.getRoots')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(read()).toMatchObject({
      phase: 'enabled',
      count: 60,
      roots: [
        { path: 'D:\\Music', trackCount: 10 },
        { path: 'E:\\Hi-Res', trackCount: 10 },
        { path: 'F:\\A', trackCount: 10 },
        { path: 'F:\\B', trackCount: 10 },
      ],
      moreRoots: 2,
    });
  });

  it('曲目数还在变时推迟取根目录；为 0 时不取', async () => {
    const env = setup({ count: 10, roots: ['D:\\Music'] });
    await vi.advanceTimersByTimeAsync(ROOTS_SETTLE_MS / 2);
    env.library.count = 20;
    env.watch.refresh();
    await vi.advanceTimersByTimeAsync(ROOTS_SETTLE_MS - 1);
    expect(env.host.callsTo('library.getRoots')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(env.host.callsTo('library.getRoots')).toHaveLength(1);

    const empty = setup({ count: 0 });
    await vi.advanceTimersByTimeAsync(ROOTS_SETTLE_MS * 2);
    expect(empty.host.callsTo('library.getRoots')).toHaveLength(0);
  });

  it('释放后不再读，也不再改状态', async () => {
    const { host, watch, read, library } = setup({ count: 1 });
    await vi.advanceTimersByTimeAsync(0);
    watch.dispose();
    library.count = 99;
    host.emit('library:itemsAdded', { count: 98, timestamp: 1 });
    await vi.advanceTimersByTimeAsync(ROOTS_SETTLE_MS * 2);
    expect(read()).toMatchObject({ count: 1 });
    expect(host.callsTo('library.getRoots')).toHaveLength(0);
  });
});
