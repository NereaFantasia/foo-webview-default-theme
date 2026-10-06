import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startBiographyOnlinePhoto } from '../../../../../src/library/biography/online/biographyOnlinePhoto.ts';
import type {
  fetchLastfmPhoto,
  LastfmPhotoResult,
} from '../../../../../src/library/biography/online/fetchLastfmPhoto.ts';
import type { LastfmPhoto } from '../../../../../src/library/biography/online/lastfmPhoto.ts';
import { TAISHI_PHOTO } from '../../../../fixtures/biographyPhotoSamples.ts';
import { createBiographyPhotoCache } from '../../../../../src/library/biography/biographyPhotoCache.ts';
import type { LastfmGalleryResult } from '../../../../../src/library/biography/online/lastfmGallery.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);
const success = (store = true): LastfmPhotoResult => ({
  ok: true,
  blob: new Blob(['photo'], { type: 'image/jpeg' }),
  store,
  expiresAt: Date.now() + 60000,
});

function setup() {
  const store = createStore();
  const source = atom<LastfmPhoto | null>(TAISHI_PHOTO);
  const active = atom(true);
  const ready = atom(true);
  const probe = vi.fn(
    async (): Promise<Uint8ClampedArray | null> => new Uint8ClampedArray([1, 2, 3, 255]),
  );
  const fetch = vi.fn<typeof fetchLastfmPhoto>().mockImplementation(async () => success());
  const service = startBiographyOnlinePhoto(store, { source, active, ready, probe }, fetch);
  onTestFinished(service.dispose);
  return {
    store,
    source,
    active,
    ready,
    probe,
    fetch,
    service,
    state: () => store.get(service.state),
  };
}

