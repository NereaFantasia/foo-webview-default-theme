import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { MusicQuality } from '../server/musicObjects.ts';
import { exclusive, LIBRARY_VIEW_PLAYLIST } from './libraryView.ts';
import { onlineAddress, readOnlineAddress } from '../server/onlineAddress.ts';
import type { PlaybackService } from './playbackContract.ts';

export interface OnlinePlaybackFace {
  on: typeof fb.on;
  queue: Pick<typeof fb.queue, 'get' | 'remove' | 'insertNext' | 'playNow'>;
  playlist: Pick<typeof fb.playlist, 'getAll' | 'getTracks' | 'removeTracks' | 'insertTracks'>;
  player: Pick<
    typeof fb.player,
    'getState' | 'getCurrentTrack' | 'getCurrentTrackIndex' | 'getPosition' | 'seek'
  >;
}

/** 等 fb2k 换到新地址、再等它能 seek 的时限，毫秒。后端没在监听时 fb2k 约 10 秒才放弃一项 */
const ARRIVAL_MS = 15000;
/** 专用列表正忙时隔多久再试一次改写，毫秒 */
const BUSY_RETRY_MS = 1000;

/** 旧端口的在线地址换成 `port` 上的；不是旧端口的在线地址时答 null */
function refreshed(path: string | undefined, port: number): string | null {
  const address = path === undefined ? null : readOnlineAddress(path);
  return address && address.port !== port
    ? onlineAddress(port, address.ref, address.quality)
    : null;
}

/** 从后往前找最后一段连续的旧端口在线条目，交回起点与换成新端口的地址；第 `keep` 条不算 */
function lastStaleRun(paths: readonly string[], port: number, keep: number | null = null) {
  const fresh: string[] = [];
  let end = paths.length - 1;
  const stale = (index: number) => (index === keep ? null : refreshed(paths[index], port));
  while (end >= 0 && !stale(end)) end -= 1;
  let start = end;
  for (let next = stale(start); next !== null; next = stale(start)) {
    fresh.unshift(next);
    start -= 1;
  }
  return fresh.length ? { start: start + 1, fresh } : null;
}

/** 正在换音质的那一首（换之前的地址）与要换成的档位；没在换时为 null */
export interface QualitySwitch {
  readonly from: string;
  readonly quality: MusicQuality;
}

const switchingAtom = atom<QualitySwitch | null>(null);
export const qualitySwitchAtom: Atom<QualitySwitch | null> = atom((get) => get(switchingAtom));

const range = (start: number, length: number) =>
  Array.from({ length }, (_, offset) => start + offset);

export interface OnlinePlaybackService {
  /**
   * 正在播的在线曲目换成 `quality`，从当前位置接着播：在 fb2k 看来是换一条路径，插到队首立即播放，再跳回
   * 原位置。专用列表里那一行不改，之后点「上一首」仍按原来的档位播。当前不是在线曲目、后端没连上，或 fb2k
   * 没换过去时答 false。换的途中 `qualitySwitchAtom` 记着这一次
   */
  switchQuality(quality: MusicQuality): Promise<boolean>;
  dispose(): void;
}

/**
 * 后端换了端口时，把队列、专用列表与正在播的在线曲目改到新端口。fb2k 只认路径，`queue.setContents`
 * 不收路径，专用列表也没有替换接口，所以按连续的旧条目分段，从后往前删掉再按原位插回；本地条目不动
 * 改写不是原子的：途中 fb2k 可能换曲、队首出队，每段动手前重读，换过曲就重来。`queue.insertNext` 按曲目
 * 去重，同一首在队列里出现两次时改写后只剩一条；专用列表每段改写都会存一个撤销点
 *
 * 正在播的在线曲目会在 fb2k 的预读缓冲用完后断掉，所以先用新地址从当前位置接着播。只在播放中这么做：
 * 暂停时接着播会把暂停解开；暂停后继续时缓冲之外的部分会读不到，由 fb2k 按失败跳过
 *
 * fb2k 的续播游标所在的那一行不改：删掉它，下一首会从列表开头放起（实测如此）。游标由
 * `getCurrentTrackIndex` 读；正在播按路径入队的条目时它答没有位置，但 fb2k 仍记着原来那一行，这时整张列表
 * 先不改。没改完的行等换曲后再读一次游标、接着改；游标移到别处后改它原来那一行不影响续播（实测）
 *
 * 页面载入后第一次拿到端口时也查一遍：fb2k 重启时恢复的队列与列表里可能还是上次的端口
 */
