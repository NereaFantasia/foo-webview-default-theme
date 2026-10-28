import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { MusicListKind, MusicSearchItems } from '../server/musicProtocol.ts';
import type { MusicRef, MusicTrack } from '../server/musicObjects.ts';
import { MusicClientError, type MusicClient, type MusicClientFailureCode } from './musicClient.ts';

/** 没有页面在看、还留着曲目的列表张数：后退、前进回到这几张时不必再等 */
const KEEP = 4;

/** 一张在线列表：专辑、歌单（含榜单）或艺人的热门曲目 */
export interface OnlineList {
  readonly kind: MusicListKind;
  readonly ref: MusicRef;
}

export interface OnlineListState {
  /** failed 只指第一页没取到，续页失败记在 `moreFailed` */
  readonly phase: 'loading' | 'ready' | 'failed';
  readonly failure: MusicClientFailureCode | null;
  /** 列表本身；第一页到之前为 null，续页时换成新取到的 */
  readonly owner: MusicSearchItems[MusicListKind] | null;
  /** 已取到的曲目，按上游顺序 */
  readonly items: readonly MusicTrack[];
  readonly total: number | null;
  /** 还能接着取时是下一页的游标；只有歌单会有 */
  readonly cursor: string | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

const LOADING: OnlineListState = {
  phase: 'loading',
  failure: null,
  owner: null,
  items: [],
  total: null,
  cursor: null,
  loadingMore: false,
  moreFailed: false,
};

export const onlineListKey = (list: OnlineList) =>
  JSON.stringify([list.ref.platform, list.kind, list.ref.id]);

export interface OnlineListsService {
  /** 各张列表的数据，按 `onlineListKey` */
  readonly lists: Atom<ReadonlyMap<string, OnlineListState>>;
  /**
   * 页面挂上时要这张的数据，返回放手函数。手上没有或第一页失败了就去取；几个页面同时要同一张（切换动画里的
   * 新旧两层）共用一份。都放手后先留着，至多留 `KEEP` 张
   */
  want(list: OnlineList): () => void;
  /** 第一页失败时重取；续页失败时重取下一页 */
  retry(list: OnlineList): void;
  /** 接着取下一页；第一页还没到、没有下一页或正在取时不动 */
  more(list: OnlineList): Promise<void>;
  /**
   * 已取到的曲目；手上没有就取第一页（歌单只取第一页，不把剩下的取完）。取不到答 null；没人要的结果照常
   * 留进缓存
   */
  tracks(list: OnlineList): Promise<readonly MusicTrack[] | null>;
  dispose(): void;
}

function failureOf(error: unknown): MusicClientFailureCode {
  return error instanceof MusicClientError ? error.code : 'backend-unavailable';
}

/**
 * 在线列表页与对象菜单共用的列表数据。每张列表自己的请求可单独取消：被丢掉或释放时作废，晚到的应答不落
 * 续页按曲目身份去重，平台偶尔会把上一页的条目再给一次
 * `port` 是本地后端连上的端口：页面载入时后端常还没连上，有页面在看、因此没取到的列表在连上后自己重取；
 * 上游失败不自动重取，免得撞上平台的频率限制
 */
export function startOnlineLists(
  store: Store,
  client: Pick<MusicClient, 'list'>,
  port?: Atom<number | null>,
): OnlineListsService {
  const lists = atom<ReadonlyMap<string, OnlineListState>>(new Map());
  /** 各张有几个页面在看、最近一次放手是第几次、这一轮请求的取消信号与第一页的等待 */
  const holders = new Map<
    string,
    {
      readonly list: OnlineList;
      count: number;
      released: number;
      round: AbortController;
      first: Promise<void> | null;
    }
  >();
  let releases = 0;
  let disposed = false;

  const recordOf = (list: OnlineList) => {
    const key = onlineListKey(list);
    let record = holders.get(key);
    if (!record)
      holders.set(
        key,
        (record = { list, count: 0, released: 0, round: new AbortController(), first: null }),
      );
    return record;
  };
  function patch(key: string, signal: AbortSignal, change: Partial<OnlineListState>): void {
    if (disposed || signal.aborted) return;
    const next = new Map(store.get(lists));
    next.set(key, { ...LOADING, ...next.get(key), ...change });
    store.set(lists, next);
  }

  function load(list: OnlineList): Promise<void> {
    const key = onlineListKey(list);
    const record = recordOf(list);
    const state = store.get(lists).get(key);
    if (record.first && state?.phase === 'loading') return record.first;
    if (state && state.phase !== 'failed') return Promise.resolve();
    const signal = record.round.signal;
    patch(key, signal, { ...LOADING });
    record.first = client.list({ kind: list.kind, ref: list.ref, cursor: null }, { signal }).then(
      (page) =>
        patch(key, signal, {
          phase: 'ready',
          owner: page.owner,
          items: page.items,
          total: page.total,
          cursor: page.nextCursor,
        }),
      (error: unknown) => patch(key, signal, { phase: 'failed', failure: failureOf(error) }),
    );
    return record.first;
  }

  function drop(key: string): void {
    const record = holders.get(key);
    record?.round.abort();
    holders.delete(key);
    const next = new Map(store.get(lists));
    next.delete(key);
    store.set(lists, next);
  }
  /** 没人看的从最早放手的起丢，丢到只剩 `KEEP` 张 */
  function prune(): void {
    const idle = [...store.get(lists).keys()]
      .filter((key) => (holders.get(key)?.count ?? 0) === 0)
      .sort((a, b) => (holders.get(a)?.released ?? 0) - (holders.get(b)?.released ?? 0));
    for (const key of idle.slice(0, Math.max(0, idle.length - KEEP))) drop(key);
  }

  async function more(list: OnlineList): Promise<void> {
    const key = onlineListKey(list);
    const state = store.get(lists).get(key);
    if (state?.phase !== 'ready' || state.cursor === null || state.loadingMore) return;
    const signal = recordOf(list).round.signal;
    patch(key, signal, { loadingMore: true, moreFailed: false });
    try {
      const page = await client.list(
        { kind: list.kind, ref: list.ref, cursor: state.cursor },
        { signal },
      );
      const current = store.get(lists).get(key) ?? state;
      const seen = new Set(current.items.map((track) => track.ref.id));
      patch(key, signal, {
        owner: page.owner,
        items: [...current.items, ...page.items.filter((track) => !seen.has(track.ref.id))],
        total: page.total ?? current.total,
        cursor: page.nextCursor,
        loadingMore: false,
      });
    } catch {
      patch(key, signal, { loadingMore: false, moreFailed: true });
    }
  }

  const stop = port
    ? store.sub(port, () => {
        if (store.get(port) === null) return;
        for (const [key, state] of store.get(lists)) {
          const record = holders.get(key);
          if (record?.count && state.phase === 'failed' && state.failure === 'backend-unavailable')
            void load(record.list);
        }
      })
    : undefined;

  return {
    lists,
    want(list) {
      const record = recordOf(list);
      record.count += 1;
      void load(list);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        record.count -= 1;
        if (record.count === 0) record.released = ++releases;
        prune();
      };
    },
    retry(list) {
      const state = store.get(lists).get(onlineListKey(list));
      if (state?.phase === 'failed') void load(list);
      else if (state?.moreFailed) void more(list);
    },
    more,
    async tracks(list) {
      const key = onlineListKey(list);
      await load(list);
      const state = store.get(lists).get(key);
      if ((holders.get(key)?.count ?? 0) === 0) {
        const record = recordOf(list);
        if (!record.released) record.released = ++releases;
        prune();
      }
      return state?.phase === 'ready' ? state.items : null;
    },
    dispose() {
      disposed = true;
      stop?.();
      for (const record of holders.values()) record.round.abort();
      holders.clear();
    },
  };
}

export const onlineListsKey = serviceKey<OnlineListsService>('onlineLists');
