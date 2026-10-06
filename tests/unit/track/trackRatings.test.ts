import type { MetadbChangedPayload, Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  CONFIRM_MS,
  ratingsNoticeAtom,
  ratingsRefetchAtom,
  ratingsVersionAtom,
  startTrackRatings,
} from '../../../src/track/trackRatings.ts';
import type { HostParams } from '../../fixtures/fakeHost.ts';
import { hostFailure, numberParam, stringParam } from '../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

type ChangedTrack = MetadbChangedPayload['tracks'][number];
type ChangedItem = Omit<ChangedTrack, 'handle' | 'subsong'> & Partial<ChangedTrack>;

function answered(storage: 'stats' | 'file') {
  return (params: HostParams) => ({
    success: true as const,
    path: stringParam(params, 'path'),
    rating: numberParam(params, 'rating') ?? 0,
    storage,
  });
}

/**
 * 清零之后读回来的样子：`rating` 是 `rating.get` 答的值，大于 0 时文件里还有 RATING 标签。两种读法都照它答，
 * 用例只看删没删标签。
 */
function readsBack(host: UnitHost, ratingOf: (path: string) => number) {
  host.answer('rating.get', (params) => ({
    success: true,
    path: stringParam(params, 'path'),
    rating: ratingOf(stringParam(params, 'path')),
    storage: 'file',
  }));
  host.answer('metadata.read', (params) => {
    const path = stringParam(params, 'path');
    const rating = ratingOf(path);
    const info = { duration: 180, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' };
    return { success: true, path, tags: rating > 0 ? { RATING: String(rating) } : {}, info };
  });
  host.answer('metadata.readRaw', (params) => {
    const path = stringParam(params, 'path');
    const rating = ratingOf(path);
    return {
      success: true,
      source: 'file',
      path,
      tags: rating > 0 ? { RATING: String(rating) } : {},
      info: { duration: 180, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' },
    };
  });
}

async function setup(storage: 'stats' | 'file' = 'stats') {
  const host = installFakeHost();
  host.answer('rating.set', answered(storage));
  readsBack(host, () => 5);
  host.answer('metadata.writeBatch', { success: true, successCount: 1, failCount: 0, errors: [] });
  const store = createStore();
  const ratings = startTrackRatings(store, host.fb);
  // 等确认的定时器随服务一起释放，不串到别的用例里。
  onTestFinished(() => ratings.dispose());
  await ratings.ready;
  // 用例只写 path 与评分；handle 按整文件的写法补成 path，subsong 取 0。
  const event = (items: readonly ChangedItem[], count = items.length) =>
    host.emit('metadb:changed', {
      tracks: items.map((item) => ({ handle: item.path, subsong: 0, ...item })),
      count,
      fromHook: false,
      timestamp: 0,
    });
  return { host, store, ratings, event };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const TRACK: Track = makeTrack({ rating: 2 });
const OTHER: Track = makeTrack({ path: 'file://E:/Music/Other.flac', rating: 4 });
const CUE: Track = makeTrack({ path: 'file://E:/Music/Live.flac', subsong: 3, rating: 1 });

afterEach(() => {
  vi.useRealTimers();
});

describe('写评分', () => {
  it('先记下让界面立刻变，发宿主的路径带 subsong', async () => {
    const { host, store, ratings } = await setup();
    const version = store.get(ratingsVersionAtom);
    const pending = ratings.setRating(CUE, 4);
    expect(ratings.ratingOf(CUE, 0)).toBe(4);
    expect(store.get(ratingsVersionAtom)).toBeGreaterThan(version);
    expect(await pending).toBe(true);
    expect(host.callsTo('rating.set')).toEqual([
      expect.objectContaining({ path: 'file://E:/Music/Live.flac|subsong:3', rating: 4 }),
    ]);
  });

  it('宿主答失败就回滚并留提示，下一次写入清掉提示', async () => {
    const { host, store, ratings } = await setup();
    host.answer('rating.set', hostFailure('OPERATION_FAILED'));
    expect(await ratings.setRating(TRACK, 5)).toBe(false);
    expect(ratings.ratingOf(TRACK, 0)).toBe(2);
    expect(store.get(ratingsNoticeAtom)).toBe('table.ratingFailed');
    host.answer('rating.set', answered('stats'));
    await ratings.setRating(TRACK, 1);
    expect(store.get(ratingsNoticeAtom)).toBeNull();
    expect(ratings.ratingOf(TRACK, 0)).toBe(1);
  });

  it('应答回来前又写过：旧的应答作废，失败也不回滚、不提示', async () => {
    const { host, store, ratings } = await setup();
    const held = host.hold('rating.set');
    const first = ratings.setRating(TRACK, 3);
    const second = ratings.setRating(TRACK, 4);
    await flush();
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await first;
    expect(ratings.ratingOf(TRACK, 0)).toBe(4);
    expect(store.get(ratingsNoticeAtom)).toBeNull();
    held.respond(0);
    expect(await second).toBe(true);
    expect(ratings.ratingOf(TRACK, 0)).toBe(4);
  });

  it('两次写入都失败：回到行里的值', async () => {
    const { host, ratings } = await setup();
    const held = host.hold('rating.set');
    const first = ratings.setRating(TRACK, 3);
    const second = ratings.setRating(TRACK, 4);
    await flush();
    held.respond(0, hostFailure('OPERATION_FAILED'));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await Promise.all([first, second]);
    expect(ratings.ratingOf(TRACK, 0)).toBe(2);
  });

  it('宿主不在时 SDK 答 NOT_SUPPORTED 信封，按失败回滚', async () => {
    const host = installFakeHost({ available: false });
    const ratings = startTrackRatings(createStore(), host.fb);
    expect(await ratings.setRating(TRACK, 5)).toBe(false);
    expect(ratings.ratingOf(TRACK, 0)).toBe(2);
    ratings.dispose();
  });

  it('流媒体不能评分，不发宿主；值夹到 0 至 5 的整数', async () => {
    const { host, ratings } = await setup();
    const stream = makeTrack({ path: 'https://radio.example/live' });
    expect(ratings.canRate(stream)).toBe(false);
    expect(await ratings.setRating(stream, 3)).toBe(false);
    await ratings.setRating(TRACK, 9.7);
    expect(host.callsTo('rating.set')).toEqual([
      expect.objectContaining({ path: TRACK.path, rating: 5 }),
    ]);
  });

  it('宿主确认之前，自己写的值压过写入之后才取的行', async () => {
    const { host, ratings } = await setup();
    const held = host.hold('rating.set');
    const pending = ratings.setRating(TRACK, 5);
    const stamp = ratings.stamp();
    await flush();
    held.release();
    await pending;
    expect(ratings.ratingOf({ ...TRACK, rating: 1 }, stamp)).toBe(5);
    expect(ratings.ratingOf({ ...TRACK, rating: 1 }, ratings.stamp())).toBe(5);
  });

  it('回声到了就算确认，之后取的行为准；回声一直没来时到时限也按确认处理', async () => {
    const { ratings, event } = await setup();
    await ratings.setRating(TRACK, 5);
    event([{ path: TRACK.absolutePath, rating: 5 }]);
    expect(ratings.ratingOf({ ...TRACK, rating: 1 }, ratings.stamp())).toBe(1);
    vi.useFakeTimers();
    await ratings.setRating(OTHER, 1);
    expect(ratings.ratingOf(OTHER, ratings.stamp())).toBe(1);
    vi.advanceTimersByTime(CONFIRM_MS);
    expect(ratings.ratingOf(OTHER, ratings.stamp())).toBe(4);
  });
});

describe('确认的先后', () => {
  it('回声比应答先到：应答回来就算确认，之后取的行马上盖得过它', async () => {
    const { host, ratings, event } = await setup();
    const held = host.hold('rating.set');
    const pending = ratings.setRating(TRACK, 5);
    await flush();
    event([{ path: TRACK.absolutePath, rating: 5 }]);
    held.release();
    await pending;
    expect(ratings.ratingOf({ ...TRACK, rating: 1 }, ratings.stamp())).toBe(1);
  });

  it('到时限时等的这段里宿主报过不同的值：显示宿主的值', async () => {
    const { store, ratings, event } = await setup();
    vi.useFakeTimers();
    const stamp = ratings.stamp();
    await ratings.setRating(OTHER, 1);
    event([{ path: OTHER.absolutePath, rating: 3 }]);
    expect(ratings.ratingOf(OTHER, stamp)).toBe(1);
    const version = store.get(ratingsVersionAtom);
    vi.advanceTimersByTime(CONFIRM_MS);
    expect(ratings.ratingOf(OTHER, stamp)).toBe(3);
    expect(store.get(ratingsVersionAtom)).toBeGreaterThan(version);
  });
});

describe('清零', () => {
  it('写进统计项时补删 RATING 标签；报旧标签值的回声不盖过清零', async () => {
    const { host, ratings, event } = await setup('stats');
    expect(await ratings.setRating(TRACK, 0)).toBe(true);
    expect(host.callsTo('metadata.writeBatch')).toEqual([
      { items: [expect.objectContaining({ path: TRACK.path, tags: { RATING: null } })] },
    ]);
    event([{ path: TRACK.absolutePath, rating: 3 }]);
    expect(ratings.ratingOf(TRACK, ratings.stamp())).toBe(0);
  });

  it('读回来标签已经没有评分时不删标签，不去改动音频文件', async () => {
    const { host, ratings } = await setup('stats');
    readsBack(host, () => 0);
    expect(await ratings.setRating(TRACK, 0)).toBe(true);
    expect(host.callsTo('metadata.writeBatch')).toEqual([]);
  });

  it('菜单清零：逐首读一次，只删读回来还有评分的那几首的标签', async () => {
    const { host, ratings } = await setup();
    readsBack(host, (path) => (path === OTHER.path ? 3 : 0));
    ratings.assume([TRACK, OTHER], 0);
    await flush();
    expect(host.callsTo('metadata.writeBatch')).toEqual([
      { items: [expect.objectContaining({ path: OTHER.path, tags: { RATING: null } })] },
    ]);
  });

  it('标签没删掉时留提示', async () => {
    const { host, store, ratings } = await setup('stats');
    host.answer('metadata.writeBatch', hostFailure('OPERATION_FAILED'));
    expect(await ratings.setRating(TRACK, 0)).toBe(true);
    expect(store.get(ratingsNoticeAtom)).toBe('table.ratingTagFailed');
  });

  it('清零被后来的写入顶掉、自己写成了：照样补删标签', async () => {
    const { host, ratings } = await setup('stats');
    const held = host.hold('rating.set');
    const clear = ratings.setRating(TRACK, 0);
    const rate = ratings.setRating(TRACK, 4);
    await flush();
    held.release();
    await Promise.all([clear, rate]);
    expect(host.callsTo('metadata.writeBatch')).toEqual([
      { items: [expect.objectContaining({ path: TRACK.path, tags: { RATING: null } })] },
    ]);
  });

  it('删不删看标签本身：RATING 不论大小写，空值不算', async () => {
    const { host, ratings } = await setup('stats');
    host.answer('rating.get', (params) => ({
      success: true,
      path: stringParam(params, 'path'),
      rating: 4,
      storage: 'stats',
    }));
    const info = { duration: 180, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' };
    host.answer('metadata.read', (params) => {
      const path = stringParam(params, 'path');
      const tags = path === OTHER.path ? { rating: ['', '3'] } : { RATING: ' ' };
      return { success: true, path, tags, info };
    });
    ratings.assume([TRACK, OTHER], 0);
    await flush();
    expect(host.callsTo('metadata.writeBatch')).toEqual([
      { items: [expect.objectContaining({ path: OTHER.path, tags: { RATING: null } })] },
    ]);
  });

  it('宿主直接写标签时不补删', async () => {
    vi.useFakeTimers();
    const { host, ratings } = await setup('file');
    readsBack(host, () => 0);
    const pending = ratings.setRating(TRACK, 0);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(await pending).toBe(true);
    expect(host.callsTo('metadata.writeBatch')).toEqual([]);
  });
});

describe('写标签的结局', () => {
  /** 宿主的 `metadata:writeComplete`：写评分时路径是宿主自己的形态，删标签时是请求给的那一个。 */
  function completed(host: UnitHost, path: string, success: boolean) {
    host.emit('metadata:writeComplete', {
      operation: 'write',
      path,
      subsong: 0,
      code: success ? 0 : 2,
      success,
      status: success ? 'success' : 'error',
    });
  }
  const hostPath = 'file://E:\\Music\\Nujabes\\Modal Soul\\01 Feather.flac';

  it('写标签派发成功、真写失败：回到原来的值并提示', async () => {
    const { host, store, ratings } = await setup('file');
    vi.useFakeTimers();
    const pending = ratings.setRating(TRACK, 4);
    await vi.advanceTimersByTimeAsync(0);
    expect(ratings.ratingOf(TRACK, 0)).toBe(4);
    completed(host, hostPath, false);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(await pending).toBe(false);
    expect(ratings.ratingOf(TRACK, 0)).toBe(2);
    expect(store.get(ratingsNoticeAtom)).toBe('table.ratingFailed');
  });

  it('写标签写成就算宿主确认：之后取的行盖得过它，不用等时限', async () => {
    const { host, ratings } = await setup('file');
    const pending = ratings.setRating(TRACK, 4);
    await flush();
    readsBack(host, () => 4);
    completed(host, hostPath, true);
    expect(await pending).toBe(true);
    expect(ratings.ratingOf({ ...TRACK, rating: 1 }, ratings.stamp())).toBe(1);
  });

  it('等不到写完的事件时，到时限补读确认目标值', async () => {
    const { host, ratings } = await setup('file');
    readsBack(host, () => 4);
    vi.useFakeTimers();
    const pending = ratings.setRating(TRACK, 4);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(await pending).toBe(true);
    expect(ratings.ratingOf(TRACK, 0)).toBe(4);
  });

  it('成功事件和宿主缓存都不能代替文件中的实际标签值', async () => {
    const { host, store, ratings } = await setup('file');
    vi.useFakeTimers();
    host.answer('rating.get', { success: true, path: TRACK.path, rating: 4, storage: 'file' });
    const pending = ratings.setRating(TRACK, 4);
    completed(host, hostPath, true);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(await pending).toBe(false);
    expect(store.get(ratingsNoticeAtom)).toBe('table.ratingFailed');
    expect(host.callsTo('metadata.readRaw')[0]).toEqual({ path: TRACK.path, cueIndex: 0 });
  });

  it('删标签真删失败时已经又写过一次：不再提示', async () => {
    const { host, store, ratings } = await setup('stats');
    expect(await ratings.setRating(TRACK, 0)).toBe(true);
    await ratings.setRating(TRACK, 3);
    completed(host, TRACK.path, false);
    await flush();
    expect(store.get(ratingsNoticeAtom)).toBeNull();
  });

  it('删标签派发成功、真删失败时提示', async () => {
    const { host, store, ratings } = await setup('stats');
    vi.useFakeTimers();
    expect(await ratings.setRating(TRACK, 0)).toBe(true);
    expect(store.get(ratingsNoticeAtom)).toBeNull();
    completed(host, TRACK.path, false);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(store.get(ratingsNoticeAtom)).toBe('table.ratingTagFailed');
  });
});

describe('外部改动', () => {
  it('整文件的曲目取事件报的值，路径大小写与分隔符不论', async () => {
    const { ratings, event } = await setup();
    const stamp = ratings.stamp();
    event([{ path: 'e:\\music\\other.flac', rating: 1 }]);
    expect(ratings.ratingOf(OTHER, stamp)).toBe(1);
    expect(ratings.ratingOf(TRACK, stamp)).toBe(2);
  });

  it('同一个值再报也重画，重取行之后改回原值时显示宿主报的值', async () => {
    const { store, ratings, event } = await setup();
    event([{ path: OTHER.absolutePath, rating: 1 }]);
    const refetched = ratings.stamp();
    const row = { ...OTHER, rating: 3 };
    expect(ratings.ratingOf(row, refetched)).toBe(3);
    const version = store.get(ratingsVersionAtom);
    event([{ path: OTHER.absolutePath, rating: 1 }]);
    expect(store.get(ratingsVersionAtom)).toBe(version + 1);
    expect(ratings.ratingOf(row, refetched)).toBe(1);
  });

  it('条目不带评分时跳过', async () => {
    const { ratings, event } = await setup();
    const stamp = ratings.stamp();
    event([{ path: OTHER.absolutePath, title: 'Other' }]);
    expect(ratings.ratingOf(OTHER, stamp)).toBe(4);
  });

  it('一个文件里有好几首：登记在显示的那几首逐首补读，注销后不再补读', async () => {
    const { host, ratings, event } = await setup();
    const unwatch = ratings.watch([CUE], ratings.stamp());
    const stamp = ratings.stamp();
    event([{ path: CUE.absolutePath, rating: 4 }]);
    await flush();
    expect(host.callsTo('rating.get')).toEqual([
      expect.objectContaining({ path: `${CUE.path}|subsong:3` }),
    ]);
    expect(ratings.ratingOf(CUE, stamp)).toBe(5);
    unwatch();
    event([{ path: CUE.absolutePath, rating: 2 }]);
    await flush();
    expect(host.callsTo('rating.get')).toHaveLength(1);
  });

  it('一个文件里有好几首：没登记时错过的事件，重新登记时补读；取行晚于事件的不补读', async () => {
    const { host, ratings, event } = await setup();
    const stamp = ratings.stamp();
    ratings.watch([CUE], stamp)();
    event([{ path: CUE.absolutePath, rating: 4 }]);
    await flush();
    expect(host.callsTo('rating.get')).toEqual([]);
    const unwatch = ratings.watch([CUE], stamp);
    await flush();
    expect(host.callsTo('rating.get')).toEqual([
      expect.objectContaining({ path: `${CUE.path}|subsong:3` }),
    ]);
    expect(ratings.ratingOf(CUE, stamp)).toBe(5);
    unwatch();
    ratings.watch([CUE], ratings.stamp())();
    await flush();
    expect(host.callsTo('rating.get')).toHaveLength(1);
  });

  it('一个文件里有好几首：补读在途时来的事件合并成读完之后的再一次', async () => {
    const { host, ratings, event } = await setup();
    const unwatch = ratings.watch([CUE], ratings.stamp());
    const held = host.hold('rating.get');
    event([{ path: CUE.absolutePath, rating: 4 }]);
    event([{ path: CUE.absolutePath, rating: 3 }]);
    event([{ path: CUE.absolutePath, rating: 2 }]);
    await flush();
    expect(host.callsTo('rating.get')).toHaveLength(1);
    held.respond(0);
    await flush();
    expect(host.callsTo('rating.get')).toHaveLength(2);
    held.release();
    await flush();
    expect(host.callsTo('rating.get')).toHaveLength(2);
    unwatch();
  });

  it('事件报不全：带来的照样套用，自己的值不丢，通知表格重取行', async () => {
    const { store, ratings, event } = await setup();
    await ratings.setRating(TRACK, 5);
    const stamp = ratings.stamp();
    event([{ path: OTHER.absolutePath, rating: 1 }], 80);
    expect(ratings.ratingOf(TRACK, stamp)).toBe(5);
    expect(ratings.ratingOf(OTHER, stamp)).toBe(1);
    expect(store.get(ratingsRefetchAtom)).toBe(1);
  });

  it.each(['setRating', 'assume'] as const)('%s 使同一首正在等待的旧补读失效', async (method) => {
    const { host, store, ratings, event } = await setup();
    ratings.watch([CUE], ratings.stamp());
    const held = host.hold('rating.get');
    event([{ path: CUE.absolutePath, rating: 2 }]);
    await flush();
    expect(host.callsTo('rating.get')).toHaveLength(1);
    if (method === 'setRating') expect(await ratings.setRating(CUE, 4)).toBe(true);
    else ratings.assume([CUE], 4);
    const version = store.get(ratingsVersionAtom);
    held.release();
    await flush();
    expect(ratings.ratingOf(CUE, 0)).toBe(4);
    expect(store.get(ratingsVersionAtom)).toBe(version);
    expect(host.callsTo('rating.get')).toHaveLength(1);
  });

  it('菜单评分成功后记下的值立刻生效，不发宿主；清零时补删标签', async () => {
    const { host, ratings } = await setup();
    const stream = makeTrack({ path: 'http://radio.example/a' });
    ratings.assume([TRACK, OTHER, stream], 3);
    expect([TRACK, OTHER].map((track) => ratings.ratingOf(track, 0))).toEqual([3, 3]);
    expect(ratings.ratingOf(stream, 0)).toBe(stream.rating);
    expect(host.callsTo('rating.set')).toEqual([]);
    ratings.assume([TRACK], 0);
    await flush();
    expect(host.callsTo('metadata.writeBatch')).toEqual([
      { items: [expect.objectContaining({ path: TRACK.path, tags: { RATING: null } })] },
    ]);
  });
});

describe('宿主参数', () => {
  it('写、清零时读标签、删标签、补读都显式带 cueIndex，subsong 为 0 也带', async () => {
    const { host, ratings, event } = await setup('stats');
    await ratings.setRating(CUE, 4);
    await ratings.setRating(TRACK, 0);
    expect(host.callsTo('rating.set')).toEqual([
      { path: `${CUE.path}|subsong:3`, rating: 4, cueIndex: 3 },
      { path: TRACK.path, rating: 0, cueIndex: 0 },
    ]);
    expect(host.callsTo('metadata.read')).toEqual([{ path: TRACK.path, cueIndex: 0 }]);
    expect(host.callsTo('metadata.writeBatch')).toEqual([
      { items: [{ path: TRACK.path, tags: { RATING: null }, cueIndex: 0 }] },
    ]);
    const unwatch = ratings.watch([CUE], ratings.stamp());
    event([{ path: CUE.absolutePath, rating: 2 }]);
    await flush();
    expect(host.callsTo('rating.get')).toEqual([{ path: `${CUE.path}|subsong:3`, cueIndex: 3 }]);
    unwatch();
  });
});

describe('生命周期', () => {
  it('释放同时取消标签确认、统计项定时器和补读的后续更新', async () => {
    vi.useFakeTimers();
    const { host, store, ratings, event } = await setup();
    await ratings.setRating(OTHER, 3);
    ratings.watch([CUE], ratings.stamp());
    const held = host.hold('rating.get');
    event([{ path: CUE.absolutePath, rating: 2 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('rating.get')).toHaveLength(1);
    host.answer('rating.set', answered('file'));
    const pending = ratings.setRating(TRACK, 4);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const version = store.get(ratingsVersionAtom);
    ratings.dispose();
    expect(await pending).toBe(false);
    expect(host.listenerCount('metadb:changed')).toBe(0);
    expect(host.listenerCount('metadata:writeComplete')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    held.release();
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(store.get(ratingsVersionAtom)).toBe(version);
    expect(store.get(ratingsNoticeAtom)).toBeNull();
    expect(host.callsTo('metadata.readRaw')).toHaveLength(0);
  });

  it('释放后摘掉订阅，晚到的应答不再改状态', async () => {
    const { host, store, ratings } = await setup();
    expect(host.listenerCount('metadb:changed')).toBe(1);
    const held = host.hold('rating.set');
    const pending = ratings.setRating(TRACK, 5);
    await flush();
    ratings.dispose();
    expect(host.listenerCount('metadb:changed')).toBe(0);
    held.respond(0, hostFailure('OPERATION_FAILED'));
    expect(await pending).toBe(false);
    expect(store.get(ratingsNoticeAtom)).toBeNull();
  });

  it('宿主就绪前就释放了：就绪后不再订阅', async () => {
    const host = installFakeHost({ available: false });
    const ratings = startTrackRatings(createStore(), host.fb);
    ratings.dispose();
    host.connect();
    await ratings.ready;
    expect(host.listenerCount('metadb:changed')).toBe(0);
  });

  it('关掉提示', async () => {
    const { host, store, ratings } = await setup();
    host.answer('rating.set', hostFailure('OPERATION_FAILED'));
    await ratings.setRating(TRACK, 5);
    ratings.dismissNotice();
    expect(store.get(ratingsNoticeAtom)).toBeNull();
  });
});
