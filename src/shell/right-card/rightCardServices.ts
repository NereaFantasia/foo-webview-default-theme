import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import type { Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { enqueuePaths, playKeepingQueue, type EnqueuePlace } from '../../host/queueCommands.ts';
import type { Store } from '../../kit/store.ts';
import type { PlaybackSource } from '../../playback/playbackSource.ts';
import { createQueueActions, type QueueActions } from './queue/queueActions.ts';
import { startQueueCovers, type QueueCoversService } from './queue/queueCovers.ts';
import { startQueueMenu, type QueueMenuService } from './queue/queueMenu.ts';
import { queueViewAtom, startQueueState, type QueueStateService } from './queue/queueState.ts';
import { startUpNext, type UpNextService } from './queue/upNext.ts';
import { startRightCard, type RightCardService } from './rightCard.ts';
import { startQueueReview, type QueueReviewService } from './queue/review/queueReview.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/** 找专辑、艺人用到的几项。 */
export type AlbumTrack = Pick<
  Track,
  'album' | 'albumArtist' | 'albumArtists' | 'artist' | 'artists'
>;

/** 右侧卡从别的业务借的几样，由装配处交进来；右侧卡自己不去 import 那些业务。 */
export interface RightCardServicesDeps {
  /** 窗口够宽（≥ 1008），卡停靠在内容卡右边。 */
  readonly wide: Atom<boolean>;
  /** 播放顺序的名字，没读到时为 null。 */
  readonly order: Atom<string | null>;
  readonly stopped: Atom<boolean>;
  readonly playbackState: Atom<'playing' | 'paused' | 'stopped'>;
  /** 正在播放的曲目与它的封面地址，卡头用。 */
  readonly current: Atom<Track | null>;
  readonly cover: Atom<string | null>;
  /**
   * 播放来源（种类与记下的名字）；没有记录时为 null。「接下来」在主题的专用列表里时节头写它，
   * 在别的列表里时写那张列表的名字。
   */
  readonly source: Atom<PlaybackSource | null>;
  /** 主题起播用的专用列表的名字：这张表的名字不出现在界面上。 */
  readonly libraryList: string;
  /** 去来源的家并定位到正在播放这一首，进历史。 */
  openSource(): void;
  /** 去这张播放列表，进历史。 */
  openPlaylist(guid: string): void;
  /**
   * 去这一首的专辑详情页的动作，进历史；媒体库里找不到这张专辑（还没读完、或不在库里）时为 null，
   * 专辑名就不是链接、菜单里「转到专辑」置灰。
   */
  albumOpener(track: AlbumTrack): (() => void) | null;
  /** 去这一首的艺人页的动作；艺人页还没有时为 null。 */
  artistOpener(track: AlbumTrack): (() => void) | null;
}

export interface QueueCommands {
  /** 按句柄入队，`next` 插在队首，`last` 接在队尾。 */
  enqueue(handles: readonly string[], place: EnqueuePlace): Promise<boolean>;
  /** 从这张列表的这一行起播，留住队列；这一行已不是 `handle` 那一首时不起播。 */
  playFrom(guid: string, row: number, handle: string): Promise<boolean>;
  playHandle(handle: string): Promise<boolean>;
}

export interface RightCardServices {
  readonly card: RightCardService;
  readonly queue: QueueStateService;
  readonly upNext: UpNextService;
  readonly actions: QueueActions;
  readonly commands: QueueCommands;
  readonly covers: QueueCoversService;
  readonly menu: QueueMenuService;
  readonly review: QueueReviewService;
  readonly deps: RightCardServicesDeps;
  dispose(): void;
}

export function startRightCardServices(
  store: Store,
  deps: RightCardServicesDeps,
  host: typeof fb = fb,
): RightCardServices {
  const card = startRightCard(store, { wide: deps.wide });
  const queue = startQueueState(store, host);
  const upNext = startUpNext(
    store,
    { order: deps.order, stopped: deps.stopped, queue: queueViewAtom },
    host,
  );
  const review = startQueueReview(store, host);
  const actions = createQueueActions(store, queue, host);
  const covers = startQueueCovers(store, host);
  const menu = startQueueMenu(store, host);
  return {
    card,
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
      card.dispose();
    },
  };
}

export const rightCardKey = serviceKey<RightCardServices>('rightCard');
