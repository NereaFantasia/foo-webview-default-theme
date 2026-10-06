import type { AlbumInfo } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { albumCoversVersionAtom, startAlbumCovers } from '../../../src/library/albumCovers.ts';
import { ALBUM_LIMIT, startAlbums } from '../../../src/library/albums.ts';
import { createCoverLoad } from '../../../src/covers/coverLoad.ts';
import type { CoverProbe, CoverVerdict } from '../../../src/covers/coverProbe.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const A = albumRow('A', 'X');
const B = albumRow('B', 'X');
const C = albumRow('C', 'X');

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

/** 地址里带着请求尺寸，升档前后分得清。 */
function sizedUrls(host: UnitHost): void {
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: `fb2k://artwork/?path=${String(params['path'])}&size=${String(params['maxSize'])}`,
  }));
}

interface SetupOptions {
  readonly ratio?: number;
  readonly limit?: number;
  readonly retryDelays?: readonly number[];
  /** 缺省不问状态，出错一律按退避重试算。 */
  readonly probe?: CoverProbe;
}

function setup(host: UnitHost, options: SetupOptions = {}) {
  const store = createStore();
  let ratio = options.ratio ?? 1;
  const covers = startAlbumCovers(store, host.fb, {
    pixelRatio: () => ratio,
    limit: options.limit ?? 24,
    retryDelays: options.retryDelays ?? [5000],
    probe: options.probe ?? null,
  });
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    store,
    covers,
    flush,
    setRatio: (next: number) => (ratio = next),
    version: () => store.get(albumCoversVersionAtom),
  };
}

