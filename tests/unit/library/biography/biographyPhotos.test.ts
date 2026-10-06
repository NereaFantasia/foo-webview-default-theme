import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AlbumsState } from '../../../../src/library/albums.ts';
import { startBiographyPhotos } from '../../../../src/library/biography/biographyPhotos.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const artist = atom<string | null>('Queen');
  const active = atom(true);
  const albums = atom<AlbumsState>({
    status: 'ready',
    enabled: true,
    total: 4,
    truncated: false,
    albums: [
      albumRow('Later', 'Queen', { year: '1980', firstTrackAbsolutePath: 'E:\\Later.flac' }),
      albumRow('Early', 'Queen', { year: '1970', firstTrackAbsolutePath: 'E:\\Early.flac' }),
      albumRow('Copy', 'Queen', { year: '1975', firstTrackAbsolutePath: 'E:\\Copy.flac' }),
      albumRow('Guest', 'Various Artists', {
        artist: 'Queen',
        firstTrackAbsolutePath: 'E:\\Guest.flac',
      }),
    ],
  });
  host.answer('artwork.getForTrack', (params) => ({
    success: true,
    available: true,
    path: String(params['path']),
    type: 'artist',
    dataUrl: String(params['path']).includes('Later') ? 'second' : 'first',
  }));
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    path: String(params['path']),
    type: 'artist',
    dataUrl: `fb2k://artwork/${String(params['path'])}`,
  }));
  const probe = vi.fn(
    async (url: string): Promise<Uint8ClampedArray | null> =>
      new Uint8ClampedArray([url === 'first' ? 1 : 2]),
  );
  const service = startBiographyPhotos(
    store,
    {
      artist,
      active,
      albums,
      probe,
      same: (a, b) => a[0] === b[0],
    },
    host.fb,
  );
  onTestFinished(service.dispose);
  return {
    host,
    store,
    artist,
    active,
    albums,
    probe,
    service,
    state: () => store.get(service.state),
  };
}

describe('本地艺人照片', () => {
  it('回来时同步恢复照片，不再次读取或显示加载状态', async () => {
    const env = setup();
    await tick();
    const photos = env.state().photos;
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    expect(env.state().photos).toEqual(photos);
    expect(env.state().loading).toBe(false);
    await tick();
    expect(env.host.callsTo('artwork.getForTrack')).toHaveLength(3);
  });
  it('从自己的专辑按年份取 artist 图，按像素去重，不取客串与前封面', async () => {
    const env = setup();
    await tick();
    expect(env.state()).toMatchObject({ loading: false, failed: false, artist: 'Queen' });
    expect(env.state().photos.map((item) => item.album)).toEqual(['Early', 'Later']);
    expect(env.host.callsTo('artwork.getForTrack')).toEqual([
      { path: 'E:\\Early.flac', type: 'artist' },
      { path: 'E:\\Copy.flac', type: 'artist' },
      { path: 'E:\\Later.flac', type: 'artist' },
    ]);
  });

  it('不可见时不读图，切换艺人立即清旧图，晚到读取不追加旧目标', async () => {
    const env = setup();
    env.store.set(env.active, false);
    await tick();
    expect(env.host.callsTo('artwork.getForTrack')).toEqual([]);
    env.store.set(env.active, true);
    const held = env.host.hold('artwork.getForTrack');
    await tick();
    env.store.set(env.artist, 'Other');
    expect(env.state().photos).toEqual([]);
    await tick();
    held.respond(0);
    await tick();
    expect(env.state()).toMatchObject({ artist: 'Other', photos: [], loading: false });
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toEqual([]);
  });

  it('无图不算读取失败，失败可重试，成功后清除错误', async () => {
    const env = setup();
    env.host.answer('artwork.getForTrack', {
      success: true,
      available: false,
      path: '',
      type: 'artist',
    });
    await tick();
    expect(env.state()).toMatchObject({ photos: [], failed: false, loading: false });
    env.host.answer('artwork.getForTrack', hostFailure('OPERATION_FAILED'));
    env.service.refresh();
    await tick();
    expect(env.state().failed).toBe(true);
    env.host.answer('artwork.getForTrack', {
      success: true,
      available: true,
      path: '',
      type: 'artist',
      dataUrl: 'first',
    });
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({ failed: false, loading: false });
    expect(env.state().photos).toHaveLength(1);
  });

  it('像素读取后若已释放，不再请求地址或发布照片', async () => {
    const env = setup();
    let resolve: ((pixels: Uint8ClampedArray) => void) | undefined;
    const waiting = new Promise<Uint8ClampedArray>((done) => {
      resolve = done;
    });
    env.probe.mockReturnValue(waiting);
    await tick();
    env.service.dispose();
    resolve?.(new Uint8ClampedArray([1]));
    await tick();
    expect(env.state().photos).toEqual([]);
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toEqual([]);
  });

  it('媒体库变更重取照片，清单截断和解码失败均有状态', async () => {
    const env = setup();
    await tick();
    env.probe.mockRejectedValue(new Error('decode'));
    env.store.set(env.albums, { ...env.store.get(env.albums), truncated: true });
    await tick();
    expect(env.state()).toMatchObject({
      failed: true,
      truncated: true,
      photos: [],
      loading: false,
    });
  });
});
