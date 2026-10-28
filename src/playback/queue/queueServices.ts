import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import type { Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { enqueuePaths, playKeepingQueue, type EnqueuePlace } from '../../host/queueCommands.ts';
import type { TrackArtwork } from '../../covers/trackArtwork.ts';
import type { Store } from '../../kit/store.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { PlaybackSource } from '../playbackSource.ts';
import { createQueueActions, type QueueActions } from './queueActions.ts';
import { startQueueCovers, type QueueCoversService } from './queueCovers.ts';
import { startQueueMenu, type QueueMenuService } from './queueMenu.ts';
import { queueViewAtom, startQueueState, type QueueStateService } from './queueState.ts';
import { startQueueReview, type QueueReviewService } from './review/queueReview.ts';
import { startUpNext, type UpNextService } from './upNext.ts';

/** 队列从别的业务借的几样，由装配处交进来；队列自己不去 import 那些业务 */
export interface QueueServicesDeps {
  /** 取曲目封面，在线曲目也认得 */
  readonly artwork: TrackArtwork;
  /** 播放顺序的名字，没读到时为 null */
  readonly order: Atom<string | null>;
  readonly stopped: Atom<boolean>;
  /** 正在播放的曲目 */
  readonly current: Atom<Track | null>;
  /**
   * 播放来源（种类与记下的名字）；没有记录时为 null。「接下来」在主题的专用列表里时节头写它，
   * 在别的列表里时写那张列表的名字
   */
  readonly source: Atom<PlaybackSource | null>;
  /** 主题起播用的专用列表的名字：这张表的名字不出现在界面上 */
  readonly libraryList: string;
  /** 去来源的家并定位到正在播放这一首，进历史 */
  openSource(): void;
  /** 去这张播放列表，进历史 */
  openPlaylist(guid: string): void;
}

export interface QueueCommands {
  /** 按句柄入队，`next` 插在队首，`last` 接在队尾 */
  enqueue(handles: readonly string[], place: EnqueuePlace): Promise<boolean>;
  /** 从这张列表的这一行起播，留住队列；这一行已不是 `handle` 那一首时不起播 */
  playFrom(guid: string, row: number, handle: string): Promise<boolean>;
  playHandle(handle: string): Promise<boolean>;
}

export interface QueueServices {
  readonly queue: QueueStateService;
  readonly upNext: UpNextService;
  readonly actions: QueueActions;
  readonly commands: QueueCommands;
  readonly covers: QueueCoversService;
  readonly menu: QueueMenuService;
  readonly review: QueueReviewService;
  readonly deps: QueueServicesDeps;
  dispose(): void;
}

export function startQueueServices(
  store: Store,
  deps: QueueServicesDeps,
  host: typeof fb = fb,
): QueueServices {
  const queue = startQueueState(store, host);
  const upNext = startUpNext(
    store,
    { order: deps.order, stopped: deps.stopped, queue: queueViewAtom },
    host,
  );
  const review = startQueueReview(store, host);
  const actions = createQueueActions(store, queue, host);
  const covers = startQueueCovers(store, deps.artwork);
  const menu = startQueueMenu(store, host);
  return {
    queue,
    upNext,
    actions,
    review,
    commands: {
      enqueue: (handles, place) => enqueuePaths(host, handles, place),
      playFrom: (guid, row, handle) => playKeepingQueue(host, guid, row, handle),
      async playHandle(handle) {
        const inserted = await enqueuePaths(host, [handle], 'next');
        const done = inserted && (await settle(() => host.queue.playNow(0)))?.success === true;
        return done;
      },
    },
    covers,
    menu,
    deps,
    dispose() {
      menu.dispose();
      review.dispose();
      covers.dispose();
      upNext.dispose();
      queue.dispose();
    },
  };
}

export const queueKey = serviceKey<QueueServices>('queue');
