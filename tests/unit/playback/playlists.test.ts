import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COALESCE_MS, playlistsAtom, startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const LIST_EVENTS = [
  'playlist:created',
  'playlist:removed',
  'playlist:renamed',
  'playlist:reordered',
  'playlist:activated',
  'playlist:lockChanged',
] as const;
const COALESCED_EVENTS = [
  'playlist:itemsAdded',
  'playlist:itemsRemoved',
  'playlist:itemsReplaced',
  'playback:trackChanged',
  'playback:stopped',
] as const;

function lists(host: UnitHost) {
  return new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Default', { isActive: true }),
      makePlaylist(1, 'Chill', { isPlaying: true }),
      makePlaylist(2, 'Smart', { isAutoplaylist: true, isLocked: true }),
    ],
    (event, payload) => host.emit(event, payload),
  );
}

/** 把 getAll 换回按替身此刻的清单作答，测试里先让它失败过一次再恢复时用。 */
function answerFromFake(host: UnitHost, fake: FakePlaylists): void {
  host.answer('playlist.getAll', () => ({
    success: true,
    playlists: fake.items.map((item) => ({ ...item })),
    count: fake.items.length,
  }));
}

async function start(host: UnitHost) {
  const store = createStore();
  const service = startPlaylists(store, host.fb);
  await service.ready;
  await settle();
  return { store, service, state: () => store.get(playlistsAtom) };
}

