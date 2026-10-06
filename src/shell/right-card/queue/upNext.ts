import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../../host/waitForHost.ts';
import type { Store } from '../../../kit/store.ts';
import type { QueueSpot, QueueView } from './queueState.ts';
import { EMPTY_UP_NEXT, type UpNextView, type UpNextRow } from './upNextModel.ts';
import { createUpNextPages } from './upNextPages.ts';

export interface UpNextFace extends HostReadyFace {
  on: typeof fb.on;
  player: Pick<typeof fb.player, 'getCurrentTrackIndex'>;
  config: Pick<typeof fb.config, 'getPlaybackFollowCursor'>;
  playlist: Pick<typeof fb.playlist, 'getAll' | 'getTracks'>;
}

/** 推「接下来」要读的几样，由装配处从播放服务与队列服务交进来。 */
export interface UpNextDeps {
  /** 播放顺序的名字，没读到时为 null。 */
  readonly order: Atom<string | null>;
  readonly stopped: Atom<boolean>;
  readonly queue: Atom<QueueView>;
}

export { UP_NEXT_FIELDS, UP_NEXT_PAGE_SIZE } from './upNextModel.ts';
export type { UpNextRow, UpNextTrack, UpNextView } from './upNextModel.ts';

const viewAtom = atom<UpNextView>(EMPTY_UP_NEXT);
const earlierAtom = atom<UpNextView>(EMPTY_UP_NEXT);

export const upNextAtom: Atom<UpNextView> = atom((get) => get(viewAtom));
/**
 * 正在播的这一首在它的列表里排在第几行，排在前面的那几行（第 0 行到它前一行）。偏移就是行号；
 * `currentCount` 与 `total` 都是它前面的行数。推不出「接下来」时这一段也不出，播列表外的曲目时也不出。
 */
export const upEarlierAtom: Atom<UpNextView> = atom((get) => get(earlierAtom));

/** 推得出下一首的两种顺序；其余几种随机，单曲循环只重播当前这首。 */
const PREDICTABLE = new Set(['default', 'repeat-playlist']);

const ITEM_EVENTS = [
  'playlist:itemsAdded',
  'playlist:itemsRemoved',
  'playlist:itemsReordered',
  'playlist:itemsReplaced',
] as const;
const LIST_EVENTS = ['playlist:created', 'playlist:removed', 'playlist:reordered'] as const;

interface ResumeSpot extends QueueSpot {
  readonly handle?: string;
  readonly key?: string;
}

export interface UpNextService {
  readonly ready: Promise<void>;
  readRange(first: number, last: number, retry?: boolean): Promise<void>;
  readSelection(offsets: readonly number[], version: number): Promise<UpNextRow[] | null>;
  /** 前面那一段按行号读，规则同 `readRange`。 */
  readEarlier(first: number, last: number, retry?: boolean): Promise<void>;
  dispose(): void;
}

/**
 * 「接下来」：队列播完之后核心会接着播的曲目，按正在播放的列表推出来，只读。
 *
 * 起点是续播起点：播列表里的曲目时就是它那一行（`getCurrentTrackIndex`）；队列里若有带列表位置的条目，
 * 播完它们后起点跟到最后一条的位置，可能换到另一张列表。从起点的下一行往下列，重复列表到末尾绕回开头。
 *
 * 推不出或推不准时这一段不出：随机类顺序与单曲循环；开了「播放跟随光标」（下一首可能是焦点所在的那行）；
 * 停止时；以及播列表外的曲目（只带句柄的队列条目）期间，宿主不报起点，用之前记下的那一行，这期间起点
 * 所在的列表被改过、或列表的序号挪过，就不再信它，等播回列表里的曲目再推。
 */
