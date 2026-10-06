import { guidOf } from '../fixtures/fakePlaylists.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_VERSION, hostFailure } from '../fixtures/hostAnswers.ts';
import { installFakeHost, UnitHost } from '../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('UnitHost：调用经真实的 SDK 到达替身', () => {
  it('fb 的命名空间方法按 SDK 包装拼参数', async () => {
    const host = installFakeHost();
    await expect(host.fb.config.getVersionInfo()).resolves.toMatchObject({
      plugin: { version: HOST_VERSION },
    });
    await host.fb.library.getAlbumTracks('Album', 'Artist');
    await host.fb.playlist.playTrack(2, 5);
    expect(host.callsTo('library.getAlbumTracks')).toEqual([
      { album: 'Album', albumArtist: 'Artist' },
    ]);
    expect(host.callsTo('playlist.playTrack')).toEqual([{ playlist: 2, index: 5 }]);
  });

  it('应答照 SDK 的规则交回：playlist.getAll 答信封，失败也是 resolve 的信封', async () => {
    const host = installFakeHost();
    const answer = await host.fb.playlist.getAll();
    expect(answer.success && answer.playlists.map((playlist) => playlist.name)).toEqual([
      'Default',
    ]);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR', 'no playlist manager'));
    await expect(host.fb.playlist.getAll()).resolves.toMatchObject({
      success: false,
      error: 'no playlist manager',
    });
  });

  it('调用方塞进参数的未声明键到了宿主这边被拒', async () => {
    const host = installFakeHost();
    const options = { limit: 10, sortBy: 'name' };
    await expect(host.fb.library.getAlbums(options)).resolves.toEqual({
      success: false,
      error: "unknown parameter 'sortBy'",
      code: 'INVALID_PARAMS',
    });
    const entry = { playlist: 0, item: 3, path: 'E:/a.flac' };
    await expect(host.fb.queue.insertNext([entry])).resolves.toMatchObject({
      code: 'INVALID_PARAMS',
      error: "unknown parameter 'items[0].path'",
    });
  });
});

describe('UnitHost：事件', () => {
  it('fb.on 订阅的监听器收到 emit 的载荷，取消订阅后不再收到', () => {
    const host = installFakeHost();
    const received: unknown[] = [];
    const off = host.fb.on('library:itemsAdded', (payload) => received.push(payload));
    expect(host.listenerCount('library:itemsAdded')).toBe(1);
    host.emit('library:itemsAdded', { count: 3, timestamp: 1 });
    off();
    host.emit('library:itemsAdded', { count: 4, timestamp: 2 });
    expect(received).toEqual([{ count: 3, timestamp: 1 }]);
    expect(host.listenerCount('library:itemsAdded')).toBe(0);
  });

  it('once 只收一次', () => {
    const host = installFakeHost();
    const received: number[] = [];
    host.fb.once('playlist:activated', (payload) => received.push(payload.newIndex));
    host.emit('playlist:activated', { newGuid: guidOf(1), oldIndex: 0, newIndex: 1 });
    host.emit('playlist:activated', { newGuid: guidOf(2), oldIndex: 1, newIndex: 2 });
    expect(received).toEqual([1]);
  });

  it('有监听器抛错时其余照收，推完再抛出', () => {
    const host = installFakeHost();
    const received: number[] = [];
    host.fb.on('playback:volumeChanged', () => {
      throw new Error('listener broke');
    });
    host.fb.on('playback:volumeChanged', (payload) => received.push(payload.volume));
    expect(() =>
      host.emit('playback:volumeChanged', {
        volume: 50,
        volumeDb: -6.02,
        muted: false,
        isMuted: false,
      }),
    ).toThrow(AggregateError);
    expect(received).toEqual([50]);
  });
});

describe('UnitHost：宿主到没到', () => {
  it('没到时 SDK 答 NOT_SUPPORTED 失败信封，订阅被丢掉；connect 之后调用才到替身', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    expect(host.fb.isAvailable()).toBe(false);
    const mocked = host.fb.config.getVersionInfo();
    await vi.advanceTimersByTimeAsync(100);
    await expect(mocked).resolves.toMatchObject({ success: false, code: 'NOT_SUPPORTED' });
    host.fb.on('library:itemsAdded', () => {});
    expect(host.calls).toEqual([]);

    let ready = false;
    void host.fb.ready().then(() => {
      ready = true;
    });
    host.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);
    expect(host.fb.isAvailable()).toBe(true);
    expect(host.listenerCount('library:itemsAdded')).toBe(0);
    await expect(host.fb.config.getVersionInfo()).resolves.toMatchObject({ success: true });
  });

  // 放在文件末尾：前面各测试用 installFakeHost 装的替身应当都已在测试结束时撤掉。
  it('测试结束时自动撤掉替身；dispose 把全局 window 还原', () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
    expect(before).toBeUndefined();
    const host = new UnitHost();
    expect(Reflect.get(globalThis, 'window')).toBeDefined();
    host.dispose();
    expect(Object.getOwnPropertyDescriptor(globalThis, 'window')).toEqual(before);
  });
});
