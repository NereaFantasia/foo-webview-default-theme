import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { exclusive, LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import { onlineAddress } from '../../../src/server/onlineAddress.ts';
import { qualitySwitchAtom, startOnlinePlayback } from '../../../src/playback/onlinePlayback.ts';
import type { MusicQuality } from '../../../src/server/musicObjects.ts';
import { listParam, numberParam } from '../../fixtures/hostAnswers.ts';
import { playlistRow } from '../../fixtures/libraryRows.ts';
import { installFakeQueue } from '../../fixtures/fakeQueue.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

/** 第 `id` 首网易云曲目在 `port` 上的占位地址。 */
function url(port: number, id: string, quality: MusicQuality = '320k'): string {
  const address = onlineAddress(port, { platform: 'wy', id }, quality);
  if (!address) throw new Error('ID 放不进地址');
  return address;
}

const local = (name: string) => makeTrack({ path: `file://E:/Music/${name}.flac`, title: name });
const online = (port: number, id: string, quality?: MusicQuality) =>
  makeTrack({ path: url(port, id, quality), title: id });

/** 播放服务的停住：记下每次停在哪、结束时是否已跳回（还没结束时没有 `resumed`）。 */
function fakeHolds() {
  const holds: { position: number; resumed?: boolean }[] = [];
  const playback = {
    holdPosition(position: number) {
      const hold: { position: number; resumed?: boolean } = { position };
      holds.push(hold);
      return (resumed: boolean) => {
        hold.resumed = resumed;
      };
    },
  };
  return { holds, playback };
}

function setup(host: UnitHost, port: number | null = 2) {
  const store = createStore();
  const portAtom = atom<number | null>(port);
  const { holds, playback } = fakeHolds();
  const service = startOnlinePlayback(store, portAtom, playback, host.fb);
  onTestFinished(() => service.dispose());
  return { store, portAtom, service, holds };
}

function stopped(host: UnitHost) {
  host.answer('playback.getState', {
    success: true,
    state: 'stopped',
    canSeek: false,
    canPause: false,
  });
  host.answer('playlist.getAll', { success: true, playlists: [], count: 0 });
  cursor(host, null);
}

/** fb2k 的续播游标：专用列表（序号 4）的第 `row` 行；null 是读不到位置。 */
function cursor(host: UnitHost, row: number | null) {
  host.answer(
    'playback.getCurrentTrackIndex',
    row === null
      ? { success: true, found: false, playlist: null, playlistGuid: null, index: null }
      : {
          success: true,
          found: true,
          playlist: 4,
          playlistGuid: playlistRow(4, LIBRARY_VIEW_PLAYLIST).guid,
          index: row,
        },
  );
}

/** 装一张会变的专用列表，按宿主的规则答读行、删行与插行。 */
function installLibraryView(host: UnitHost, initial: readonly string[]) {
  const rows = [...initial];
  const view = () => playlistRow(4, LIBRARY_VIEW_PLAYLIST, { trackCount: rows.length });
  host.answer('playlist.getAll', () => ({ success: true, playlists: [view()], count: 1 }));
  host.answer('playlist.getTracks', (params) => {
    const count = numberParam(params, 'count') ?? 100;
    const tracks = rows.slice(0, count).map((path, index) => ({ index, path }));
    return {
      success: true,
      playlist: 4,
      playlistGuid: view().guid,
      start: 0,
      count: tracks.length,
      total: rows.length,
      tracks,
    };
  });
  host.answer('playlist.removeTracks', (params) => {
    const gone = new Set(listParam(params, 'items'));
    const kept = rows.filter((_, index) => !gone.has(index));
    rows.splice(0, rows.length, ...kept);
    return { success: true, contentVersion: '1' };
  });
  host.answer('playlist.insertTracks', (params) => {
    const handles = listParam(params, 'handles').map(String);
    const position = numberParam(params, 'position') ?? rows.length;
    const countBefore = rows.length;
    rows.splice(position, 0, ...handles);
    return {
      success: true,
      playlist: 4,
      playlistGuid: view().guid,
      insertIndex: position,
      requestedCount: handles.length,
      addedCount: handles.length,
      invalidCount: 0,
      countBefore,
      totalCount: rows.length,
      contentVersion: '1',
    };
  });
  return rows;
}

function playingOnline(host: UnitHost, path: string, position: number) {
  host.answer('playback.getState', {
    success: true,
    state: 'playing',
    canSeek: true,
    canPause: true,
  });
  host.answer('playback.getCurrentTrack', {
    success: true,
    found: true,
    track: makeTrack({ path }),
  });
  host.answer('playback.getPosition', {
    success: true,
    position,
    duration: 200,
    subsong: 0,
    path,
    hostTime: Date.now(),
  });
}

const STATE = { state: 'playing', position: 0, duration: 200, hostTime: 0 } as const;

describe('后端换端口后改写在线曲目', () => {
  it('队列里旧端口的在线条目按段改到新端口，本地条目与新端口的条目不动，顺序不变', async () => {
    const host = installFakeHost();
    stopped(host);
    const before = [online(1, '1'), local('a'), online(1, '2'), online(1, '3', 'flac')];
    const after = [online(2, '1'), local('a'), online(2, '2'), online(2, '3', 'flac')];
    const queue = installFakeQueue(host, [...before, local('b'), online(2, '4')], after);
    setup(host);
    await vi.waitFor(() =>
      expect(queue.items.map((item) => item.track.path)).toEqual([
        ...after.map((track) => track.path),
        local('b').path,
        url(2, '4'),
      ]),
    );
    expect(host.callsTo('queue.remove').map((params) => params['indices'])).toEqual([[2, 3], [0]]);
  });

  it('改写途中换了曲、队首出了队，按新的队列重读，不删错位置', async () => {
    const host = installFakeHost();
    stopped(host);
    const queue = installFakeQueue(host, [local('a'), online(1, '1')], [online(2, '1')]);
    let first = true;
    // 第一次读到的是出队前的队列，应答回来之前队首已经出队。
    host.answer('queue.get', () => {
      const items = queue.items.map((item, queueIndex) => ({
        ...item.track,
        queueIndex,
        playlist: null,
        playlistGuid: null,
        playlistItem: null,
      }));
      if (first) {
        first = false;
        queue.advance();
      }
      return { success: true, items, count: items.length, contentVersion: '1' };
    });
    setup(host);
    await vi.waitFor(() =>
      expect(queue.items.map((item) => item.track.path)).toEqual([url(2, '1')]),
    );
    expect(host.callsTo('queue.remove').map((params) => params['indices'])).toEqual([[0]]);
  });

  it('专用列表同样按段改写；列表正忙时稍后再试', async () => {
    const host = installFakeHost();
    stopped(host);
    installFakeQueue(host);
    const rows = installLibraryView(host, [
      url(1, '1'),
      url(1, '2'),
      'file://E:/a.flac',
      url(1, '3'),
    ]);
    const store = createStore();
    let release: (value: boolean) => void = () => {};
    void exclusive(store, () => new Promise<boolean>((resolve) => (release = resolve)));
    const service = startOnlinePlayback(
      store,
      atom<number | null>(2),
      fakeHolds().playback,
      host.fb,
    );
    onTestFinished(() => service.dispose());
    await vi.waitFor(() => expect(host.callsTo('queue.get').length).toBeGreaterThan(0));
    expect(host.callsTo('playlist.getTracks')).toEqual([]);
    release(true);
    await vi.waitFor(
      () => expect(rows).toEqual([url(2, '1'), url(2, '2'), 'file://E:/a.flac', url(2, '3')]),
      { timeout: 3000 },
    );
    expect(host.callsTo('playlist.getTracks')[0]?.['count']).toBe(4);
  });

  it('游标所在的那一行先不改，前后的行照改；游标移走后换曲时补改那一行', async () => {
    const host = installFakeHost();
    stopped(host);
    playingOnline(host, url(1, '2'), 42);
    host.answer('playback.getState', {
      success: true,
      state: 'paused',
      canSeek: true,
      canPause: true,
    });
    cursor(host, 1);
    installFakeQueue(host);
    const rows = installLibraryView(host, [url(1, '1'), url(1, '2'), url(1, '3')]);
    setup(host);
    await vi.waitFor(() => expect(rows).toEqual([url(2, '1'), url(1, '2'), url(2, '3')]));
    expect(host.callsTo('queue.insertNext')).toEqual([]);
    cursor(host, 2);
    host.emit('playback:trackChanged', online(2, '3'));
    await vi.waitFor(() => expect(rows).toEqual([url(2, '1'), url(2, '2'), url(2, '3')]));
    expect(host.callsTo('playlist.removeTracks').map((params) => params['items'])).toEqual([
      [2],
      [0],
      [1],
    ]);
  });

  it('正在播按路径入队的条目、读不到游标时整张列表先不改，换曲读到游标后再改', async () => {
    const host = installFakeHost();
    stopped(host);
    playingOnline(host, url(2, '9'), 10);
    cursor(host, null);
    installFakeQueue(host);
    const rows = installLibraryView(host, [url(1, '1'), url(1, '2')]);
    setup(host);
    await vi.waitFor(() => expect(host.callsTo('playback.getCurrentTrackIndex').length).toBe(1));
    expect(rows).toEqual([url(1, '1'), url(1, '2')]);
    cursor(host, 0);
    host.emit('playback:trackChanged', online(1, '1'));
    await vi.waitFor(() => expect(rows).toEqual([url(1, '1'), url(2, '2')]));
  });

  it('播放中的旧端口在线曲目用新端口从当前位置接着播；暂停时不动', async () => {
    const host = installFakeHost();
    stopped(host);
    playingOnline(host, url(1, '7'), 42);
    installFakeQueue(host, [], [online(2, '7')]);
    const { holds } = setup(host);
    await vi.waitFor(() => expect(host.callsTo('queue.playNow')).toHaveLength(1));
    expect(host.callsTo('queue.insertNext')[0]).toEqual({ paths: [url(2, '7')], position: 0 });
    expect(holds).toEqual([{ position: 42 }]);
    host.emit('playback:stateChanged', { ...STATE, canSeek: true });
    await vi.waitFor(() =>
      expect(host.callsTo('playback.setPosition')).toEqual([{ position: 42 }]),
    );
    await vi.waitFor(() => expect(holds).toEqual([{ position: 42, resumed: true }]));

    const paused = installFakeHost();
    stopped(paused);
    playingOnline(paused, url(1, '7'), 42);
    paused.answer('playback.getState', {
      success: true,
      state: 'paused',
      canSeek: true,
      canPause: true,
    });
    installFakeQueue(paused);
    setup(paused);
    await vi.waitFor(() => expect(paused.callsTo('queue.get').length).toBeGreaterThan(0));
    expect(paused.callsTo('queue.insertNext')).toEqual([]);
  });

  it('端口没变或还不知道端口时什么都不改', async () => {
    const host = installFakeHost();
    stopped(host);
    playingOnline(host, url(2, '7'), 42);
    const queue = installFakeQueue(host, [online(2, '1')]);
    const { store, portAtom } = setup(host, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.callsTo('queue.get')).toEqual([]);
    store.set(portAtom, 2);
    await vi.waitFor(() => expect(host.callsTo('queue.get').length).toBeGreaterThan(0));
    expect(host.callsTo('queue.insertNext')).toEqual([]);
    expect(queue.items).toHaveLength(1);
  });
});

describe('换音质', () => {
  it('当前在线曲目换成另一档：插到队首立即播放，能 seek 后跳回原位置；换的途中记着这一次', async () => {
    const host = installFakeHost();
    stopped(host);
    playingOnline(host, url(2, '7'), 30);
    installFakeQueue(host, [], [online(2, '7', 'flac')]);
    const { service, store, holds } = setup(host);
    await vi.waitFor(() => expect(host.callsTo('queue.get').length).toBeGreaterThan(0));
    const switching = service.switchQuality('flac');
    await vi.waitFor(() => expect(host.callsTo('queue.playNow')).toHaveLength(1));
    expect(store.get(qualitySwitchAtom)).toEqual({ from: url(2, '7'), quality: 'flac' });
    expect(host.callsTo('queue.insertNext').at(-1)).toEqual({
      paths: [url(2, '7', 'flac')],
      position: 0,
    });
    host.emit('playback:stateChanged', { ...STATE, canSeek: true });
    expect(await switching).toBe(true);
    expect(host.callsTo('playback.setPosition')).toEqual([{ position: 30 }]);
    expect(holds).toEqual([{ position: 30, resumed: true }]);
    expect(store.get(qualitySwitchAtom)).toBeNull();
  });

  it('fb2k 换到了别的曲目：答 false，停住立即结束、不算跳回', async () => {
    const host = installFakeHost();
    stopped(host);
    playingOnline(host, url(2, '7'), 30);
    installFakeQueue(host, [], [online(2, '7', 'flac')]);
    const { service, holds } = setup(host);
    await vi.waitFor(() => expect(host.callsTo('queue.get').length).toBeGreaterThan(0));
    const switching = service.switchQuality('flac');
    await vi.waitFor(() => expect(host.callsTo('queue.playNow')).toHaveLength(1));
    host.emit('playback:trackChanged', online(2, '8'));
    expect(await switching).toBe(false);
    expect(holds).toEqual([{ position: 30, resumed: false }]);
    expect(host.callsTo('playback.setPosition')).toEqual([]);
  });

  it('不是在线曲目、已经是这一档或没连上后端时答 false', async () => {
    const host = installFakeHost();
    stopped(host);
    installFakeQueue(host);
    host.answer('playback.getCurrentTrack', { success: true, found: true, track: local('a') });
    const { service, store, portAtom } = setup(host);
    expect(await service.switchQuality('flac')).toBe(false);
    playingOnline(host, url(2, '7', 'flac'), 30);
    expect(await service.switchQuality('flac')).toBe(false);
    store.set(portAtom, null);
    expect(await service.switchQuality('128k')).toBe(false);
    expect(host.callsTo('queue.playNow')).toEqual([]);
  });
});