describe('startAlbumCovers', () => {
  it('第一次问只排一次取地址；到了之后给地址，请求尺寸按像素比取档', async () => {
    const host = installFakeHost();
    const { covers, flush, version } = setup(host, { ratio: 1.5 });
    expect(covers.coverOf(A, 200)).toBeUndefined();
    expect(covers.coverOf(A, 200)).toBeUndefined();
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toEqual([
      { path: A.firstTrackPath, type: 'front', maxSize: 384 },
    ]);
    expect(version()).toBeGreaterThan(0);
    expect(covers.coverOf(A, 200)).toMatchObject({ status: 'ready', size: 384 });
  });

  it('没连上宿主时不问、画占位', async () => {
    const host = installFakeHost({ available: false });
    const { covers, flush } = setup(host);
    expect(covers.coverOf(A, 160)).toBeUndefined();
    await flush();
    expect(host.calls).toEqual([]);
  });

  it('拼不出地址或没有首曲路径的判缺图', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', hostFailure('INVALID_PARAMS'));
    const { covers, flush } = setup(host);
    const pathless = albumRow('P', 'X', { firstTrackPath: '' });
    covers.coverOf(A, 160);
    covers.coverOf(pathless, 160);
    await flush();
    expect(covers.coverOf(A, 160)).toEqual({ url: '', status: 'missing', size: 256 });
    expect(covers.coverOf(pathless, 160)?.status).toBe('missing');
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
  });

  it('coverOf 不占名额：名额只有一个时，问过几张都照给地址，要名额的那一张拿得到', async () => {
    const host = installFakeHost();
    const { covers, flush } = setup(host, { limit: 1 });
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await flush();
    expect(covers.coverOf(A, 160)?.status).toBe('ready');
    expect(covers.coverOf(B, 160)?.status).toBe('ready');
    expect(covers.acquire(B)).toBe(true);
  });

  it('同时在加载的不超过上限；名额空出时按排队的先后叫一遍，拿不到的接着排', async () => {
    const host = installFakeHost();
    const { covers, flush } = setup(host, { limit: 1 });
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await flush();
    expect(covers.acquire(A)).toBe(true);
    expect(covers.acquire(B)).toBe(false);
    const woken: string[] = [];
    const leaveB = covers.wait(() => {
      woken.push('B');
      if (covers.acquire(B)) leaveB();
    });
    covers.wait(() => woken.push('C'));
    covers.settle(A, 'load');
    expect(woken).toEqual(['B', 'C']);
    expect(covers.acquire(C)).toBe(false);
  });

  it('同一张的两块图块都要了名额：一块卸掉不空出，另一块加载完才空出', async () => {
    const host = installFakeHost();
    const { covers, flush } = setup(host, { limit: 1 });
    covers.coverOf(A, 160);
    await flush();
    covers.acquire(A);
    covers.acquire(A);
    covers.settle(A, 'abandon');
    expect(covers.acquire(B)).toBe(false);
    covers.settle(A, 'load');
    expect(covers.acquire(B)).toBe(true);
  });

  it('加载出错凉一段不给地址，凉够了带着重试次数再给；再错判缺图', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { covers, version } = setup(host);
    covers.coverOf(A, 160);
    await vi.advanceTimersByTimeAsync(0);
    const first = covers.coverOf(A, 160);
    covers.acquire(A);
    covers.settle(A, 'error');
    expect(covers.coverOf(A, 160)).toBeUndefined();
    const before = version();
    await vi.advanceTimersByTimeAsync(5000);
    expect(version()).toBeGreaterThan(before);
    const retry = covers.coverOf(A, 160);
    expect(retry?.url).toBe(`${first?.url}?retry=1`);
    covers.acquire(A);
    covers.settle(A, 'error');
    expect(covers.coverOf(A, 160)).toEqual({ url: '', status: 'missing', size: 256 });
  });

  it('带着重试次数加载成功：之后照给这个地址，不退回不带次数的原地址', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const { covers } = setup(host);
    covers.coverOf(A, 160);
    await vi.advanceTimersByTimeAsync(0);
    const first = covers.coverOf(A, 160)?.url;
    covers.acquire(A);
    covers.settle(A, 'error');
    await vi.advanceTimersByTimeAsync(5000);
    const retried = covers.coverOf(A, 160)?.url;
    expect(retried).toBe(`${first}?retry=1`);
    covers.acquire(A);
    covers.settle(A, 'load');
    expect(covers.coverOf(A, 160)?.url).toBe(retried);
  });

  it('档位变大：新地址一到就换上，没空名额时图块等着；变小不重取', async () => {
    const host = installFakeHost();
    sizedUrls(host);
    const { covers, flush, setRatio } = setup(host, { limit: 1 });
    const urlOf = (size: number) => `fb2k://artwork/?path=${A.firstTrackPath}&size=${size}`;
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await flush();
    expect(covers.coverOf(A, 160)?.url).toBe(urlOf(256));
    covers.acquire(A);
    covers.settle(A, 'load');
    covers.acquire(B);
    setRatio(3);
    expect(covers.coverOf(A, 160)?.url).toBe(urlOf(256));
    await flush();
    expect(covers.coverOf(A, 160)?.url).toBe(urlOf(512));
    expect(covers.acquire(A)).toBe(false);
    covers.settle(B, 'load');
    expect(covers.acquire(A)).toBe(true);
    setRatio(1);
    covers.coverOf(A, 160);
    await flush();
    const forA = host
      .callsTo('artwork.getFb2kUrlByPath')
      .filter((call) => call['path'] === A.firstTrackPath);
    expect(forA).toHaveLength(2);
  });

  it('升级那一发的新图加载出错：退回旧封面、放弃这次升级，不凉却也不判缺图', async () => {
    const host = installFakeHost();
    sizedUrls(host);
    const { covers, flush, setRatio } = setup(host);
    const urlOf = (size: number) => `fb2k://artwork/?path=${A.firstTrackPath}&size=${size}`;
    covers.coverOf(A, 160);
    await flush();
    covers.acquire(A);
    covers.settle(A, 'load');
    setRatio(3);
    covers.coverOf(A, 160);
    await flush();
    expect(covers.coverOf(A, 160)?.url).toBe(urlOf(512));
    covers.acquire(A);
    covers.settle(A, 'error');
    expect(covers.coverOf(A, 160)).toEqual({ url: urlOf(256), status: 'ready', size: 256 });
    covers.acquire(A);
    covers.settle(A, 'load');
    await flush();
    expect(covers.coverOf(A, 160)?.status).toBe('ready');
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
  });

  it('升档的新图出错时名额已被占满：退回的旧图照样拿得到名额', async () => {
    const host = installFakeHost();
    sizedUrls(host);
    const { covers, flush, setRatio } = setup(host, { limit: 1 });
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await flush();
    covers.acquire(A);
    covers.settle(A, 'load');
    setRatio(3);
    covers.coverOf(A, 160);
    await flush();
    expect(covers.acquire(A)).toBe(true);
    expect(covers.acquire(B)).toBe(false);
    const leaveB = covers.wait(() => {
      if (covers.acquire(B)) leaveB();
    });
    covers.settle(A, 'error');
    expect(covers.acquire(B)).toBe(true);
    expect(covers.coverOf(A, 160)?.size).toBe(256);
    expect(covers.acquire(A)).toBe(true);
  });

  it('升档出错退回旧一档、排在中间的别的专辑拿走空出的名额：每张图都有结局后名额空着', async () => {
    const host = installFakeHost();
    sizedUrls(host);
    const { covers, flush, setRatio } = setup(host, { limit: 1 });
    /** 一块图块：按此刻的封面重渲染一次；浏览器只在 src 变过之后才对它发 load 或 error。 */
    const tile = (album: AlbumInfo) => {
      let changed = false;
      const load = createCoverLoad(
        {
          acquire: () => covers.acquire(album),
          settle: (outcome) => covers.settle(album, outcome),
          wait: (retry) => covers.wait(retry),
        },
        () => (changed = true),
      );
      load.attach();
      return {
        render() {
          const cover = covers.coverOf(album, 160);
          load.show(cover?.status === 'ready' ? cover.url : '', cover?.previous ?? '');
        },
        fire(outcome: 'load' | 'error') {
          if (!changed) return;
          changed = false;
          load.finish(outcome);
        },
      };
    };
    for (const album of [A, B, C]) covers.coverOf(album, 160);
    await flush();
    const t1 = tile(A);
    const t2 = tile(A);
    const holder = tile(B);
    t1.render();
    t1.fire('load');
    t2.render();
    t2.fire('load');
    holder.render();
    setRatio(3);
    covers.coverOf(A, 160);
    await flush();
    const tx = tile(C);
    t1.render();
    tx.render();
    t2.render();
    holder.fire('load');
    t1.fire('error');
    for (const each of [t1, tx, t2]) each.render();
    for (const each of [t1, t2, tx]) each.fire('load');
    // 每张图都有了结局，唯一的名额应当空着：漏掉的借用会一直占着它。
    const late = albumRow('Z', 'X');
    covers.coverOf(late, 160);
    await flush();
    expect(covers.acquire(late)).toBe(true);
  });

  it('升档换上的新地址带着加载过的旧地址；旧的还没加载过就不带', async () => {
    const host = installFakeHost();
    sizedUrls(host);
    const { covers, flush, setRatio } = setup(host);
    const urlOf = (album: AlbumInfo, size: number) =>
      `fb2k://artwork/?path=${album.firstTrackPath}&size=${size}`;
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await flush();
    covers.acquire(A);
    covers.settle(A, 'load');
    setRatio(3);
    covers.coverOf(A, 160);
    covers.coverOf(B, 160);
    await flush();
    expect(covers.coverOf(A, 160)).toMatchObject({ url: urlOf(A, 512), previous: urlOf(A, 256) });
    expect(covers.coverOf(B, 160)?.url).toBe(urlOf(B, 512));
    expect(covers.coverOf(B, 160)?.previous).toBeUndefined();
  });

  it('升级那一发取地址失败：旧图留着，这一档不再重发', async () => {
    const host = installFakeHost();
    const { covers, flush, setRatio } = setup(host);
    covers.coverOf(A, 160);
    await flush();
    covers.acquire(A);
    covers.settle(A, 'load');
    host.answer('artwork.getFb2kUrlByPath', hostFailure('OPERATION_FAILED'));
    setRatio(3);
    for (let round = 0; round < 3; round += 1) {
      expect(covers.coverOf(A, 160)?.status).toBe('ready');
      await flush();
    }
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
  });

  it('清单整份换了才清缓存', async () => {
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer([A, B]));
    const { store, covers, flush } = setup(host);
    const albums = startAlbums(store, host.fb);
    await albums.ready;
    covers.coverOf(C, 160);
    await flush();
    expect(covers.coverOf(C, 160)?.status).toBe('ready');
    await albums.retry();
    expect(covers.coverOf(C, 160)).toBeUndefined();
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
  });

  it('释放之后不给名额，也不再叫排队的', async () => {
    const host = installFakeHost();
    const { covers, flush } = setup(host, { limit: 1 });
    covers.coverOf(A, 160);
    await flush();
    covers.acquire(A);
    let woken = 0;
    covers.wait(() => (woken += 1));
    covers.dispose();
    covers.settle(A, 'load');
    expect(woken).toBe(0);
    expect(covers.acquire(B)).toBe(false);
  });
});

