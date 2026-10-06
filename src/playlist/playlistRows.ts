import type { MetadbChangedPayload } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import { waitForHost } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import type { PlaylistRow } from './playlistRow.ts';
import {
  IDLE_ROWS,
  PlaylistRowSource,
  type PlaylistRowsFace,
  type PlaylistRowsState,
} from './playlistRowSource.ts';
import { playlistsAtom, type PlaylistsState } from '../playback/playlists.ts';
import type { RowSpan } from './rowPages.ts';
import { serviceKey } from '../kit/serviceKey.ts';

export interface PlaylistRowsDeps {
  /** 评分服务的戳，见 `TrackRatingsService.stamp`：每个取页请求发出之前拿一次。 */
  readonly stamp: () => number;
  /** 评分事件没报全时变的信号（`ratingsRefetchAtom`）：变了就把正在看的列表重取。 */
  readonly refetch: Atom<number>;
}

export interface PlaylistRowsService {
  readonly ready: Promise<void>;
  /** 一张列表的行状态；同一 GUID 总是同一个原子，没有页面要它时是 `idle`。 */
  stateOf(guid: string): Atom<PlaylistRowsState>;
  /** 页面挂上时调，开始取这张列表的行；返回的函数在页面卸下时调，调几次都只算一次。 */
  acquire(guid: string): () => void;
  /** 缓存里的一行，不触发取数；没取到时为 undefined，作废后还没取回时是旧的那一行。 */
  rowAt(guid: string, row: number): PlaylistRow | undefined;
  /**
   * 这一行取数之前拿的评分戳，问 `TrackRatingsService.ratingOf` 时带上；没取到时为 undefined。各页取数的时刻
   * 不同，戳按页各有一个，旧页留着显示时仍是它自己的戳。
   */
  stampAt(guid: string, row: number): number | undefined;
  /**
   * 这一行取到了，而且取回之后宿主没有增删、重排过行，行号与行对得上。旧页留着显示时行号可能已经挪了：
   * 按行号与分组游程、封面采样点配对的先问它。
   */
  currentAt(guid: string, row: number): boolean;
  /** 视口里是这几段行（见 `RowPages.view`）：取缺的页并往两头预取。 */
  want(guid: string, spans: readonly RowSpan[]): void;
  /** 再试一次取失败的页。 */
  retry(guid: string): void;
  dispose(): void;
}

interface Slot {
  readonly own: PrimitiveAtom<PlaylistRowsState>;
  readonly view: Atom<PlaylistRowsState>;
}

interface Held {
  readonly source: PlaylistRowSource;
  holders: number;
}

/**
 * 播放列表页的行：哪几张列表有页面在看，宿主的事件落到哪一张。每张的取数与缓存归 `PlaylistRowSource`。
 *
 * 内容事件只带列表序号，按此刻的清单换回 GUID；建、删、重排列表之后到清单读回之前，序号对不上，这期间的内容
 * 事件当作命中每一张正在看的列表。改标签没有列表事件，看 `metadb:changed`：报的曲目在缓存里、或者没报全
 * （一次至多报 50 首），就重取，但不算行的增删。列表在不在以宿主为准：清单读回后不在里面的去重取一次，宿主
 * 答不存在才记成已删除，刚建好、清单还没带回的列表不会被误判。
 *
 * 同一张列表同时被几个页面要（切换动画里离场与入场的两层）时共用一份，都放手后丢掉。
 */