export function startUpNext(store: Store, deps: UpNextDeps, host: UpNextFace = fb): UpNextService {
  store.set(viewAtom, { ...EMPTY_UP_NEXT, refreshing: true });
  store.set(earlierAtom, EMPTY_UP_NEXT);
  let disposed = false;
  let generation = 0;
  // 读起点的代次与推算的代次分开：起点只由换曲、列表变动推进，推算还被顺序、队列这些推进。
  let anchorGeneration = 0;
  let readingAnchor = false;
  let anchor: QueueSpot | null = null;
  // 正在播的不在任何列表里，起点是之前记下的。
  let outside = false;
  // 播列表外的曲目期间起点所在的列表变过，记下的那一行不再可信。
  let drifted = false;
  let followCursor: boolean | null = null;
  let computedSpot: ResumeSpot | null = null;
  let queuedSource: { key: string; guid: string } | null = null;
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  // 换曲时「接下来」少一行、前面那一段多一行；一段读好了先等另一段，两段同一刻换上，滚动高度与阅读锚点
  // 不在中途错开。还在读的那一段照常发布（只是标着刷新，行与总数不变）。
  let nextView = store.get(viewAtom);
  let earlierView = store.get(earlierAtom);
  const sync = () => {
    if (disposed) return;
    const settled = !nextView.refreshing && !earlierView.refreshing;
    if (settled || nextView.refreshing) store.set(viewAtom, nextView);
    if (settled || earlierView.refreshing) store.set(earlierAtom, earlierView);
  };
  const pages = createUpNextPages(host.playlist, (view) => {
    nextView = view;
    sync();
  });
  const earlier = createUpNextPages(
    host.playlist,
    (view) => {
      earlierView = view;
      sync();
    },
    { lazy: true },
  );

  function startSpot(): ResumeSpot | null {
    const { entries } = store.get(deps.queue);
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry?.spot) return { ...entry.spot, handle: entry.track.handle, key: entry.key };
    }
    return anchor;
  }

  /** 几次读同时在路上时只认最后发出的那次，晚到的旧应答不盖掉新的起点。 */
  async function readAnchor(): Promise<boolean> {
    const mine = ++anchorGeneration;
    readingAnchor = true;
    const answer = await settle(() => host.player.getCurrentTrackIndex());
    if (disposed || mine !== anchorGeneration) return false;
    readingAnchor = false;
    if (answer?.success !== true) {
      anchor = null;
      return true;
    }
    if (answer.found && answer.playlist !== null && answer.index !== null) {
      anchor = { playlist: answer.playlist, row: answer.index };
      outside = false;
      drifted = false;
    } else {
      outside = anchor !== null;
    }
    return true;
  }

  const resetBoth = () => {
    pages.reset(null);
    earlier.reset(null);
  };

  async function recompute(): Promise<void> {
    if (disposed) return;
    const mine = ++generation;
    pages.suspend();
    earlier.suspend();
    const order = store.get(deps.order);
    if (
      order === null ||
      !PREDICTABLE.has(order) ||
      store.get(deps.stopped) ||
      followCursor !== false ||
      drifted
    ) {
      resetBoth();
      return;
    }
    if (readingAnchor) return;
    const start = startSpot();
    computedSpot = start;
    if (!start) {
      resetBoth();
      return;
    }
    const all = await settle(() => host.playlist.getAll());
    if (disposed || mine !== generation) return;
    const lists = all?.success === true ? all.playlists : [];
    const list = lists.find((playlist) => playlist.index === start.playlist);
    if (!list || start.row < 0 || start.row >= list.trackCount) {
      resetBoth();
      return;
    }

    if (start.handle && start.key) {
      // 外部条目的列表序号与行号可能过时；身份不符时停止推算，不把另一首的后续当作来源。
      if (queuedSource?.key === start.key && queuedSource.guid !== list.guid) {
        resetBoth();
        return;
      }
      const page = await settle(() =>
        host.playlist.getTracks(list.guid, start.row, 1, undefined, ['handle']),
      );
      if (disposed || mine !== generation) return;
      if (page?.success !== true || page.tracks[0]?.handle !== start.handle) {
        resetBoth();
        return;
      }
      queuedSource = { key: start.key, guid: list.guid };
    } else queuedSource = null;
    // 前面那一段跟着正在播的这一行，不跟续播起点：队列里排着别处的曲目时两者不在同一张列表。
    const playing = outside ? undefined : lists.find((item) => item.index === anchor?.playlist);
    const row = anchor?.row ?? -1;
    if (playing && row > 0 && row < playing.trackCount)
      void earlier.replace({
        list: { guid: playing.guid, index: playing.index, name: playing.name },
        count: playing.trackCount,
        after: 0,
        total: row,
      });
    else earlier.reset(null);
    const after = start.row + 1;
    const total = order === 'repeat-playlist' ? list.trackCount : list.trackCount - after;
    await pages.replace({
      list: { guid: list.guid, index: list.index, name: list.name },
      count: list.trackCount,
      after,
      total,
    });
  }

  const refresh = async (moved: boolean) => {
    // 换曲已发生、起点尚未答回时，旧的续读也不能再落值。
    generation++;
    pages.suspend();
    earlier.suspend();
    if (outside && moved) drifted = true;
    else if (!(await readAnchor())) return;
    await recompute();
  };

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed || !arrived) return;
    offs.push(
      host.on('playback:trackChanged', () => void refresh(false)),
      host.on('playback:followCursorChanged', ({ enabled }) => {
        followCursor = enabled;
        void recompute();
      }),
      ...ITEM_EVENTS.map((event) =>
        host.on(event, ({ playlist }) => {
          if (playlist === anchor?.playlist || playlist === startSpot()?.playlist) {
            void refresh(true);
          }
        }),
      ),
      ...LIST_EVENTS.map((event) => host.on(event, () => void refresh(true))),
      host.on('playlist:renamed', () => void recompute()),
      store.sub(deps.order, () => void recompute()),
      store.sub(deps.stopped, () => void refresh(false)),
      store.sub(deps.queue, () => {
        const next = startSpot();
        // 手动队列读回与状态刷新不改变续播起点时，保留滚动高度和已读页。
        if (
          next?.playlist !== computedSpot?.playlist ||
          next?.row !== computedSpot?.row ||
          next?.handle !== computedSpot?.handle ||
          next?.key !== computedSpot?.key
        )
          void recompute();
      }),
    );
    const follow = await settle(() => host.config.getPlaybackFollowCursor());
    if (disposed) return;
    // 事件已给出当前值时，初读的旧值不再可信。
    if (followCursor === null && follow?.success === true) followCursor = follow.enabled;
    await readAnchor();
    await recompute();
  }

  return {
    ready: connect(),
    readRange: pages.readRange,
    readSelection: pages.readSelection,
    readEarlier: earlier.readRange,
    dispose() {
      disposed = true;
      pages.dispose();
      earlier.dispose();
      waiter.cancel();
      for (const off of offs.splice(0)) off();
    },
  };
}
