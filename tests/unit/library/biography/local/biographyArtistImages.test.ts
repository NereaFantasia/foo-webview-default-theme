import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AlbumsState } from '../../../../../src/library/albums.ts';
import { startBiographyArtistImages } from '../../../../../src/library/biography/local/biographyArtistImages.ts';
import { albumRow } from '../../../../fixtures/libraryRows.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const artists = atom<readonly string[]>([
    'David Bowie',
    'The Beatles',
    'Unknown',
    'Various Artists',
  ]);
  const active = atom(true);
  const albums = atom<AlbumsState>({
    status: 'ready',
    enabled: true,
    total: 4,
    truncated: false,
    albums: [
      albumRow('Later', 'David Bowie', { year: '1980', firstTrackAbsolutePath: 'E:\\Later.flac' }),
      albumRow('Early', 'David Bowie', { year: '1970', firstTrackAbsolutePath: 'E:\\Early.flac' }),
      albumRow('Guest', 'Various Artists', {
        artist: 'The Beatles',
        firstTrackAbsolutePath: 'E:\\Guest.flac',
      }),
      albumRow('Other', 'Other', { firstTrackAbsolutePath: 'E:\\Other.flac' }),
    ],
  });
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'artist',
    path: String(params['path']),
    dataUrl: `fb2k://artwork/${String(params['path'])}`,
  }));
  const probe = vi.fn(async (url: string): Promise<Uint8ClampedArray | null> =>
    url.includes('Early') ? null : new Uint8ClampedArray([1, 2, 3, 255]),
  );
  const service = startBiographyArtistImages(store, { artists, active, albums, probe }, host.fb);
  onTestFinished(service.dispose);
  return {
    host,
    store,
    artists,
    active,
    albums,
    probe,
    service,
    state: () => store.get(service.state),
  };
}

describe('相似艺人的本地小头像', () => {
  it('按年份找第一张可解码的 artist 图，限 64 像素，不取客串、陌生人或合辑艺术家', async () => {
    const env = setup();
    await tick();
    expect([...env.state()]).toEqual([['David Bowie', 'fb2k://artwork/E:\\Later.flac']]);
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toEqual([
      { path: 'E:\\Early.flac', type: 'artist', maxSize: 64 },
      { path: 'E:\\Later.flac', type: 'artist', maxSize: 64 },
    ]);
    expect(env.host.callsTo('artwork.getForTrack')).toEqual([]);
    expect(env.host.callsTo('http.get')).toEqual([]);
  });

  it('不可见时不读；同一清单重渲染和重新打开沿用结果，不反复探测缺图', async () => {
    const env = setup();
    env.store.set(env.active, false);
    await tick();
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toEqual([]);
    env.store.set(env.active, true);
    await tick();
    env.store.set(env.artists, [...env.store.get(env.artists)]);
    env.store.set(env.active, false);
    expect(env.state().size).toBe(0);
    env.store.set(env.active, true);
    await tick();
    expect(env.state().get('David Bowie')).toContain('Later');
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
  });

  it.each(['隐藏', '换人', '释放'])('%s 后丢弃在途地址，不继续解码或请求', async (action) => {
    const env = setup();
    const held = env.host.hold('artwork.getFb2kUrlByPath');
    await tick();
    if (action === '隐藏') env.store.set(env.active, false);
    if (action === '换人') env.store.set(env.artists, ['Other']);
    if (action === '释放') env.service.dispose();
    await tick();
    expect(held.pending).toHaveLength(1);
    held.respond(0, {
      success: true,
      available: true,
      type: 'artist',
      path: 'E:\\Early.flac',
      dataUrl: 'old',
    });
    await tick();
    expect(env.state().size).toBe(0);
    expect(env.probe).not.toHaveBeenCalled();
    if (action === '换人') {
      expect(held.pending).toEqual([{ path: 'E:\\Other.flac', type: 'artist', maxSize: 64 }]);
      held.respond(0);
      await tick();
      expect([...env.state()]).toEqual([['Other', 'fb2k://artwork/E:\\Other.flac']]);
    }
    held.release();
  });

  it('解码期间换人，旧图不能写回，后续读取仍串行', async () => {
    const env = setup();
    let finish: ((pixels: Uint8ClampedArray) => void) | undefined;
    env.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await tick();
    env.store.set(env.artists, ['Other']);
    await tick();
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    finish?.(new Uint8ClampedArray([1]));
    await tick();
    expect([...env.state()]).toEqual([['Other', 'fb2k://artwork/E:\\Other.flac']]);
  });

  it('失败不在同一清单内循环重试，主动刷新可恢复', async () => {
    const env = setup();
    env.host.answer('artwork.getFb2kUrlByPath', hostFailure('OPERATION_FAILED'));
    await tick();
    expect(env.state().size).toBe(0);
    env.store.set(env.artists, [...env.store.get(env.artists)]);
    await tick();
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
    env.host.answer('artwork.getFb2kUrlByPath', {
      success: true,
      available: true,
      type: 'artist',
      path: 'E:\\Early.flac',
      dataUrl: 'valid',
    });
    env.service.refresh();
    await tick();
    expect([...env.state()]).toEqual([['David Bowie', 'valid']]);
  });

  it('库更新废弃旧图，隐藏期间不读取，删除专辑后不保留头像', async () => {
    const env = setup();
    await tick();
    expect(env.state().size).toBe(1);
    env.store.set(env.active, false);
    env.store.set(env.albums, { ...env.store.get(env.albums), albums: [], total: 0 });
    await tick();
    env.store.set(env.active, true);
    await tick();
    expect(env.state().size).toBe(0);
    expect(env.host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
  });
});