export function startPlaylistRows(
  store: Store,
  deps: PlaylistRowsDeps,
  host: PlaylistRowsFace = fb,
): PlaylistRowsService {
  let disposed = false;
  let connected = false;
  let unreachable = false;
  // 清单读到这一版为止序号不可信：还没读过，或者读完之后又建、删、重排过列表。
  let untrustedUpTo = 0;
  // 已经按哪一版清单核对过各列表在不在；清单的失败标记等变了而版本没动时不再核对。
  let checkedRevision = 0;
  const slots = new Map<string, Slot>();
  const held = new Map<string, Held>();
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);
  const context = { store, host, stamp: deps.stamp, connected: () => connected };

  function slotOf(guid: string): Slot {
    let slot = slots.get(guid);
    if (!slot) {
      const own = atom(IDLE_ROWS);
      slot = { own, view: atom((get) => get(own)) };
      slots.set(guid, slot);
    }
    return slot;
  }
  const sources = () => [...held.values()].map((entry) => entry.source);

  /** 内容事件命中了哪些列表：序号可信时按清单认那一张，不可信时算全部。 */
  function sourcesAt(index: number): PlaylistRowSource[] {
    const lists = store.get(playlistsAtom);
    if (lists.revision <= untrustedUpTo) return sources();
    const guid = lists.items.find((item) => item.index === index)?.guid;
    const entry = guid === undefined ? undefined : held.get(guid);
    return entry ? [entry.source] : [];
  }

  function onMetadb(payload: MetadbChangedPayload): void {
    const partial = payload.count > payload.tracks.length;
    const handles = new Set(payload.tracks.map((track) => track.handle));
    for (const source of sources()) {
      if (partial || source.holds(handles)) source.invalidateSoon(false);
    }
  }

  function onPlaylists(lists: PlaylistsState): void {
    if (lists.status !== 'connected' || lists.revision <= checkedRevision) return;
    checkedRevision = lists.revision;
    for (const source of sources()) {
      const listed = lists.items.some((item) => item.guid === source.guid);
      if (listed) source.revive();
      else source.invalidate(true);
    }
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      unreachable = true;
      for (const source of sources()) source.start(0, false);
      return;
    }
    const onContent = ({ playlist }: { readonly playlist: number }) => {
      for (const source of sourcesAt(playlist)) source.invalidateSoon(true);
    };
    const onStructure = () => {
      untrustedUpTo = store.get(playlistsAtom).revision;
    };
    // 先订阅再取行，两者之间的变化才不会漏。
    offs.push(
      host.on('playlist:itemsAdded', onContent),
      host.on('playlist:itemsRemoved', onContent),
      host.on('playlist:itemsReordered', onContent),
      host.on('playlist:itemsReplaced', onContent),
      host.on('playlist:created', onStructure),
      host.on('playlist:removed', onStructure),
      host.on('playlist:reordered', onStructure),
      host.on('metadb:changed', onMetadb),
      store.sub(deps.refetch, () => {
        for (const source of sources()) source.invalidateSoon(false);
      }),
      store.sub(playlistsAtom, () => onPlaylists(store.get(playlistsAtom))),
    );
    checkedRevision = store.get(playlistsAtom).revision;
    connected = true;
    for (const source of sources()) source.pump();
  }

  function open(guid: string): Held {
    const entry: Held = {
      source: new PlaylistRowSource(guid, slotOf(guid).own, context),
      holders: 0,
    };
    held.set(guid, entry);
    const listed = store.get(playlistsAtom).items.find((item) => item.guid === guid);
    entry.source.start(listed?.trackCount ?? 0, !unreachable);
    return entry;
  }

  return {
    ready: connect(),
    stateOf: (guid) => slotOf(guid).view,
    acquire(guid) {
      if (disposed) return () => {};
      const entry = held.get(guid) ?? open(guid);
      entry.holders += 1;
      let holding = true;
      return () => {
        if (!holding) return;
        holding = false;
        entry.holders -= 1;
        // 晚一个微任务再丢：页面在同一次提交里卸下又挂上（StrictMode 的二次 effect）时缓存留着。
        queueMicrotask(() => {
          if (disposed || entry.holders > 0 || held.get(guid) !== entry) return;
          held.delete(guid);
          entry.source.close();
        });
      };
    },
    rowAt: (guid, row) => held.get(guid)?.source.rowAt(row),
    stampAt: (guid, row) => held.get(guid)?.source.stampAt(row),
    currentAt: (guid, row) => held.get(guid)?.source.currentAt(row) ?? false,
    want: (guid, spans) => held.get(guid)?.source.want(spans),
    retry: (guid) => held.get(guid)?.source.retry(),
    dispose() {
      disposed = true;
      waiter.cancel();
      for (const source of sources()) source.close();
      held.clear();
      for (const off of offs.splice(0)) off();
    },
  };
}

export const playlistRowsKey = serviceKey<PlaylistRowsService>('playlistRows');
