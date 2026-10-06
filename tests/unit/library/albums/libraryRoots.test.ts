import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import {
  libraryRootsAtom,
  startLibraryRoots,
} from '../../../../src/library/albums/libraryRoots.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const ROOT = {
  id: 'E:\\Music',
  displayName: 'Music',
  rawPath: 'E:\\Music',
  absolutePath: 'E:\\Music',
  trackCount: 12,
};

describe('startLibraryRoots', () => {
  it('取一次库根与 profile 目录，推出便携安装的相对路径基准', async () => {
    const host = installFakeHost({
      answers: {
        library: {
          getRoots: {
            success: true,
            enabled: true,
            roots: [ROOT, { ...ROOT, id: '', absolutePath: '' }],
            total: 2,
            indexedTracks: 12,
            skippedTracks: 0,
            fromCache: false,
          },
        },
      },
    });
    const store = createStore();
    const service = startLibraryRoots(store, host.fb);
    expect(store.get(libraryRootsAtom).loaded).toBe(false);
    await service.ready;
    expect(store.get(libraryRootsAtom)).toEqual({
      roots: ['E:\\Music'],
      relativeBase: 'E:\\FB2K\\foobar2000',
      loaded: true,
    });
    expect(host.callsTo('library.getRoots')).toHaveLength(1);
  });

  it('读失败的那一样留空，另一样照用', async () => {
    const host = installFakeHost();
    host.answer('misc.getProfilePath', hostFailure('OPERATION_FAILED'));
    host.answer('library.getRoots', () => {
      throw new Error('timeout');
    });
    const store = createStore();
    await startLibraryRoots(store, host.fb).ready;
    expect(store.get(libraryRootsAtom)).toEqual({ roots: [], relativeBase: null, loaded: true });
  });

  it('释放之后晚到的应答不写', async () => {
    const host = installFakeHost();
    const held = host.hold('library.getRoots');
    const store = createStore();
    const service = startLibraryRoots(store, host.fb);
    await Promise.resolve();
    service.dispose();
    held.respond(0, {
      success: true,
      enabled: true,
      roots: [ROOT],
      total: 1,
      indexedTracks: 12,
      skippedTracks: 0,
      fromCache: false,
    });
    await service.ready;
    expect(store.get(libraryRootsAtom).roots).toEqual([]);
  });
});

describe('库根随媒体库变更重取', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function rootsAnswer(paths: string[]) {
    return {
      success: true as const,
      enabled: true,
      roots: paths.map((path) => ({ ...ROOT, id: path, rawPath: path, absolutePath: path })),
      total: paths.length,
      indexedTracks: 12,
      skippedTracks: 0,
      fromCache: false,
    };
  }

  it('事件停下之后才重取一次，扫描期间不跟着每个事件取', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    let paths = ['E:\\Music'];
    host.answer('library.getRoots', () => rootsAnswer(paths));
    const store = createStore();
    const service = startLibraryRoots(store, host.fb);
    await service.ready;
    paths = ['E:\\Music', 'F:\\Hi-Res'];
    for (let i = 0; i < 4; i += 1) {
      host.emit('library:itemsAdded', { count: 1, timestamp: i });
      await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS / 2);
    }
    expect(host.callsTo('library.getRoots')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getRoots')).toHaveLength(2);
    expect(store.get(libraryRootsAtom).roots).toEqual(['E:\\Music', 'F:\\Hi-Res']);
    service.dispose();
  });

  it('重取失败留着上一次的库根；释放后不再重取', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    host.answer('library.getRoots', rootsAnswer(['E:\\Music']));
    const store = createStore();
    const service = startLibraryRoots(store, host.fb);
    await service.ready;
    host.answer('library.getRoots', hostFailure('OPERATION_FAILED'));
    host.emit('library:itemsRemoved', { count: 1, timestamp: 1 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(store.get(libraryRootsAtom).roots).toEqual(['E:\\Music']);
    service.dispose();
    host.emit('library:itemsAdded', { count: 1, timestamp: 2 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS * 2);
    expect(host.callsTo('library.getRoots')).toHaveLength(2);
  });
});
