import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  createPlaylistActions,
  MAIN_COMMANDS,
  playlistActionFailureAtom,
  uniqueName,
} from '../../../src/playlist/playlistActions.ts';
import { LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import type {
  PlaybackSourceService,
  RecordedSource,
} from '../../../src/playback/playbackSource.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';
import { installFakeQueue, queueTracks } from '../../fixtures/fakeQueue.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function start(host: UnitHost, source: Pick<PlaybackSourceService, 'record'> | null = null) {
  const fake = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Default', { isActive: true }),
      makePlaylist(1, 'New Playlist'),
      makePlaylist(2, 'Locked', { isLocked: true }),
      makePlaylist(3, 'Smart', { isAutoplaylist: true, isLocked: true }),
      makePlaylist(4, 'Empty', { trackCount: 0 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  await playlists.ready;
  const places = { open: vi.fn((guid: string) => void playlists.activate(guid)) };
  const actions = createPlaylistActions(store, places, playlists, host.fb, source);
  return { fake, store, places, actions, failure: () => store.get(playlistActionFailureAtom) };
}

/** 宿主自己建的两张夹在中间，清单里的位置与宿主序号错开：A、B、C 的序号是 1、3、4。 */
async function startWithHostLists(host: UnitHost) {
  const fake = new FakePlaylists(
    host,
    [
      makePlaylist(0, '[WebView Queue]'),
      makePlaylist(1, 'A', { isActive: true }),
      makePlaylist(2, '__webview_buffer__', { isLocked: true }),
      makePlaylist(3, 'B'),
      makePlaylist(4, 'C'),
    ],
    (event, payload) => host.emit(event, payload),
  );
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  await playlists.ready;
  const actions = createPlaylistActions(store, { open: vi.fn() }, playlists, host.fb);
  return { fake, actions };
}

describe('uniqueName', () => {
  it('重名就加序号，直到不重', () => {
    expect(uniqueName('New Playlist', ['Default'])).toBe('New Playlist');
    expect(uniqueName('New Playlist', ['New Playlist', 'New Playlist (2)'])).toBe(
      'New Playlist (3)',
    );
  });
});

describe('createPlaylistActions', () => {
  it('名字留空就按缺省名建一张，经地点去它那里（切成活动列表），答新列表的 GUID', async () => {
    const host = installFakeHost();
    const { fake, places, actions } = await start(host);
    expect(actions.newName()).toBe('New Playlist (2)');
    const guid = await actions.create(' ');
    expect(host.callsTo('playlist.create')).toEqual([{ name: 'New Playlist (2)' }]);
    expect(guid).toBe(fake.guid('New Playlist (2)'));
    expect(places.open).toHaveBeenCalledWith(guid);
    await settle();
    expect(fake.activeGuid()).toBe(guid);
  });

  it('按给的名字建，去掉两端空白', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    const guid = await actions.create('  Morning ');
    expect(host.callsTo('playlist.create')).toEqual([{ name: 'Morning' }]);
    expect(guid).toBe(fake.guid('Morning'));
  });

  it('连点两下新建只建一张：上一次还没回来时不接', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    const held = host.hold('playlist.create');
    const first = actions.create('');
    const second = actions.create('');
    await settle();
    expect(await second).toBeNull();
    held.release();
    expect(await first).not.toBeNull();
    expect(fake.names().filter((name) => name.startsWith('New Playlist'))).toHaveLength(2);
    expect(host.callsTo('playlist.create')).toHaveLength(1);
  });

  it('宿主答了、清单还没读回时再点也不接：按旧清单起的名字会重名', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    const reads = host.hold('playlist.getAll');
    const first = actions.create('');
    await settle();
    expect(host.callsTo('playlist.create')).toHaveLength(1);
    expect(await actions.create('')).toBeNull();
    reads.release();
    expect(await first).toBe(fake.guid('New Playlist (2)'));
    expect(host.callsTo('playlist.create')).toHaveLength(1);
  });

  it('新建后读清单失败：照样去了它的地点，但答 null', async () => {
    const host = installFakeHost();
    const { places, actions } = await start(host);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    expect(await actions.create('')).toBeNull();
    expect(places.open).toHaveBeenCalledTimes(1);
  });

  it('按 GUID 发：菜单开着时前面删了一张，改名改的仍是原来那张', async () => {
    const host = installFakeHost();
    const { fake, actions, failure } = await start(host);
    const target = fake.guid('Empty');
    await host.fb.playlist.remove(guidOf(1));
    await settle();
    expect(await actions.rename(target, ' Renamed ')).toBe(true);
    expect(host.callsTo('playlist.rename')).toEqual([{ playlistGuid: target, name: 'Renamed' }]);
    expect(fake.names()).toEqual(['Default', 'Locked', 'Smart', 'Renamed']);
    expect(failure()).toBeNull();
  });

  it('GUID 认不回来（那张被删了）就不发，记一笔失败', async () => {
    const host = installFakeHost();
    const { actions, failure } = await start(host);
    await host.fb.playlist.remove(guidOf(4));
    await settle();
    expect(await actions.remove(guidOf(4))).toBe(false);
    expect(await actions.rename(guidOf(4), 'Again')).toBe(false);
    expect(host.callsTo('playlist.remove')).toEqual([{ playlistGuid: guidOf(4) }]);
    expect(host.callsTo('playlist.rename')).toEqual([]);
    expect(failure()).toBe('command');
  });

  it('删掉活动列表：宿主删完不切换，读回后切到落在同一位的那张；删别的不切', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    expect(await actions.remove(guidOf(1))).toBe(true);
    expect(host.callsTo('playlist.setActive')).toEqual([]);
    expect(await actions.remove(guidOf(0))).toBe(true);
    await settle();
    expect(host.callsTo('playlist.setActive')).toEqual([{ playlistGuid: guidOf(2) }]);
    expect(fake.activeGuid()).toBe(guidOf(2));
  });

  it('删掉的活动列表是最后一张：切到新的最后一张', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    await host.fb.playlist.setActive(guidOf(4));
    await settle();
    expect(await actions.remove(guidOf(4))).toBe(true);
    await settle();
    expect(fake.activeGuid()).toBe(guidOf(3));
  });

  it('改名去掉两端空白；空名与没改都不发，也不算失败', async () => {
    const host = installFakeHost();
    const { actions, failure } = await start(host);
    expect(await actions.rename(guidOf(0), '  ')).toBe(false);
    expect(await actions.rename(guidOf(0), ' Default ')).toBe(false);
    expect(host.callsTo('playlist.rename')).toEqual([]);
    expect(failure()).toBeNull();
  });

  it('清空按锁挡掉；改名不看锁；只有智能列表能转成普通列表', async () => {
    const host = installFakeHost();
    const { actions } = await start(host);
    expect(await actions.clear(guidOf(2))).toBe(false);
    expect(await actions.clear(guidOf(3))).toBe(false);
    expect(host.callsTo('playlist.clear')).toEqual([]);
    expect(await actions.rename(guidOf(2), 'Still locked')).toBe(true);
    expect(await actions.convertToPlain(guidOf(0))).toBe(false);
    expect(await actions.convertToPlain(guidOf(3))).toBe(true);
    expect(host.callsTo('playlist.removeAutoplaylist')).toEqual([{ playlistGuid: guidOf(3) }]);
  });

  it('别的组件管的智能列表：宿主答成功却什么都没改（source 为 dui），记一笔 convert', async () => {
    const host = installFakeHost();
    const { actions, failure } = await start(host);
    host.answer('playlist.removeAutoplaylist', {
      playlistGuid: guidOf(3),
      success: true,
      playlist: 3,
      source: 'dui',
      note: 'managed by another component',
    });
    expect(await actions.convertToPlain(guidOf(3))).toBe(false);
    expect(failure()).toBe('convert');
  });

  it('去重、去无效、保存只作用于活动列表：别的列表上不发，也不替用户切过去', async () => {
    const host = installFakeHost();
    const { actions } = await start(host);
    expect(await actions.removeDuplicates(guidOf(1))).toBe(false);
    expect(await actions.savePlaylist(guidOf(1))).toBe(false);
    expect(host.callsTo('menu.runMainMenuCommand')).toEqual([]);
    expect(host.callsTo('playlist.setActive')).toEqual([]);
    expect(await actions.removeDuplicates(guidOf(0))).toBe(true);
    expect(await actions.removeDeadEntries(guidOf(0))).toBe(true);
    expect(await actions.savePlaylist(guidOf(0))).toBe(true);
    expect(await actions.loadPlaylist()).toBe(true);
    expect(host.callsTo('menu.runMainMenuCommand').map((params) => params['command'])).toEqual([
      MAIN_COMMANDS.removeDuplicates,
      MAIN_COMMANDS.removeDeadEntries,
      MAIN_COMMANDS.savePlaylist,
      MAIN_COMMANDS.loadPlaylist,
    ]);
  });

  it('重排按此刻的完整清单算排列、一次发出；落在原位不发', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    expect(await actions.reorder(guidOf(1), 1)).toBe(false);
    expect(host.callsTo('playlist.reorderPlaylists')).toEqual([]);
    expect(await actions.reorder(guidOf(0), 3)).toBe(true);
    expect(host.callsTo('playlist.reorderPlaylists')).toEqual([{ newOrder: [1, 2, 0, 3, 4] }]);
    expect(fake.names()).toEqual(['New Playlist', 'Locked', 'Default', 'Smart', 'Empty']);
  });

  it('重排按清单里的位置算，发出的排列含宿主自己建的那几张，它们留在原序号上', async () => {
    const host = installFakeHost();
    const { fake, actions } = await startWithHostLists(host);
    expect(await actions.reorder(guidOf(4), 0)).toBe(true);
    expect(host.callsTo('playlist.reorderPlaylists')).toEqual([{ newOrder: [0, 4, 2, 1, 3] }]);
    expect(fake.names()).toEqual(['[WebView Queue]', 'C', '__webview_buffer__', 'A', 'B']);
  });

  it('删掉活动列表后按清单里的位置切到下一张，不按宿主序号', async () => {
    const host = installFakeHost();
    const { fake, actions } = await startWithHostLists(host);
    expect(await actions.remove(guidOf(1))).toBe(true);
    await settle();
    expect(fake.activeGuid()).toBe(guidOf(3));
  });

  it('上一次重排的结果读回之前不接下一次：连按两下，第二下不按旧清单算错位', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    const held = host.hold('playlist.getAll');
    const first = actions.reorder(guidOf(0), 2);
    await settle();
    expect(await actions.reorder(guidOf(0), 3)).toBe(false);
    held.release();
    expect(await first).toBe(true);
    expect(host.callsTo('playlist.reorderPlaylists')).toEqual([{ newOrder: [1, 0, 2, 3, 4] }]);
    // 读回之后再挪一位，按新清单算：Default 此刻在第 1 位。
    expect(await actions.reorder(guidOf(0), 3)).toBe(true);
    expect(fake.names()).toEqual(['New Playlist', 'Locked', 'Default', 'Smart', 'Empty']);
  });

  it('重排后读清单失败：下一次读回成功之前不接重排，读回之后按新清单算', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    host.answer('playlist.getAll', hostFailure('INTERNAL_ERROR'));
    expect(await actions.reorder(guidOf(0), 2)).toBe(true);
    expect(fake.names()).toEqual(['New Playlist', 'Default', 'Locked', 'Smart', 'Empty']);
    expect(await actions.reorder(guidOf(0), 3)).toBe(false);
    expect(host.callsTo('playlist.reorderPlaylists')).toHaveLength(1);

    host.answer('playlist.getAll', () => ({
      success: true,
      playlists: fake.items.map((item) => ({ ...item })),
      count: fake.items.length,
    }));
    host.emit('playlist:lockChanged', { playlistGuid: guidOf(2), playlist: 2, locked: true });
    await settle();
    expect(await actions.reorder(guidOf(0), 3)).toBe(true);
    expect(fake.names()).toEqual(['New Playlist', 'Locked', 'Default', 'Smart', 'Empty']);
  });

  it('播放经地点去那张、再从第一首放；空列表不发', async () => {
    const host = installFakeHost();
    const { places, actions } = await start(host);
    expect(await actions.play(guidOf(4))).toBe(false);
    expect(await actions.play(guidOf(1))).toBe(true);
    expect(places.open).toHaveBeenCalledWith(guidOf(1));
    expect(host.callsTo('playlist.playTrack')).toEqual([{ playlistGuid: guidOf(1), index: 0 }]);
    const calls = host.calls.map((call) => call.method);
    expect(calls.indexOf('playlist.setActive')).toBeLessThan(calls.indexOf('playlist.playTrack'));
  });

  it('播放列表起播保留手动队列并记录新来源', async () => {
    const host = installFakeHost();
    const record = vi.fn();
    const { actions } = await start(host, { record });
    const queue = installFakeQueue(host, queueTracks('queued-a', 'queued-b'));
    expect(await actions.play(guidOf(1), 1)).toBe(true);
    expect(queue.titles()).toEqual(['queued-a', 'queued-b']);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
    expect(record).toHaveBeenCalledWith({
      kind: 'playlist',
      subject: guidOf(1),
      name: 'New Playlist',
    });
  });

  it('播放可以从指定的一行起；没有那一行不发', async () => {
    const host = installFakeHost();
    const { fake, actions } = await start(host);
    const target = fake.items[1];
    if (!target) throw new Error('清单里没有第二张');
    expect(await actions.play(target.guid, target.trackCount)).toBe(false);
    expect(await actions.play(target.guid, target.trackCount - 1)).toBe(true);
    expect(host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: target.guid, index: target.trackCount - 1 },
    ]);
  });

  it('宿主收下播放后把这张记成播放来源；空列表、专用列表与被拒的不记', async () => {
    const host = installFakeHost();
    const record = vi.fn<(source: RecordedSource) => void>();
    const { fake, actions } = await start(host, { record });
    expect(await actions.play(guidOf(1))).toBe(true);
    expect(record.mock.calls).toEqual([
      [{ kind: 'playlist', subject: guidOf(1), name: 'New Playlist' }],
    ]);
    fake.items = [...fake.items, makePlaylist(5, LIBRARY_VIEW_PLAYLIST)];
    host.emit('playlist:created', { guid: guidOf(5), index: 5, name: LIBRARY_VIEW_PLAYLIST });
    await settle();
    expect(await actions.play(guidOf(5))).toBe(true);
    expect(await actions.play(guidOf(4))).toBe(false);
    host.answer('playlist.playTrack', hostFailure('NOT_FOUND'));
    expect(await actions.play(guidOf(0))).toBe(false);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('清单里记的活动列表过期了（宿主那边已切走、事件还没到）：去重、去无效、保存都不发，记一笔失败', async () => {
    const host = installFakeHost();
    const { fake, actions, failure } = await start(host);
    // 宿主那边悄悄切到了 New Playlist，清单还没读回，这边仍以为 Default 是活动的。
    fake.items = fake.items.map((item) => ({ ...item, isActive: item.index === 1 }));
    expect(await actions.removeDuplicates(guidOf(0))).toBe(false);
    expect(await actions.removeDeadEntries(guidOf(0))).toBe(false);
    expect(await actions.savePlaylist(guidOf(0))).toBe(false);
    expect(host.callsTo('menu.runMainMenuCommand')).toEqual([]);
    expect(failure()).toBe('command');
  });

  it('载入、保存的对话框开太久、调用超时 reject：不知道成没成，不记失败；答了失败才记', async () => {
    const host = installFakeHost();
    const { actions, failure } = await start(host);
    host.answer('menu.runMainMenuCommand', () => {
      throw new Error('调用超时');
    });
    expect(await actions.loadPlaylist()).toBe(false);
    expect(await actions.saveAllPlaylists()).toBe(false);
    expect(await actions.savePlaylist(guidOf(0))).toBe(false);
    expect(failure()).toBeNull();
    host.answer('menu.runMainMenuCommand', hostFailure('NOT_FOUND'));
    expect(await actions.savePlaylist(guidOf(0))).toBe(false);
    expect(failure()).toBe('command');
  });

  it('宿主答失败记一笔，可以关掉', async () => {
    const host = installFakeHost();
    const { actions, failure } = await start(host);
    host.answer('playlist.duplicate', hostFailure('NOT_FOUND'));
    expect(await actions.duplicate(guidOf(1))).toBe(false);
    expect(failure()).toBe('command');
    actions.dismissFailure();
    expect(failure()).toBeNull();
  });

  it('失败的一笔在之后一次动作成功时清掉', async () => {
    const host = installFakeHost();
    const { actions, failure } = await start(host);
    const duplicate = host.hold('playlist.duplicate');
    const failing = actions.duplicate(guidOf(1));
    await settle();
    duplicate.respond(0, hostFailure('NOT_FOUND'));
    expect(await failing).toBe(false);
    expect(failure()).toBe('command');
    duplicate.release();
    expect(await actions.rename(guidOf(1), 'Renamed')).toBe(true);
    expect(failure()).toBeNull();
  });

  it('没连上宿主时什么都不发', async () => {
    const host = installFakeHost({ available: false });
    const store = createStore();
    const playlists = startPlaylists(store, host.fb);
    const actions = createPlaylistActions(store, { open: vi.fn() }, playlists, host.fb);
    expect(await actions.create('')).toBeNull();
    expect(await actions.loadPlaylist()).toBe(false);
    expect(host.calls).toEqual([]);
  });
});
