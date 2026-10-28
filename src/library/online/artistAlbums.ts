import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { Store } from '../../kit/store.ts';
import {
  MusicClientError,
  type MusicClient,
  type MusicClientFailureCode,
} from '../../playback/musicClient.ts';
import type { MusicAlbum, MusicRef } from '../../server/musicObjects.ts';

/** 退出艺人页后保留专辑缓存的最大艺人数；返回时无需重复请求 */
const KEEP = 4;
/** 挂载后自动取的专辑数；再往后由滚动到底触发续取，免得一进页面就连发上百个请求 */
export const ARTIST_ALBUMS_EAGER = 1000;
/** 单个艺人允许获取与保留的最大专辑总数上限 */
export const ARTIST_ALBUMS_LIMIT = 10000;
/** 续取一次取的张数，正好一页 */
export const ARTIST_ALBUMS_STEP = 200;

/** 艺人专辑分页数据状态（按发行时间降序） */
export interface ArtistAlbumsState {
  /** failed 仅表示首页请求失败；后续分页加载异常记录于 `moreFailed` */
  readonly phase: 'loading' | 'ready' | 'failed';
  readonly failure: MusicClientFailureCode | null;
  /** 已获取的专辑列表，维持上游原始顺序 */
  readonly albums: readonly MusicAlbum[];
  /** 上游返回的专辑总数；未提供时为 null */
  readonly total: number | null;
  /** 后续分页游标；为 null 表示已加载完毕 */
  readonly cursor: string | null;
  /** 是否已达到 `ARTIST_ALBUMS_LIMIT` 硬上限 */
  readonly truncated: boolean;
  /** 自动取的一段取完了，后面还有，等滚动到底再续取 */
  readonly paused: boolean;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

const LOADING: ArtistAlbumsState = {
  phase: 'loading',
  failure: null,
  albums: [],
  total: null,
  cursor: null,
  truncated: false,
  paused: false,
  loadingMore: false,
  moreFailed: false,
};

export const artistAlbumsKeyOf = (artist: MusicRef) => JSON.stringify([artist.platform, artist.id]);

export interface ArtistAlbumsService {
  /** 各位艺人的专辑状态映射表，键格式见 `artistAlbumsKeyOf` */
  readonly artists: Atom<ReadonlyMap<string, ArtistAlbumsState>>;
  /**
   * 注册艺人专辑数据订阅，返回释放清理函数
   * 若无缓存则发起请求，按串行步长拉取至上限；多个视图同时订阅共享单例状态。全部释放后保留最近 KEEP 位艺人缓存
   */
  want(artist: MusicRef): () => void;
  /** 重试请求；首页失败重新拉取，后续页失败从中断处继续 */
  retry(artist: MusicRef): void;
  /** 自动取停下后续取一页（`ARTIST_ALBUMS_STEP` 张）；没停下或没有更多时不动 */
  more(artist: MusicRef): void;
  dispose(): void;
}

function failureOf(error: unknown): MusicClientFailureCode {
  return error instanceof MusicClientError ? error.code : 'backend-unavailable';
}

/**
 * 维护在线艺人专辑页签数据
 * 首页即时响应，后续页面串行加载以遵守上游频率限制；单艺人请求支持独立 AbortController 取消
 * 本地后端端口连接就绪后自动触发活跃订阅重试；上游错误不自动重试以防限流
 */
export function startArtistAlbums(
  store: Store,
  client: Pick<MusicClient, 'artistAlbums'>,
  port?: Atom<number | null>,
): ArtistAlbumsService {
  const artists = atom<ReadonlyMap<string, ArtistAlbumsState>>(new Map());
  /** 记录各艺人的订阅引用计数、释放轮次、请求取消控制器及进行中 Promise */
  const holders = new Map<
    string,
    {
      readonly artist: MusicRef;
      count: number;
      released: number;
      round: AbortController;
      running: Promise<void> | null;
      /** 当前轮次允许获取的最大专辑张数 */
      allowed: number;
    }
  >();
  let releases = 0;
  let disposed = false;

  const recordOf = (artist: MusicRef) => {
    const key = artistAlbumsKeyOf(artist);
    let record = holders.get(key);
    if (!record)
      holders.set(
        key,
        (record = {
          artist,
          count: 0,
          released: 0,
          round: new AbortController(),
          running: null,
          allowed: ARTIST_ALBUMS_EAGER,
        }),
      );
    return record;
  };
  function patch(key: string, signal: AbortSignal, change: Partial<ArtistAlbumsState>): void {
    if (disposed || signal.aborted) return;
    const next = new Map(store.get(artists));
    next.set(key, { ...LOADING, ...next.get(key), ...change });
    store.set(artists, next);
  }

  /** 从中断游标处串行获取后续分页，直至加载完毕、达到步长/总数上限或被取消 */
  async function pull(record: ReturnType<typeof recordOf>): Promise<void> {
    const key = artistAlbumsKeyOf(record.artist);
    const signal = record.round.signal;
    for (;;) {
      const state = store.get(artists).get(key);
      const ready = state?.phase === 'ready' ? state : null;
      if (ready && (ready.cursor === null || record.count === 0)) {
        patch(key, signal, { loadingMore: false });
        return;
      }
      if (ready && ready.albums.length >= ARTIST_ALBUMS_LIMIT) {
        patch(key, signal, { loadingMore: false, paused: false, truncated: true });
        return;
      }
      if (ready && ready.albums.length >= record.allowed) {
        patch(key, signal, { loadingMore: false, paused: true });
        return;
      }
      patch(
        key,
        signal,
        ready ? { loadingMore: true, moreFailed: false, paused: false } : { ...LOADING },
      );
      try {
        const page = await client.artistAlbums(
          { ref: record.artist, cursor: ready ? ready.cursor : null },
          { signal },
        );
        if (signal.aborted) return;
        const current = ready ? (store.get(artists).get(key) ?? ready) : LOADING;
        const seen = new Set(current.albums.map((album) => album.ref.id));
        patch(key, signal, {
          phase: 'ready',
          failure: null,
          albums: [...current.albums, ...page.items.filter((album) => !seen.has(album.ref.id))],
          total: page.total ?? current.total,
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

  function load(artist: MusicRef): void {
    const record = recordOf(artist);
    if (record.running) return;
    const state = store.get(artists).get(artistAlbumsKeyOf(artist));
    // 达到上限或已完成的分页保持不变；分页失败需用户主动触发重试
    if (
      state?.phase === 'ready' &&
      (state.cursor === null || state.moreFailed || state.truncated || state.paused)
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
    const next = new Map(store.get(artists));
    next.delete(key);
    store.set(artists, next);
  }
  /** 清理无活跃订阅的空闲艺人缓存，按释放时间排序保留最多 KEEP 位 */
  function prune(): void {
    const idle = [...store.get(artists).keys()]
      .filter((key) => (holders.get(key)?.count ?? 0) === 0)
      .sort((a, b) => (holders.get(a)?.released ?? 0) - (holders.get(b)?.released ?? 0));
    for (const key of idle.slice(0, Math.max(0, idle.length - KEEP))) drop(key);
  }

  const stop = port
    ? store.sub(port, () => {
        if (store.get(port) === null) return;
        for (const [key, state] of store.get(artists)) {
          const record = holders.get(key);
          if (record?.count && state.phase === 'failed' && state.failure === 'backend-unavailable')
            load(record.artist);
        }
      })
    : undefined;

  return {
    artists,
    want(artist) {
      const record = recordOf(artist);
      record.count += 1;
      load(artist);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        record.count -= 1;
        if (record.count === 0) record.released = ++releases;
        prune();
      };
    },
    retry(artist) {
      const key = artistAlbumsKeyOf(artist);
      const state = store.get(artists).get(key);
      if (state?.moreFailed) patch(key, recordOf(artist).round.signal, { moreFailed: false });
      if (state?.phase === 'failed' || state?.moreFailed) load(artist);
    },
    more(artist) {
      const key = artistAlbumsKeyOf(artist);
      const state = store.get(artists).get(key);
      if (state?.phase !== 'ready' || !state.paused) return;
      const record = recordOf(artist);
      record.allowed = Math.min(ARTIST_ALBUMS_LIMIT, state.albums.length + ARTIST_ALBUMS_STEP);
      patch(key, record.round.signal, { paused: false });
      load(artist);
    },
    dispose() {
      disposed = true;
      stop?.();
      for (const record of holders.values()) record.round.abort();
      holders.clear();
    },
  };
}

export const artistAlbumsKey = serviceKey<ArtistAlbumsService>('artistAlbums');
