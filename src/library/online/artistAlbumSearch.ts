import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { Store } from '../../kit/store.ts';
import {
  MusicClientError,
  type MusicClient,
  type MusicClientFailureCode,
} from '../../playback/musicClient.ts';
import type { MusicAlbum, MusicRef } from '../../server/musicObjects.ts';

/** 缓存结果保留上限；无活跃消费者时保留最近查询结果以供回切复用 */
const KEEP = 6;
/** 初始自动连续拉取的分页上限 */
const AUTO_PAGES = 3;

/** 艺人指定关键词在线专辑检索状态 */
export interface ArtistAlbumSearchState {
  /** 首页请求失败标记为 failed，后续分页失败标记为 moreFailed */
  readonly phase: 'searching' | 'ready' | 'failed';
  readonly failure: MusicClientFailureCode | null;
  /** 检索结果中含目标艺人署名的去重专辑集合 */
  readonly albums: readonly MusicAlbum[];
  /** 续页检索游标；为 null 表示已无更多结果 */
  readonly cursor: string | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

const SEARCHING: ArtistAlbumSearchState = {
  phase: 'searching',
  failure: null,
  albums: [],
  cursor: null,
  loadingMore: false,
  moreFailed: false,
};

export interface ArtistAlbumQuery {
  readonly artist: MusicRef;
  /** 艺人展示名称；与检索词组合拼接以在平台专辑全局搜索中限定匹配范围 */
  readonly name: string;
  readonly text: string;
}

export const artistAlbumSearchKeyOf = ({ artist, text }: ArtistAlbumQuery) =>
  JSON.stringify([artist.platform, artist.id, text]);

export interface ArtistAlbumSearchService {
  /** 各查询状态字典映射，键为 artistAlbumSearchKeyOf 生成的复合键 */
  readonly searches: Atom<ReadonlyMap<string, ArtistAlbumSearchState>>;
  /**
   * 订阅指定查询的检索结果；返回释放清理函数
   * 无有效缓存时发起请求并自动拉取至多 AUTO_PAGES 页；多处调用共享同一检索状态，全部释放后终止后续翻页
   */
  want(query: ArtistAlbumQuery): () => void;
  /** 重试检索；首屏失败时重新查询，翻页失败时从当前断点续取 */
  retry(query: ArtistAlbumQuery): void;
  /** 异步拉取下一页检索结果 */
  more(query: ArtistAlbumQuery): void;
  dispose(): void;
}

function failureOf(error: unknown): MusicClientFailureCode {
  return error instanceof MusicClientError ? error.code : 'backend-unavailable';
}

const sameRef = (left: MusicRef, right: MusicRef) =>
  left.platform === right.platform && left.id === right.id;

/**
 * 在线艺人专辑联网检索补充服务
 *
 * 针对上游未全量枚举专辑的艺人发起平台全局专辑检索（格式为「艺人名 查询词」）；
 * 客户端过滤保留含目标艺人署名的条目，保证单次并发单页请求以适配上游频控限制，支持结果取消与过期丢弃
 */
export function startArtistAlbumSearch(
  store: Store,
  client: Pick<MusicClient, 'search'>,
): ArtistAlbumSearchService {
  const searches = atom<ReadonlyMap<string, ArtistAlbumSearchState>>(new Map());
  /** 查询持有者状态簿（记录引用计数、释放代次、中止控制器与预取配额） */
  const holders = new Map<
    string,
    {
      readonly query: ArtistAlbumQuery;
      count: number;
      released: number;
      round: AbortController;
      running: Promise<void> | null;
      budget: number;
    }
  >();
  let releases = 0;
  let disposed = false;

  const recordOf = (query: ArtistAlbumQuery) => {
    const key = artistAlbumSearchKeyOf(query);
    let record = holders.get(key);
    if (!record)
      holders.set(
        key,
        (record = {
          query,
          count: 0,
          released: 0,
          round: new AbortController(),
          running: null,
          budget: AUTO_PAGES,
        }),
      );
    return record;
  };
  function patch(key: string, signal: AbortSignal, change: Partial<ArtistAlbumSearchState>): void {
    if (disposed || signal.aborted) return;
    const next = new Map(store.get(searches));
    next.set(key, { ...SEARCHING, ...next.get(key), ...change });
    store.set(searches, next);
  }

  /** 从断处往下取，直到没有下一页、用完这一轮的页数、失败或没人再看 */
  async function pull(record: ReturnType<typeof recordOf>): Promise<void> {
    const { artist, name, text } = record.query;
    const key = artistAlbumSearchKeyOf(record.query);
    const signal = record.round.signal;
    for (;;) {
      const state = store.get(searches).get(key);
      const ready = state?.phase === 'ready' ? state : null;
      if (ready && (ready.cursor === null || record.count === 0 || record.budget <= 0)) {
        patch(key, signal, { loadingMore: false });
        return;
      }
      record.budget -= 1;
      patch(key, signal, ready ? { loadingMore: true, moreFailed: false } : { ...SEARCHING });
      try {
        const page = await client.search(
          {
            platform: artist.platform,
            kind: 'album',
            query: `${name} ${text}`,
            cursor: ready ? ready.cursor : null,
          },
          { signal },
        );
        if (signal.aborted) return;
        const current = ready ? (store.get(searches).get(key) ?? ready) : SEARCHING;
        const seen = new Set(current.albums.map((album) => album.ref.id));
        const hits = page.items.filter(
          (album) =>
            !seen.has(album.ref.id) &&
            album.artists.some((credit) => credit.ref !== null && sameRef(credit.ref, artist)),
        );
        patch(key, signal, {
          phase: 'ready',
          failure: null,
          albums: [...current.albums, ...hits],
          cursor: page.nextCursor,
          loadingMore: false,
        });
      } catch (error) {
        if (signal.aborted) return;
        patch(
          key,
          signal,
          ready
            ? { loadingMore: false, moreFailed: true }
            : { phase: 'failed', failure: failureOf(error) },
        );
        return;
      }
    }
  }

  function load(query: ArtistAlbumQuery): void {
    const record = recordOf(query);
    if (record.running) return;
    const state = store.get(searches).get(artistAlbumSearchKeyOf(query));
    // 取完、这一轮的页数用完、或后面的页失败的不自己动：等用户点加载更多或重试
    if (
      state?.phase === 'ready' &&
      (state.cursor === null || state.moreFailed || record.budget <= 0)
    )
      return;
    const running = pull(record).finally(() => {
      if (record.running === running) record.running = null;
    });
    record.running = running;
  }

  function drop(key: string): void {
    holders.get(key)?.round.abort();
    holders.delete(key);
    const next = new Map(store.get(searches));
    next.delete(key);
    store.set(searches, next);
  }
  /** 没人看的从最早放手的起丢，丢到只剩 `KEEP` 个 */
  function prune(): void {
    const idle = [...store.get(searches).keys()]
      .filter((key) => (holders.get(key)?.count ?? 0) === 0)
      .sort((a, b) => (holders.get(a)?.released ?? 0) - (holders.get(b)?.released ?? 0));
    for (const key of idle.slice(0, Math.max(0, idle.length - KEEP))) drop(key);
  }

  return {
    searches,
    want(query) {
      const record = recordOf(query);
      record.count += 1;
      load(query);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        record.count -= 1;
        if (record.count === 0) record.released = ++releases;
        prune();
      };
    },
    retry(query) {
      const key = artistAlbumSearchKeyOf(query);
      const state = store.get(searches).get(key);
      const record = recordOf(query);
      if (state?.phase === 'failed') record.budget = AUTO_PAGES;
      else if (state?.moreFailed) {
        record.budget = 1;
        patch(key, record.round.signal, { moreFailed: false });
      } else return;
      load(query);
    },
    more(query) {
      const state = store.get(searches).get(artistAlbumSearchKeyOf(query));
      if (state?.phase !== 'ready' || state.cursor === null || state.loadingMore) return;
      recordOf(query).budget = 1;
      load(query);
    },
    dispose() {
      disposed = true;
      for (const record of holders.values()) record.round.abort();
      holders.clear();
    },
  };
}

export const artistAlbumSearchKey = serviceKey<ArtistAlbumSearchService>('artistAlbumSearch');
