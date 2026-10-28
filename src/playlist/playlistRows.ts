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
  /** 评分服务时间戳生成器（对应 `TrackRatingsService.stamp`）：每次拉取页面数据前生成时间戳 */
  readonly stamp: () => number;
  /** 评分事件未完整回报的重拉信号（`ratingsRefetchAtom`）：信号变化时刷新当前可视列表 */
  readonly refetch: Atom<number>;
}

export interface PlaylistRowsService {
  readonly ready: Promise<void>;
  /** 列表行状态原子；同一 GUID 对应唯一原子引用，无页面订阅时处于 idle 状态 */
  stateOf(guid: string): Atom<PlaylistRowsState>;
  /** 页面挂载时调用以订阅该列表数据；返回取消订阅的回调（多次调用幂等） */
  acquire(guid: string): () => void;
  /** 读取缓存行数据（不触发网络/IPC 请求）；未就绪返回 undefined，刷新过渡期返回旧快照 */
  rowAt(guid: string, row: number): PlaylistRow | undefined;
  /**
   * 获取对应行拉取时绑定的评分时间戳，供 `TrackRatingsService.ratingOf` 校验；
   * 各分页拉取时点不同，时间戳按分页独立维护
   */
  stampAt(guid: string, row: number): number | undefined;
  /**
   * 校验缓存行是否严格匹配最新宿主版本（未发生增删或重排）；供分组游程与封面采样点安全对齐
   */
  currentAt(guid: string, row: number): boolean;
  /** 视口请求指定行区间（`RowPages.view`）：拉取缺失分页并双向预取邻近页 */
  want(guid: string, spans: readonly RowSpan[]): void;
  /** 重试拉取失败的分页 */
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
 * 播放列表行数据调度服务：管理活跃列表订阅，将宿主事件分发至对应的 `PlaylistRowSource`
 *
 * 内容事件仅携带列表索引，依据当前清单映射为 GUID；在增删重排列表至清单重新读回的过渡期内，
 * 广播事件按全量命中处理。元数据变更依据 `metadb:changed` 触发重拉缓存
 * 同一列表若被多个视图共享（如转场动画），共用同一份缓存实例；所有视图注销后释放
 */
export function startPlaylistRows(
  store: Store,
  deps: PlaylistRowsDeps,
  host: PlaylistRowsFace = fb,
): PlaylistRowsService {
  let disposed = false;
  let connected = false;
  let unreachable = false;
  // 清单读到这一版为止序号不可信：还没读过，或者读完之后又建、删、重排过列表
  let untrustedUpTo = 0;
  // 已经按哪一版清单核对过各列表在不在；清单的失败标记等变了而版本没动时不再核对
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

  /** 内容事件命中了哪些列表：序号可信时按清单认那一张，不可信时算全部 */
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
    // 先订阅再取行，两者之间的变化才不会漏
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
        // 晚一个微任务再丢：页面在同一次提交里卸下又挂上（StrictMode 的二次 effect）时缓存留着
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