/** 问状态的替身：记下问过的地址，结论由测试逐个给。 */
function heldProbe() {
  const asked: string[] = [];
  const answers: ((verdict: CoverVerdict) => void)[] = [];
  const probe: CoverProbe = (url) => {
    asked.push(url);
    return new Promise((resolve) => answers.push(resolve));
  };
  return { probe, asked, answer: (at: number, verdict: CoverVerdict) => answers[at]?.(verdict) };
}

describe('出错后问状态', () => {
  it('宿主答 404：当场判缺图，不等凉却，凉够了也不再给地址', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const probe = heldProbe();
    const { covers, version } = setup(host, { probe: probe.probe });
    covers.coverOf(A, 160);
    await vi.advanceTimersByTimeAsync(0);
    const first = covers.coverOf(A, 160);
    covers.acquire(A);
    covers.settle(A, 'error');
    expect(probe.asked).toEqual([first?.url]);
    const before = version();
    probe.answer(0, 'missing');
    await vi.advanceTimersByTimeAsync(0);
    expect(version()).toBeGreaterThan(before);
    expect(covers.coverOf(A, 160)).toEqual({ url: '', status: 'missing', size: 256 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(covers.coverOf(A, 160)?.status).toBe('missing');
  });

  it('一时取不到（503 之类）：照旧凉一段再带着重试次数给；再错时问的是带次数的地址', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const probe = heldProbe();
    const { covers } = setup(host, { probe: probe.probe, retryDelays: [5000, 5000] });
    covers.coverOf(A, 160);
    await vi.advanceTimersByTimeAsync(0);
    const first = covers.coverOf(A, 160)?.url;
    covers.acquire(A);
    covers.settle(A, 'error');
    probe.answer(0, 'transient');
    await vi.advanceTimersByTimeAsync(0);
    expect(covers.coverOf(A, 160)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(covers.coverOf(A, 160)?.url).toBe(`${first}?retry=1`);
    covers.acquire(A);
    covers.settle(A, 'error');
    expect(probe.asked).toEqual([first, `${first}?retry=1`]);
  });

  it('问的途中清单整份换了：晚到的 404 作废，不把新取的地址判成缺图', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer([A]));
    const probe = heldProbe();
    const { store, covers } = setup(host, { probe: probe.probe });
    const albums = startAlbums(store, host.fb);
    await vi.advanceTimersByTimeAsync(0);
    covers.coverOf(A, 160);
    await vi.advanceTimersByTimeAsync(0);
    covers.acquire(A);
    covers.settle(A, 'error');
    await albums.retry();
    covers.coverOf(A, 160);
    await vi.advanceTimersByTimeAsync(0);
    probe.answer(0, 'missing');
    await vi.advanceTimersByTimeAsync(0);
    expect(covers.coverOf(A, 160)?.status).toBe('ready');
  });

  it('升档的新图出错退回旧一档：不问状态', async () => {
    const host = installFakeHost();
    sizedUrls(host);
    const probe = heldProbe();
    const { covers, flush, setRatio } = setup(host, { probe: probe.probe });
    covers.coverOf(A, 160);
    await flush();
    covers.acquire(A);
    covers.settle(A, 'load');
    setRatio(2);
    covers.coverOf(A, 160);
    await flush();
    covers.acquire(A);
    covers.settle(A, 'error');
    expect(probe.asked).toEqual([]);
    expect(covers.coverOf(A, 160)?.status).toBe('ready');
  });
});
