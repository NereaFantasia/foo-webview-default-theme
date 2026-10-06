import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import type { QueueView } from '../../../../../src/shell/right-card/queue/queueState.ts';
import {
  startUpNext,
  upEarlierAtom,
  upNextAtom,
} from '../../../../../src/shell/right-card/queue/upNext.ts';
import type { HostParams } from '../../../../fixtures/fakeHost.ts';
import { numberParam } from '../../../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../../../fixtures/tracks.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const GUID = '{11111111-1111-1111-1111-111111111111}';
const ROWS = ['r0', 'r1', 'r2', 'r3', 'r4'];

function setup(
  options: {
    order?: string;
    follow?: boolean;
    at?: number | null;
    holdFollow?: boolean;
    size?: number;
  } = {},
) {
  const rows = options.size ? Array.from({ length: options.size }, (_, i) => `r${i}`) : ROWS;
  const host = installFakeHost({
    answers: {
      playback: {
        getCurrentTrackIndex:
          options.at === null
            ? { success: true, found: false, playlist: null, playlistGuid: null, index: null }
            : {
                success: true,
                found: true,
                playlist: 0,
                playlistGuid: GUID,
                index: options.at ?? 1,
              },
      },
      config: {
        getPlaybackFollowCursor: {
          success: true,
          enabled: options.follow ?? false,
          value: options.follow ?? false,
        },
      },
      playlist: {
        getAll: {
          success: true,
          count: 1,
          playlists: [
            {
              index: 0,
              guid: GUID,
              name: 'Night drive',
              trackCount: rows.length,
              isActive: true,
              isPlaying: true,
              isLocked: false,
              isAutoplaylist: false,
            },
          ],
        },
        getTracks: (params: HostParams) => {
          const start = numberParam(params, 'start') ?? 0;
          const count = numberParam(params, 'count') ?? 0;
          const tracks = rows
            .slice(start, start + count)
            .map((title) => makeTrack({ path: `file://E:/Music/${title}.flac`, title }));
          return {
            success: true,
            playlist: 0,
            start,
            count: tracks.length,
            total: rows.length,
            tracks,
          };
        },
      },
    },
  });
  const store = createStore();
  const order = atom<string | null>(options.order ?? 'default');
  const stopped = atom(false);
  const queue = atom<QueueView>({ status: 'ready', entries: [] });
  const followRead = options.holdFollow ? host.hold('config.getPlaybackFollowCursor') : null;
  const service = startUpNext(store, { order, stopped, queue }, host.fb);
  const titles = () => store.get(upNextAtom).rows.map((row) => row.track.title);
  return { host, store, order, stopped, queue, service, titles, followRead };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startUpNext', () => {
  it('读取起点时切换播放顺序，旧起点不能提前发布成新范围', async () => {
    const { host, store, order, service } = setup({ at: 0, size: 80 });
    await service.ready;
    const positions = host.hold('playback.getCurrentTrackIndex');
    host.emit('playback:trackChanged', makeTrack({ title: 'r1' }));
    store.set(order, 'repeat-playlist');
    await settle();
    expect(store.get(upNextAtom)).toMatchObject({ total: 79, refreshing: true });
    positions.respond(0, { playlistGuid: GUID, success: true, found: true, playlist: 0, index: 1 });
    await settle();
    expect(store.get(upNextAtom)).toMatchObject({ total: 80, currentCount: 78, refreshing: false });
    service.dispose();
  });

  it('换曲等坐标与曲目读取时保留列表，准备完才一次发布新范围', async () => {
    const { host, store, service } = setup({ at: 0, size: 80 });
    await service.ready;
    const before = store.get(upNextAtom);
    const snapshots: (typeof before)[] = [];
    const off = store.sub(upNextAtom, () => snapshots.push(store.get(upNextAtom)));
    const position = host.hold('playback.getCurrentTrackIndex');
    const tracks = host.hold('playlist.getTracks');
    host.emit('playback:trackChanged', makeTrack({ title: 'r1' }));
    await settle();
    expect(store.get(upNextAtom).total).toBe(79);
    expect(store.get(upNextAtom).rows).toEqual(before.rows);
    expect(await service.readSelection([0], before.version)).toBeNull();
    position.respond(0, { playlistGuid: GUID, success: true, found: true, playlist: 0, index: 1 });
    await settle();
    expect(store.get(upNextAtom).total).toBe(79);
    expect(store.get(upNextAtom).rows).toEqual(before.rows);
    tracks.release();
    await settle();
    expect(store.get(upNextAtom).total).toBe(78);
    expect(store.get(upNextAtom).rows[0]?.track.title).toBe('r2');
    expect(snapshots.every((view) => view.total > 0 && view.rows.length > 0)).toBe(true);
    off();
    service.dispose();
  });
  it('在来源中段浏览时换曲，替换先读原视口附近而非重新读队首', async () => {
    const { host, store, service } = setup({ at: 0, size: 5001 });
    await service.ready;
    await service.readRange(2500, 2510);
    const before = host.callsTo('playlist.getTracks').length;
    host.answer('playback.getCurrentTrackIndex', {
      playlistGuid: GUID,
      success: true,
      found: true,
      playlist: 0,
      index: 1,
    });
    host.emit('playback:trackChanged', makeTrack({ title: 'r1' }));
    await settle();
    expect(store.get(upNextAtom).rows.some((row) => row.row === 2501)).toBe(true);
    expect(
      host
        .callsTo('playlist.getTracks')
        .slice(before)
        .every((call) => Number(call['start']) > 1900),
    ).toBe(true);
    service.dispose();
  });

  it('手动队列变化未改变续播起点时，保留页与代次', async () => {
    const { store, queue, service, host } = setup({ at: 0, size: 2001 });
    await service.ready;
    await service.readRange(1500, 1520);
    const before = store.get(upNextAtom);
    const calls = host.callsTo('playlist.getTracks').length;
    store.set(queue, {
      status: 'ready',
      entries: [{ key: 'manual', track: makeTrack({ title: '插播' }), spot: null }],
    });
    await settle();
    expect(store.get(upNextAtom)).toBe(before);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(calls);
    service.dispose();
  });
  it('完整总量可直接读到末尾，不必逐页经过中间曲目', async () => {
    const { host, store, service, titles } = setup({ at: 0, size: 5001 });
    await service.ready;
    expect(store.get(upNextAtom).total).toBe(5000);
    expect(titles()).toHaveLength(600);
    const before = host.callsTo('playlist.getTracks').length;
    await service.readRange(4990, 4999);
    expect(titles().at(-1)).toBe('r5000');
    expect(
      host
        .callsTo('playlist.getTracks')
        .slice(before)
        .every((p) => Number(p['start']) >= 4401),
    ).toBe(true);
    service.dispose();
  });

  it('重复列表跨页绕回开头，只遍历一轮', async () => {
    const { store, service, titles } = setup({ order: 'repeat-playlist', at: 260, size: 524 });
    await service.ready;
    expect(store.get(upNextAtom).total).toBe(524);
    expect(store.get(upNextAtom).currentCount).toBe(263);
    expect(titles()).toEqual([
      ...Array.from({ length: 263 }, (_, i) => `r${i + 261}`),
      ...Array.from({ length: 261 }, (_, i) => `r${i}`),
    ]);
    service.dispose();
  });

  it('换曲后在途旧页不能覆盖新的来源', async () => {
    const { host, service, titles } = setup({ at: 0, size: 2001 });
    await service.ready;
    const held = host.hold('playlist.getTracks');
    const reading = service.readRange(1500, 1501);
    await settle();
    host.answer('playback.getCurrentTrackIndex', {
      playlistGuid: GUID,
      success: true,
      found: true,
      playlist: 0,
      index: 1997,
    });
    host.emit('playback:trackChanged', makeTrack({ title: 'r1997' }));
    await settle();
    held.release();
    await reading;
    await settle();
    expect(titles()).toEqual(['r1998', 'r1999', 'r2000']);
    service.dispose();
  });

  it('默认顺序：从续播起点的下一行列到末尾，带来源列表', async () => {
    const { store, service, titles } = setup({ at: 1 });
    await service.ready;
    expect(titles()).toEqual(['r2', 'r3', 'r4']);
    expect(store.get(upNextAtom).list?.guid).toBe(GUID);
  });

  it('首次读取失败仍保留总量，允许从第一批重试', async () => {
    const { host, store, service, titles } = setup({ at: 0, size: 80 });
    const held = host.hold('playlist.getTracks');
    await settle();
    held.respond(0, { success: false, error: '读取失败', code: 'OPERATION_FAILED' });
    await service.ready;
    expect(store.get(upNextAtom)).toMatchObject({ total: 79, failedPages: new Set([0]) });
    expect(titles()).toEqual([]);
    const retry = service.readRange(0, 0, true);
    await settle();
    held.release();
    await retry;
    expect(titles()).toHaveLength(79);
    expect(titles()[0]).toBe('r1');
    service.dispose();
  });

  it('服务释放后，在途续读不会追加，也不会再发新批次', async () => {
    const { host, service, titles } = setup({ at: 0, size: 2001 });
    await service.ready;
    const held = host.hold('playlist.getTracks');
    const reading = service.readRange(1500, 1501);
    await settle();
    service.dispose();
    held.release();
    await reading;
    expect(titles()).toHaveLength(600);
    const before = host.callsTo('playlist.getTracks').length;
    await service.readRange(1500, 1501);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(before);
  });

  it('重复列表：到末尾绕回开头，到起点为止', async () => {
    const { service, titles } = setup({ order: 'repeat-playlist', at: 3 });
    await service.ready;
    expect(titles()).toEqual(['r4', 'r0', 'r1', 'r2', 'r3']);
  });

  it('随机顺序、单曲循环、开了播放跟随光标、停止时都不出', async () => {
    const random = setup({ order: 'shuffle-tracks' });
    await random.service.ready;
    expect(random.titles()).toEqual([]);
    const follow = setup({ follow: true });
    await follow.service.ready;
    expect(follow.titles()).toEqual([]);
    const stopped = setup();
    await stopped.service.ready;
    stopped.store.set(stopped.stopped, true);
    await settle();
    expect(stopped.titles()).toEqual([]);
  });

  it('换成推得出的顺序时重新推', async () => {
    const { store, order, service, titles } = setup({ order: 'random', at: 2 });
    await service.ready;
    expect(titles()).toEqual([]);
    store.set(order, 'default');
    await settle();
    expect(titles()).toEqual(['r3', 'r4']);
  });

  it.each([true, false])('播放跟随光标已变成 %s：迟到的初读不能覆盖事件', async (enabled) => {
    const { host, service, titles, followRead } = setup({ follow: !enabled, holdFollow: true });
    await settle();
    if (!followRead) throw new Error('缺少扣留的初读');
    expect(followRead.pending).toHaveLength(1);
    host.emit('playback:followCursorChanged', { enabled });
    followRead.release();
    await service.ready;
    expect(titles()).toEqual(enabled ? [] : ['r2', 'r3', 'r4']);
    service.dispose();
  });

  it('播列表外的曲目期间起点所在的列表被改：不再信记下的那一行', async () => {
    const { host, service, titles } = setup({ at: 1 });
    await service.ready;
    host.answer('playback.getCurrentTrackIndex', {
      playlistGuid: null,
      success: true,
      found: false,
      playlist: null,
      index: null,
    });
    host.emit('playback:trackChanged', makeTrack({ title: 'queued' }));
    await settle();
    expect(titles()).toEqual(['r2', 'r3', 'r4']);
    host.emit('playlist:itemsAdded', { playlistGuid: GUID, playlist: 0, start: 0, count: 1 });
    await settle();
    expect(titles()).toEqual([]);
  });

  it('队列里有带列表位置的条目：起点跟到最后一条的位置', async () => {
    const { store, queue, service, titles } = setup({ at: 0 });
    await service.ready;
    store.set(queue, {
      status: 'ready',
      entries: [
        {
          key: 'x#0',
          track: makeTrack({ path: 'file://E:/Music/r3.flac', title: 'r3' }),
          spot: { playlist: 0, row: 3 },
        },
        { key: 'y#0', track: makeTrack({ title: 'y' }), spot: null },
      ],
    });
    await settle();
    expect(titles()).toEqual(['r4']);
  });

  it('两次读起点的应答倒着回来：晚到的旧应答不盖掉新的起点', async () => {
    const { host, service, titles } = setup({ at: 0 });
    await service.ready;
    const held = host.hold('playback.getCurrentTrackIndex');
    host.emit('playback:trackChanged', makeTrack({ title: 'r1' }));
    host.emit('playback:trackChanged', makeTrack({ title: 'r3' }));
    await settle();
    held.respond(1, { playlistGuid: GUID, success: true, found: true, playlist: 0, index: 3 });
    await settle();
    held.respond(0, { playlistGuid: GUID, success: true, found: true, playlist: 0, index: 1 });
    await settle();
    expect(titles()).toEqual(['r4']);
  });

  it('外部坐标队列项在来源重排后指向另一首，停止推算而不展示错误的后续', async () => {
    const { host, store, queue, service, titles } = setup({ at: 0 });
    await service.ready;
    store.set(queue, {
      status: 'ready',
      entries: [
        {
          key: 'r3#0',
          track: makeTrack({ path: 'file://E:/Music/r3.flac' }),
          spot: { playlist: 0, row: 3 },
        },
      ],
    });
    await settle();
    expect(titles()).toEqual(['r4']);
    host.answer('playlist.getTracks', {
      success: true,
      playlist: 0,
      start: 3,
      count: 1,
      total: 5,
      tracks: [makeTrack({ path: 'file://E:/Music/another.flac' })],
    });
    host.emit('playlist:itemsReordered', { playlistGuid: GUID, playlist: 0, count: 5 });
    await settle();
    expect(store.get(upNextAtom).list).toBeNull();
    expect(titles()).toEqual([]);
  });

  it('外部坐标的列表序号指到另一张，即使同一行有同曲也不沿用', async () => {
    const { host, store, queue, service } = setup({ at: 0 });
    await service.ready;
    store.set(queue, {
      status: 'ready',
      entries: [
        {
          key: 'r3#0',
          track: makeTrack({ path: 'file://E:/Music/r3.flac' }),
          spot: { playlist: 0, row: 3 },
        },
      ],
    });
    await settle();
    expect(store.get(upNextAtom).list?.guid).toBe(GUID);
    host.answer('playlist.getAll', {
      success: true,
      count: 1,
      playlists: [
        {
          index: 0,
          guid: '{22222222-2222-2222-2222-222222222222}',
          name: 'Other',
          trackCount: 5,
          isActive: true,
          isPlaying: true,
          isLocked: false,
          isAutoplaylist: false,
        },
      ],
    });
    host.emit('playlist:reordered', {
      count: 1,
      guids: ['{22222222-2222-2222-2222-222222222222}'],
    });
    await settle();
    expect(store.get(upNextAtom).list).toBeNull();
  });

  describe('前面那几行', () => {
    it('播到第 N 行时是第 0 行到它前一行；界面要了才读，读到的是来源里的行号', async () => {
      const { host, store, service } = setup({ at: 3, size: 10 });
      await service.ready;
      expect(store.get(upEarlierAtom)).toMatchObject({ total: 3, currentCount: 3, rows: [] });
      expect(host.callsTo('playlist.getTracks').every((call) => Number(call['start']) >= 4)).toBe(
        true,
      );
      await service.readEarlier(0, 2);
      expect(store.get(upEarlierAtom).rows.map((row) => [row.row, row.track.title])).toEqual([
        [0, 'r0'],
        [1, 'r1'],
        [2, 'r2'],
      ]);
      service.dispose();
    });

    it('换到下一行时多出一行，已读的行留着，不先清空', async () => {
      const { host, store, service } = setup({ at: 3, size: 10 });
      await service.ready;
      await service.readEarlier(0, 2);
      const snapshots: number[] = [];
      const off = store.sub(upEarlierAtom, () =>
        snapshots.push(store.get(upEarlierAtom).rows.length),
      );
      host.answer('playback.getCurrentTrackIndex', {
        playlistGuid: GUID,
        success: true,
        found: true,
        playlist: 0,
        index: 4,
      });
      host.emit('playback:trackChanged', makeTrack({ title: 'r4' }));
      await settle();
      expect(store.get(upEarlierAtom)).toMatchObject({ total: 4, refreshing: false });
      expect(snapshots.every((count) => count > 0)).toBe(true);
      off();
      service.dispose();
    });

    it('播第 0 行、随机顺序、播列表外的曲目时都没有这一段', async () => {
      const first = setup({ at: 0, size: 10 });
      await first.service.ready;
      expect(first.store.get(upEarlierAtom).total).toBe(0);
      first.service.dispose();

      const random = setup({ at: 3, size: 10, order: 'random' });
      await random.service.ready;
      expect(random.store.get(upEarlierAtom).total).toBe(0);
      random.service.dispose();

      const outside = setup({ at: 3, size: 10 });
      await outside.service.ready;
      outside.host.answer('playback.getCurrentTrackIndex', {
        success: true,
        found: false,
        playlist: null,
        playlistGuid: null,
        index: null,
      });
      outside.host.emit('playback:trackChanged', makeTrack({ title: '外部' }));
      await settle();
      expect(outside.store.get(upEarlierAtom).total).toBe(0);
      outside.service.dispose();
    });
  });
});
