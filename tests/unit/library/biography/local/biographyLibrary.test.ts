import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  BIOGRAPHY_LIBRARY_LIMIT,
  startBiographyLibrary,
  summarizeBiographyLibrary,
} from '../../../../../src/library/biography/local/biographyLibrary.ts';
import { biographyLocalTracks } from '../../../../fixtures/biographySamples.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../../../fixtures/tracks.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

function setup(activeAtStart = true) {
  const host = installFakeHost();
  const store = createStore();
  const artist = atom<string | null>('Queen');
  const active = atom(activeAtStart);
  host.answer('library.getArtistTracks', (params) => {
    const name = String(params['artist']);
    const tracks = biographyLocalTracks(name);
    return {
      success: true,
      artist: name,
      tracks,
      items: tracks,
      count: tracks.length,
      total: tracks.length,
    };
  });
  const service = startBiographyLibrary(store, { artist, active }, host.fb);
  onTestFinished(service.dispose);
  return { host, store, artist, active, service, state: () => store.get(service.state) };
}

describe('简介本地署名资料', () => {
  it('按专辑键区分自己与参与，曲目按句柄去重，合作艺人按真实多值而非字符串拆分', () => {
    const tracks = biographyLocalTracks();
    const composite = makeTrack({
      path: 'file://E:/composite.flac',
      artists: ['Queen', 'Duo feat. Guest', 'Guest', 'Guest', 'Various Artists'],
      album: 'Own',
      albumArtist: 'Other',
      duration: 300,
    });
    expect(summarizeBiographyLibrary('Queen', [...tracks, ...tracks, composite])).toEqual({
      albums: 1,
      appearances: 2,
      tracks: 4,
      duration: 3000,
      collaborators: ['Guest', 'Duo feat. Guest', 'Other'],
    });
  });

  it('仅在可见时读，先订库变更再初读，同一艺人重新打开沿用摘要', async () => {
    const env = setup(false);
    await env.service.ready;
    await tick();
    expect(env.host.callsTo('library.getArtistTracks')).toEqual([]);
    expect(env.host.listenerCount('library:itemsModified')).toBe(1);
    env.store.set(env.active, true);
    await tick();
    expect(env.host.callsTo('library.getArtistTracks')).toEqual([
      { artist: 'Queen', limit: BIOGRAPHY_LIBRARY_LIMIT },
    ]);
    expect(env.state()).toMatchObject({
      loading: false,
      failed: false,
      summary: {
        albums: 1,
        appearances: 1,
        tracks: 3,
        duration: 2700,
        collaborators: ['Guest', 'Other'],
      },
    });
    env.store.set(env.active, false);
    expect(env.state().summary).toBeNull();
    env.store.set(env.active, true);
    await tick();
    expect(env.state().summary?.tracks).toBe(3);
    expect(env.host.callsTo('library.getArtistTracks')).toHaveLength(1);
    expect(env.host.callsTo('http.get')).toEqual([]);
  });

  it.each(['隐藏', '换艺人', '停止', '释放'])('%s 后不采纳晚到结果', async (action) => {
    const env = setup();
    await env.service.ready;
    const held = env.host.hold('library.getArtistTracks');
    await tick();
    if (action === '隐藏') env.store.set(env.active, false);
    if (action === '换艺人') env.store.set(env.artist, 'New');
    if (action === '停止') env.store.set(env.artist, null);
    if (action === '释放') env.service.dispose();
    const old = biographyLocalTracks('Queen');
    held.respond(0, {
      success: true,
      artist: 'Queen',
      tracks: old,
      items: old,
      count: 3,
      total: 3,
    });
    await tick();
    expect(env.state().summary).toBeNull();
    if (action === '换艺人') {
      expect(env.state().artist).toBe('New');
      held.respond(0);
      await tick();
      expect(env.state().summary?.tracks).toBe(3);
    }
    held.release();
  });

  it('库事件合并读取，刷新失败保留摘要，重试成功后清除失败', async () => {
    const env = setup();
    await env.service.ready;
    await tick();
    env.host.answer('library.getArtistTracks', hostFailure('OPERATION_FAILED'));
    env.host.emit('library:itemsModified', { count: 1, timestamp: Date.now() });
    env.host.emit('library:itemsAdded', { count: 1, timestamp: Date.now() });
    await vi.advanceTimersByTimeAsync(999);
    expect(env.state().failed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(env.state()).toMatchObject({ failed: true, loading: false, summary: { tracks: 3 } });
    const tracks = biographyLocalTracks().slice(0, 1);
    env.host.answer('library.getArtistTracks', {
      success: true,
      artist: 'Queen',
      tracks,
      items: tracks,
      count: 1,
      total: 1,
    });
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({ failed: false, summary: { tracks: 1, collaborators: [] } });
  });

  it('隐藏时库变更只作废摘要，回来才重新读；释放摘掉库订阅', async () => {
    const env = setup();
    await env.service.ready;
    await tick();
    env.store.set(env.active, false);
    env.host.emit('library:itemsRemoved', { count: 1, timestamp: Date.now() });
    await vi.advanceTimersByTimeAsync(1001);
    expect(env.host.callsTo('library.getArtistTracks')).toHaveLength(1);
    env.store.set(env.active, true);
    await tick();
    expect(env.state().summary?.tracks).toBe(3);
    expect(env.host.callsTo('library.getArtistTracks')).toHaveLength(2);
    env.service.dispose();
    expect(env.host.listenerCount('library:itemsModified')).toBe(0);
  });

  it('到读取上限时明确标为截断，不把应答 total 当完整库总量', async () => {
    const env = setup();
    const tracks = Array.from({ length: BIOGRAPHY_LIBRARY_LIMIT }, (_, index) => ({
      ...makeTrack({
        path: `file://E:/Music/${index}.flac`,
        artist: 'Queen',
        albumArtist: 'Queen',
      }),
      index,
    }));
    env.host.answer('library.getArtistTracks', {
      success: true,
      artist: 'Queen',
      tracks,
      items: tracks,
      count: tracks.length,
      total: tracks.length,
    });
    await env.service.ready;
    await tick();
    expect(env.state()).toMatchObject({
      truncated: true,
      summary: { tracks: BIOGRAPHY_LIBRARY_LIMIT },
    });
  });
});
