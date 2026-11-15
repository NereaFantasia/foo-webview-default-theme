import type { AlbumInfo } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { albumCoversVersionAtom, startAlbumCovers } from '../../../src/library/albumCovers.ts';
import { ALBUM_LIMIT, startAlbums } from '../../../src/library/albums.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const A = albumRow('A', 'X');
const B = albumRow('B', 'X');
const C = albumRow('C', 'X');
const D = albumRow('D', 'X');

function albumsAnswer(albums: AlbumInfo[]) {
  return {
    success: true as const,
    albums,
    total: albums.length,
    offset: 0,
    limit: ALBUM_LIMIT,
    hasMore: false,
    includeCover: false,
    fromCache: false,
  };
}

/** 路径里带 `missing` 里某个名字的答「没有封面」，其余给带请求尺寸的地址 */
function answerUrls(host: UnitHost, missing: readonly string[] = []): void {
  host.answer('artwork.getFb2kUrlByPath', (params) => {
    const path = String(params['path']);
    if (missing.some((name) => path.includes(name))) {
      return { success: true, available: false, type: 'front', path, dataUrl: '' };
    }
    return {
      success: true,
      available: true,
      type: 'front',
      path,
      dataUrl: `fb2k://artwork/?path=${path}&size=${String(params['maxSize'])}`,
    };
  });
}

/** 预热加载的替身：缺省立刻成功；`held` 时每个地址悬着，由测试逐个放行 */
function preloader(held = false) {
  const asked: string[] = [];
  const open: ((ok: boolean) => void)[] = [];
  const preload = (url: string): Promise<boolean> => {
    asked.push(url);
    return held ? new Promise((resolve) => open.push(resolve)) : Promise.resolve(true);
  };
  return { preload, asked, release: (ok = true) => open.splice(0).forEach((done) => done(ok)) };
}

function setup(host: UnitHost, preload: (url: string) => Promise<boolean> = async () => true) {
  const store = createStore();
  const scroll: { change: (fast: boolean) => void; stopped: number } = {
    change: () => {},
    stopped: 0,
  };
  const covers = startAlbumCovers(store, host.fb, {
    pixelRatio: () => 1,
    limit: 24,
    retryDelays: [5000],
    probe: null,
    preload,
    watchScroll: (onChange) => {
      scroll.change = onChange;
      return () => {
        scroll.stopped += 1;
      };
    },
  });
  return { store, covers, scroll, version: () => store.get(albumCoversVersionAtom) };
}

/** 让微任务里的应答与预热的下一步都走完；`ms` 是要越过的时间 */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function asksFor(host: UnitHost, ...albums: AlbumInfo[]): number {
  const paths = new Set(albums.map((album) => album.firstTrackPath));
  return host.callsTo('artwork.getFb2kUrlByPath').filter((call) => paths.has(String(call['path'])))
    .length;
}

describe('快速滚动期间暂扣新封面', () => {
  it('新封面不放行，已加载过的照放；慢下来后叫醒排队的，此时才拿得到', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const { covers, scroll } = setup(host);
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await tick();
    expect(covers.acquire(A)).toBe(true);
    covers.settle(A, 'load');
    scroll.change(true);
    expect(covers.acquire(B)).toBe(false);
    expect(covers.acquire(A)).toBe(true);
    covers.settle(A, 'load');
    const retry = vi.fn();
    covers.wait(retry);
    scroll.change(false);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(covers.acquire(B)).toBe(true);
  });

  it('释放服务时停止监视滚动', () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { covers, scroll } = setup(host);
    covers.dispose();
    expect(scroll.stopped).toBe(1);
  });
});

describe('预热', () => {
  it('按次序取地址、加载进缓存并记作已显示；图块之后直接读到，不通知渲染也不再问宿主', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const loader = preloader();
    const { covers, version } = setup(host, loader.preload);
    const before = version();
    covers.warm([A, B, C], 160);
    await tick();
    expect(loader.asked).toHaveLength(3);
    expect(version()).toBe(before);
    for (const album of [A, B, C]) expect(covers.shown(album)).toBe(true);
    expect(covers.coverOf(A, 160)).toMatchObject({ status: 'ready', size: 256 });
    expect(asksFor(host, A, B, C)).toBe(3);
  });

  it('已有记录的专辑不再取', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const loader = preloader();
    const { covers } = setup(host, loader.preload);
    covers.coverOf(A, 160);
    await tick();
    covers.warm([A, B], 160);
    await tick();
    expect(asksFor(host, A)).toBe(1);
    expect(asksFor(host, B)).toBe(1);
    expect(loader.asked).toHaveLength(1);
  });

  it('一次最多取前 400 张，别把宿主只存 500 条的缩放缓存挤满', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const { covers } = setup(host);
    covers.warm(
      Array.from({ length: 450 }, (_, at) => albumRow(`n${at}`, 'X')),
      160,
    );
    await tick();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(400);
  });

  it('前台图块在加载时让路，等它们加载完才继续', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const { covers } = setup(host);
    covers.coverOf(A, 160);
    await tick();
    expect(covers.acquire(A)).toBe(true);
    covers.warm([B], 160);
    await tick(1000);
    expect(asksFor(host, B)).toBe(0);
    covers.settle(A, 'load');
    await tick(200);
    expect(asksFor(host, B)).toBe(1);
  });

  it('页面在快速滚动时让路，慢下来才继续', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const { covers, scroll } = setup(host);
    scroll.change(true);
    covers.warm([A], 160);
    await tick(1000);
    expect(asksFor(host, A)).toBe(0);
    scroll.change(false);
    await tick(200);
    expect(asksFor(host, A)).toBe(1);
  });

  it('同时只有两张在途；停止预热后在途的做完，后面的不再取', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const loader = preloader(true);
    const { covers } = setup(host, loader.preload);
    const stop = covers.warm([A, B, C, D], 160);
    await tick();
    expect(loader.asked).toHaveLength(2);
    stop();
    loader.release();
    await tick();
    expect(asksFor(host, C, D)).toBe(0);
  });

  it('清单整份换了：在途的预热作废，不把旧地址记作已显示，后面的也不取', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    host.answer('library.getAlbums', albumsAnswer([A, B]));
    const loader = preloader(true);
    const { store, covers } = setup(host, loader.preload);
    const albums = startAlbums(store, host.fb);
    await albums.ready;
    covers.warm([A, B, C, D], 160);
    await tick();
    expect(loader.asked).toHaveLength(2);
    await albums.retry();
    loader.release();
    await tick();
    expect(covers.shown(A)).toBe(false);
    expect(asksFor(host, C, D)).toBe(0);
  });

  it('没有封面的不记；加载失败的记着地址但不记作已显示，留给图块自己去问', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host, ['NoCover']);
    const loader = preloader(true);
    const { covers } = setup(host, loader.preload);
    const none = albumRow('NoCover', 'X');
    covers.warm([none, A], 160);
    await tick();
    expect(loader.asked).toHaveLength(1);
    loader.release(false);
    await tick();
    expect(covers.shown(A)).toBe(false);
    expect(covers.coverOf(A, 160)).toMatchObject({ status: 'ready' });
    expect(covers.coverOf(none, 160)).toBeUndefined();
  });

  it('释放之后不再预热', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    answerUrls(host);
    const { covers } = setup(host);
    covers.dispose();
    covers.warm([A], 160);
    await tick(1000);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(0);
  });
});