describe('在线主图生命周期', () => {
  it('先等正文和附加请求结束，可见时才读，重复打开命中单张缓存', async () => {
    const env = setup();
    env.store.set(env.active, false);
    await tick();
    expect(env.fetch).not.toHaveBeenCalled();
    env.store.set(env.ready, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.fetch).not.toHaveBeenCalled();
    env.store.set(env.ready, true);
    await tick();
    const photo = env.state().photo;
    expect(photo).toMatchObject({ sourceUrl: TAISHI_PHOTO.pageUrl, album: 'Last.fm' });
    expect(photo?.url).toMatch(/^blob:/);
    env.store.set(env.active, false);
    expect(env.state().photo).toBeNull();
    env.store.set(env.active, true);
    await tick();
    expect(env.state().photo).toMatchObject({ key: photo?.key, pixels: photo?.pixels });
    expect(env.fetch).toHaveBeenCalledTimes(1);
  });

  it('两个视图共享相册和图片，支持无主图的多图艺人，释放一方不破坏另一方', async () => {
    const store = createStore();
    const cache = createBiographyPhotoCache();
    const source = atom<LastfmPhoto | null>(null);
    const artist = atom<string | null>('Taishi');
    const firstActive = atom(true);
    const secondActive = atom(true);
    const second = {
      ...TAISHI_PHOTO,
      url: TAISHI_PHOTO.url.replace(
        '70bdc305cb8e9bc44837393a48202ca6',
        '1234567890abcdef1234567890abcdef',
      ),
      pageUrl: TAISHI_PHOTO.pageUrl.replace(
        '70bdc305cb8e9bc44837393a48202ca6',
        '1234567890abcdef1234567890abcdef',
      ),
    };
    const gallery = vi.fn(async (): Promise<LastfmGalleryResult> => ({
      ok: true,
      photos: [TAISHI_PHOTO, second],
      store: true,
      expiresAt: Date.now() + 60_000,
    }));
    const fetch = vi.fn<typeof fetchLastfmPhoto>().mockImplementation(async () => success());
    const probe = vi.fn(async () => new Uint8ClampedArray([1, 2, 3, 255]));
    const deps = { source, artist, cache, probe, ready: atom(true) };
    const a = startBiographyOnlinePhoto(store, { ...deps, active: firstActive }, fetch, gallery);
    const b = startBiographyOnlinePhoto(store, { ...deps, active: secondActive }, fetch, gallery);
    onTestFinished(() => {
      a.dispose();
      b.dispose();
      cache.clear();
    });
    await tick();
    expect(store.get(a.state).photos?.map((item) => item.sourceUrl)).toEqual([
      TAISHI_PHOTO.pageUrl,
      second.pageUrl,
    ]);
    expect(store.get(b.state).photos).toHaveLength(2);
    expect(gallery).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledTimes(2);
    const url = store.get(b.state).photo?.url;
    a.dispose();
    expect(store.get(b.state).photo?.url).toBe(url);
    store.set(secondActive, false);
    store.set(secondActive, true);
    expect(store.get(b.state).photos).toHaveLength(2);
    expect(store.get(b.state).loading).toBe(false);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['隐藏', '关闭', '换人', '清理', '释放'])('%s 后不解码或显示晚到图片', async (action) => {
    const env = setup();
    let finish: ((result: LastfmPhotoResult) => void) | undefined;
    env.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await tick();
    if (action === '隐藏') env.store.set(env.active, false);
    if (action === '关闭') env.store.set(env.source, null);
    if (action === '换人')
      env.store.set(env.source, { ...TAISHI_PHOTO, pageUrl: `${TAISHI_PHOTO.pageUrl}/other` });
    if (action === '清理') env.service.clear();
    if (action === '释放') env.service.dispose();
    finish?.(success());
    await tick();
    if (action === '换人') {
      expect(env.state().photo?.sourceUrl).toContain('/other');
      expect(env.fetch).toHaveBeenCalledTimes(2);
    } else {
      expect(env.state().photo).toBeNull();
      expect(env.probe).not.toHaveBeenCalled();
    }
  });

  it('解码期间清理会回收对象地址，主动刷新不与旧请求并发', async () => {
    const env = setup();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    let finish: ((pixels: Uint8ClampedArray) => void) | undefined;
    env.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await tick();
    const old = env.probe.mock.calls[0];
    env.service.clear();
    env.service.refresh();
    await tick();
    expect(env.fetch).toHaveBeenCalledTimes(1);
    finish?.(new Uint8ClampedArray([1]));
    await tick();
    expect(env.fetch).toHaveBeenCalledTimes(2);
    expect(env.state().photo).not.toBeNull();
    expect(revoke).toHaveBeenCalled();
    expect(old).toBeDefined();
  });

  it('刷新失败保留旧图，网络错误可主动重试，等待正文完成不会丢失强制刷新', async () => {
    const env = setup();
    await tick();
    const old = env.state().photo;
    env.fetch.mockResolvedValueOnce({ ok: false, problem: 'network', retryAt: Date.now() + 30000 });
    env.store.set(env.ready, false);
    env.service.refresh();
    await tick();
    env.store.set(env.ready, true);
    await tick();
    expect(env.state()).toMatchObject({ photo: old, problem: 'network', loading: false });
    env.service.refresh();
    await tick();
    expect(env.state().photo).not.toBe(old);
    expect(env.state().problem).toBeNull();
  });

  it('限流约束手动刷新和下一位艺人，缺图不会循环请求', async () => {
    const env = setup();
    env.fetch.mockResolvedValueOnce({
      ok: false,
      problem: 'rateLimited',
      retryAt: Date.now() + 60000,
    });
    await tick();
    env.service.refresh();
    await tick();
    env.store.set(env.source, {
      ...TAISHI_PHOTO,
      url: TAISHI_PHOTO.url.replace('/ar0/', '/300x300/'),
    });
    await tick();
    expect(env.state().problem).toBe('rateLimited');
    expect(env.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60001);
    env.service.refresh();
    await tick();
    expect(env.state().photo).not.toBeNull();
  });

  it('no-store 仅供当前显示，隐藏后释放；清理回收缓存和字节数', async () => {
    const env = setup();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    env.fetch.mockImplementation(async () => success(false));
    await tick();
    const url = env.state().photo?.url;
    expect(url).toMatch(/^blob:/);
    expect(env.state().bytes).toBe(0);
    env.store.set(env.active, false);
    expect(revoke).toHaveBeenCalledWith(url);
    env.store.set(env.active, true);
    env.fetch.mockImplementation(async () => success());
    await tick();
    expect(env.fetch).toHaveBeenCalledTimes(2);
    expect(env.state().bytes).toBeGreaterThan(0);
    env.service.clear();
    expect(env.state()).toEqual({ photo: null, bytes: 0, loading: false, problem: null });
    await tick();
    expect(env.fetch).toHaveBeenCalledTimes(2);
  });
});