describe('startPlaylists', () => {
  it('先订阅再初读；按序号排好，活动列表按宿主标的 isActive 认 GUID', async () => {
    const host = installFakeHost();
    lists(host);
    const subscribed: number[] = [];
    host.answer('playlist.getAll', () => {
      subscribed.push(host.listenerCount('playlist:activated'));
      return {
        success: true,
        playlists: [makePlaylist(1, 'B', { isActive: true }), makePlaylist(0, 'A')],
        count: 2,
      };
    });
    const { state } = await start(host);
    expect(subscribed).toEqual([1]);
    for (const event of [...LIST_EVENTS, ...COALESCED_EVENTS]) {
      expect(host.listenerCount(event)).toBe(1);
    }
    expect(state()).toMatchObject({ status: 'connected', activeGuid: guidOf(1), revision: 1 });
    expect(state().items.map((item) => item.name)).toEqual(['A', 'B']);
  });

  it('宿主自己建的两张不进清单，只记下序号；活动的是它们时没有活动列表', async () => {
    const host = installFakeHost();
    lists(host);
    host.answer('playlist.getAll', () => ({
      success: true,
      playlists: [
        makePlaylist(0, 'A'),
        makePlaylist(1, '__webview_buffer__', { isActive: true, isLocked: true }),
        makePlaylist(2, 'B'),
        makePlaylist(3, '[WebView Queue]'),
      ],
      count: 4,
    }));
    const { state } = await start(host);
    expect(state().items.map((item) => item.name)).toEqual(['A', 'B']);
    expect(state().hiddenIndices).toEqual([1, 3]);
    expect(state().activeGuid).toBeNull();
  });

  it('列表事件立即重读：改名、锁变了都带回新清单', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { state } = await start(host);
    await host.fb.playlist.rename(guidOf(0), 'Main');
    await settle();
    expect(state().items[0]?.name).toBe('Main');

    fake.items = fake.items.map((item) => (item.index === 1 ? { ...item, isLocked: true } : item));
    host.emit('playlist:lockChanged', { playlistGuid: guidOf(1), playlist: 1, locked: true });
    await settle();
    expect(state().items[1]?.isLocked).toBe(true);
  });

  it(`曲目数与正在播放按事件合并 ${COALESCE_MS} ms 重读一次`, async () => {
    const host = installFakeHost();
    lists(host);
    await start(host);
    vi.useFakeTimers();
    const reads = host.callsTo('playlist.getAll').length;
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(0), playlist: 0, start: 0, count: 3 });
    host.emit('playback:stopped', { reason: 'starting_another' });
    host.emit('playback:trackChanged', makeTrack());
    await vi.advanceTimersByTimeAsync(COALESCE_MS - 1);
    expect(host.callsTo('playlist.getAll').length).toBe(reads);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.callsTo('playlist.getAll').length).toBe(reads + 1);
  });

  it('换曲后正在播放的那张按 getPlaying 认：getAll 的缓存没随换曲失效，不信它的 isPlaying', async () => {
    const host = installFakeHost();
    lists(host);
    const { state } = await start(host);
    expect(state().items.map((item) => item.isPlaying)).toEqual([false, true, false]);
    vi.useFakeTimers();
    await host.fb.playlist.playTrack(guidOf(2), 0);
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(state().items.map((item) => item.isPlaying)).toEqual([false, false, true]);
  });

  it('晚到的旧应答丢掉：只认最后一次读', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { state } = await start(host);
    const held = host.hold('playlist.getAll');
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'Old' });
    await settle();
    fake.items = fake.items.map((item) => (item.index === 0 ? { ...item, name: 'New' } : item));
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'New' });
    await settle();
    held.respond(1);
    await settle();
    held.respond(0, {
      success: true,
      playlists: [makePlaylist(0, 'Stale', { isActive: true })],
      count: 1,
    });
    await settle();
    expect(state().items[0]?.name).toBe('New');
    held.release();
  });

  it('读失败记一笔、清单不动；下一次读成功清掉失败', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { state } = await start(host);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    host.emit('playlist:created', { guid: guidOf(3), index: 3, name: 'New' });
    await settle();
    expect(state()).toMatchObject({ readFailed: true, revision: 1 });
    expect(state().items).toHaveLength(3);
    answerFromFake(host, fake);
    host.emit('playlist:created', { guid: guidOf(3), index: 3, name: 'New' });
    await settle();
    expect(state()).toMatchObject({ readFailed: false, revision: 2 });
  });

  it('切换被拒之后读清单失败：两种失败各记各的，读成功只收起读失败', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { service, state } = await start(host);
    host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
    expect(await service.activate(guidOf(1))).toBe(false);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'Default' });
    await settle();
    expect(state()).toMatchObject({ readFailed: true, activateFailed: true });
    answerFromFake(host, fake);
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'Default' });
    await settle();
    expect(state()).toMatchObject({ readFailed: false, activateFailed: true });
    expect(service.requestedTarget()).toBe(guidOf(1));
    service.dismissFailure('activate');
    expect(state().activateFailed).toBe(false);
  });

  it('切换活动列表按 GUID 发，不乐观更新：等 activated 带回清单；已是活动的不发', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { service, state } = await start(host);
    expect(await service.activate(guidOf(0))).toBe(true);
    expect(host.callsTo('playlist.setActive')).toEqual([]);
    const held = host.hold('playlist.setActive');
    const activating = service.activate(guidOf(2));
    await settle();
    expect(held.pending).toEqual([{ playlistGuid: guidOf(2) }]);
    expect(state().activeGuid).toBe(guidOf(0));
    held.release();
    await activating;
    await settle();
    expect(fake.activeGuid()).toBe(guidOf(2));
    expect(state().activeGuid).toBe(guidOf(2));
  });

  it('「已是活动的」比的是最近一次请求：点了 B 还没回、再点回 A，A 照样发出去', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { service, state } = await start(host);
    const held = host.hold('playlist.setActive');
    const toB = service.activate(guidOf(1));
    const again = service.activate(guidOf(1));
    const backToA = service.activate(guidOf(0));
    await settle();
    expect(held.pending).toEqual([{ playlistGuid: guidOf(1) }, { playlistGuid: guidOf(0) }]);
    held.release();
    await Promise.all([toB, again, backToA]);
    await settle();
    expect(fake.activeGuid()).toBe(guidOf(0));
    expect(state().activeGuid).toBe(guidOf(0));
  });

  it('旧请求的失败不报：点了 B 还没回、又点了 C，B 被拒不出提示', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { service, state } = await start(host);
    const held = host.hold('playlist.setActive');
    const toB = service.activate(guidOf(1));
    const toC = service.activate(guidOf(2));
    await settle();
    // 宿主按先后作答：B 的拒绝先到，那时 C 已经发出。
    held.respond(0, hostFailure('NOT_FOUND'));
    expect(await toB).toBe(false);
    held.respond(0);
    expect(await toC).toBe(true);
    await settle();
    expect(fake.activeGuid()).toBe(guidOf(2));
    expect(state()).toMatchObject({ activeGuid: guidOf(2), activateFailed: false });
    held.release();
  });

  it('宿主拒了切换记一笔 activate；之后再点同一张照样发', async () => {
    const host = installFakeHost();
    lists(host);
    const { service, state } = await start(host);
    host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
    expect(await service.activate(guidOf(1))).toBe(false);
    expect(state()).toMatchObject({ activeGuid: guidOf(0), activateFailed: true });
    service.dismissFailure();
    expect(await service.activate(guidOf(1))).toBe(false);
    expect(host.callsTo('playlist.setActive')).toHaveLength(2);
  });

  it('切换失败的提示在之后一次切换成功时收起', async () => {
    const host = installFakeHost();
    lists(host);
    const { service, state } = await start(host);
    const rejected = host.hold('playlist.setActive');
    const toB = service.activate(guidOf(1));
    await settle();
    rejected.respond(0, hostFailure('NOT_FOUND'));
    expect(await toB).toBe(false);
    expect(state().activateFailed).toBe(true);
    rejected.release();
    expect(await service.activate(guidOf(2))).toBe(true);
    await settle();
    expect(state()).toMatchObject({ activeGuid: guidOf(2), activateFailed: false });
  });

  it('切换被拒后点回本来就活动的那张：不发，但算切换成功，提示照样收起', async () => {
    const host = installFakeHost();
    lists(host);
    const { service, state } = await start(host);
    host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
    expect(await service.activate(guidOf(1))).toBe(false);
    expect(state().activateFailed).toBe(true);
    expect(await service.activate(guidOf(0))).toBe(true);
    expect(host.callsTo('playlist.setActive')).toHaveLength(1);
    expect(state().activateFailed).toBe(false);
  });

  it('refresh 兑现时最新的一次读已经读回来：被更新的一次顶掉时接着等那一次', async () => {
    const host = installFakeHost();
    const fake = lists(host);
    const { service, state } = await start(host);
    const held = host.hold('playlist.getAll');
    const refreshing = service.refresh();
    fake.items = fake.items.map((item) => (item.index === 0 ? { ...item, name: 'Later' } : item));
    host.emit('playlist:renamed', { guid: guidOf(0), index: 0, name: 'Later' });
    await settle();
    let done = false;
    void refreshing.then(() => {
      done = true;
    });
    held.respond(0);
    await settle();
    expect(done).toBe(false);
    held.respond(0);
    await refreshing;
    expect(state().items[0]?.name).toBe('Later');
    held.release();
  });

  it('释放后事件都摘干净，定时器不再读', async () => {
    const host = installFakeHost();
    lists(host);
    const { service } = await start(host);
    vi.useFakeTimers();
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(0), playlist: 0, start: 0, count: 1 });
    const reads = host.callsTo('playlist.getAll').length;
    service.dispose();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(host.callsTo('playlist.getAll').length).toBe(reads);
    for (const event of [...LIST_EVENTS, ...COALESCED_EVENTS]) {
      expect(host.listenerCount(event)).toBe(0);
    }
  });
});