export function startOnlinePlayback(
  store: Store,
  port: Atom<number | null>,
  playback: Pick<PlaybackService, 'holdPosition'>,
  host: OnlinePlaybackFace = fb,
): OnlinePlaybackService {
  store.set(switchingAtom, null);
  let disposed = false;
  let run = 0;
  let shifted = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  // 专用列表还有旧端口的行没改：游标在那一行，或读不到游标。换曲后用这一轮的条件接着改
  let pending: { readonly target: number; readonly current: () => boolean } | null = null;
  const offs = [
    host.on('playback:trackChanged', () => {
      shifted += 1;
      if (pending?.current()) void listPass(pending.target, pending.current);
    }),
  ];

  /**
   * 换到 `path` 并跳回 `position` 秒；换过去了就答 true，跳不回去只是从头播。整个过程播放栏的进度停在
   * `position`，不跟宿主的换曲与归零走
   */
  async function replaceCurrent(path: string, position: number, current: () => boolean) {
    const release = playback.holdPosition(position);
    let resumed = false;
    try {
      const arrival = await arrive(path, current);
      if (arrival === 'seekable' && position >= 1 && current()) {
        const sought = await settle(() => host.player.seek(position));
        resumed = sought?.success === true;
      }
      return arrival !== 'failed';
    } finally {
      release(resumed);
    }
  }

  /** 插到队首立即播放，等 fb2k 换到 `path`：没换过去答 failed，换过去了但等不到能 seek 答 switched */
  async function arrive(
    path: string,
    current: () => boolean,
  ): Promise<'failed' | 'switched' | 'seekable'> {
    const inserted = await settle(() => host.queue.insertNext([path], 0));
    if (
      !current() ||
      inserted?.success !== true ||
      inserted.insertedCount + inserted.movedCount < 1
    )
      return 'failed';
    let switched = false;
    let finish: (result: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => (finish = resolve));
    const stops = [
      host.on('playback:trackChanged', (track) => {
        switched = track.path === path;
        if (!switched) finish(false);
      }),
      host.on('playback:stateChanged', (state) => {
        if (switched && state.canSeek) finish(true);
      }),
    ];
    const timer = setTimeout(() => finish(false), ARRIVAL_MS);
    try {
      const played = await settle(() => host.queue.playNow(0));
      if (!current() || played?.success !== true) return 'failed';
      if (await done) return 'seekable';
      return switched ? 'switched' : 'failed';
    } finally {
      clearTimeout(timer);
      for (const stop of stops) stop();
    }
  }

  /** `path` 是正在放的旧端口地址 */
  async function resumeCurrent(path: string, target: number, current: () => boolean) {
    const state = await settle(() => host.player.getState());
    if (!current() || state?.success !== true || state.state !== 'playing') return;
    const address = readOnlineAddress(path);
    const fresh = address && onlineAddress(target, address.ref, address.quality);
    const where = await settle(() => host.player.getPosition());
    if (!fresh || !current()) return;
    const position = where?.success === true && where.path === path ? where.position : 0;
    await replaceCurrent(fresh, position, current);
  }

  async function rewriteQueue(target: number, current: () => boolean): Promise<void> {
    let rounds = Number.POSITIVE_INFINITY;
    for (let round = 0; round < rounds; round += 1) {
      const seen = shifted;
      const answer = await settle(() => host.queue.get());
      if (!current() || answer?.success !== true) return;
      rounds = Math.min(rounds, answer.items.length + 1);
      const segment = lastStaleRun(
        answer.items.map((item) => item.path),
        target,
      );
      if (!segment) return;
      // 读完之后换过曲，队首已出队，位置不再可信：重读
      if (seen !== shifted) continue;
      const removed = await settle(() =>
        host.queue.remove(range(segment.start, segment.fresh.length)),
      );
      if (!current() || removed?.success !== true) return;
      const inserted = await settle(() => host.queue.insertNext(segment.fresh, segment.start));
      if (!current() || inserted?.success !== true) return;
    }
  }

  /** 改完答 true；还有因为游标留着没改的行，或读不到状态时答 false，换曲后再来 */
  async function rewriteLibraryView(target: number, current: () => boolean): Promise<boolean> {
    const all = await settle(() => host.playlist.getAll());
    if (!current() || all?.success !== true) return false;
    const list = all.playlists.find((playlist) => playlist.name === LIBRARY_VIEW_PLAYLIST);
    if (!list) return true;
    const state = await settle(() => host.player.getState());
    const where = await settle(() => host.player.getCurrentTrackIndex());
    if (!current() || state?.success !== true || where?.success !== true) return false;
    let held: number | null = null;
    if (state.state !== 'stopped') {
      if (!where.found) return false;
      if (where.playlistGuid === list.guid) held = where.index;
    }
    // getTracks 默认只给 100 行：按列表现有的行数要，列表变长了下一轮按新的行数要
    let size = list.trackCount;
    for (let round = 0; round <= size; round += 1) {
      const page = await settle(() =>
        host.playlist.getTracks(list.guid, 0, Math.max(size, 1), undefined, ['path']),
      );
      if (!current() || page?.success !== true) return false;
      size = Math.max(size, page.total);
      const paths = page.tracks.map((track) => track.path ?? '');
      const segment = lastStaleRun(paths, target, held);
      if (!segment) return held === null || refreshed(paths[held], target) === null;
      const removed = await settle(() =>
        host.playlist.removeTracks(list.guid, range(segment.start, segment.fresh.length)),
      );
      if (!current() || removed?.success !== true) return false;
      const inserted = await settle(() =>
        host.playlist.insertTracks(list.guid, segment.start, segment.fresh),
      );
      if (!current() || inserted?.success !== true) return false;
    }
    return false;
  }

  /** 专用列表上的操作与起播共用一把锁；正忙时稍后再试 */
  async function listPass(target: number, current: () => boolean): Promise<void> {
    const result = await exclusive(store, () => rewriteLibraryView(target, current));
    if (!current()) return;
    if (result === 'busy') {
      clearTimeout(retry);
      retry = setTimeout(() => void listPass(target, current), BUSY_RETRY_MS);
      return;
    }
    pending = result ? null : { target, current };
  }

  async function sync(target: number): Promise<void> {
    const mine = ++run;
    clearTimeout(retry);
    const current = () => !disposed && mine === run && store.get(port) === target;
    pending = null;
    const answer = await settle(() => host.player.getCurrentTrack());
    if (!current()) return;
    const playing = answer?.success === true && answer.found ? (answer.track?.path ?? null) : null;
    if (playing !== null && refreshed(playing, target) !== null)
      await resumeCurrent(playing, target, current);
    await rewriteQueue(target, current);
    await listPass(target, current);
  }

  const follow = () => {
    const value = store.get(port);
    if (value !== null && !disposed) void sync(value);
  };
  offs.push(store.sub(port, follow));
  follow();

  return {
    async switchQuality(quality) {
      const target = store.get(port);
      if (target === null || disposed) return false;
      const mine = run;
      const current = () => !disposed && mine === run && store.get(port) === target;
      const answer = await settle(() => host.player.getCurrentTrack());
      if (!current() || answer?.success !== true || !answer.found || !answer.track) return false;
      const { path } = answer.track;
      const address = readOnlineAddress(path);
      const fresh = address && onlineAddress(target, address.ref, quality);
      if (!fresh || fresh === path) return false;
      const mark = { from: path, quality };
      store.set(switchingAtom, mark);
      try {
        const where = await settle(() => host.player.getPosition());
        if (!current()) return false;
        const position = where?.success === true && where.path === path ? where.position : 0;
        return await replaceCurrent(fresh, position, current);
      } finally {
        if (store.get(switchingAtom) === mark) store.set(switchingAtom, null);
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(retry);
      for (const off of offs.splice(0)) off();
    },
  };
}

export const onlinePlaybackKey = serviceKey<OnlinePlaybackService>('onlinePlayback');
