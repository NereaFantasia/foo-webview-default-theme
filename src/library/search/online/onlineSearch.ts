import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import type { Store } from '../../../kit/store.ts';
import {
  MusicClientError,
  type MusicClient,
  type MusicClientFailureCode,
} from '../../../playback/musicClient.ts';
import {
  MUSIC_SEARCH_KINDS,
  type MusicSearchItems,
  type MusicSearchKind,
} from '../../../server/musicProtocol.ts';
import { MUSIC_PLATFORMS, type MusicPlatform } from '../../../server/musicObjects.ts';

/** 没有给来源时搜的平台 */
export const ONLINE_PLATFORM: MusicPlatform = 'wy';

/** 各平台能搜哪几类：网易云四类都有，其他平台经 lxserver 只有曲目 */
export function searchableKinds(platform: MusicPlatform): readonly MusicSearchKind[] {
  return platform === 'wy' ? MUSIC_SEARCH_KINDS : ['track'];
}

/** 在线音乐范围的分类：照本地结果页，另加歌单 */
export type OnlineCategory = 'all' | 'artists' | 'albums' | 'tracks' | 'playlists';

export interface OnlineKindState<K extends MusicSearchKind> {
  /** idle 是还没要过这一类；failed 只指第一页没取到，续页失败记在 `moreFailed` */
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly items: readonly MusicSearchItems[K][];
  /** 平台给的总数，没给时为 null */
  readonly total: number | null;
  /** 还能接着取时是下一页的游标 */
  readonly cursor: string | null;
  readonly failure: MusicClientFailureCode | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

const IDLE = {
  status: 'idle',
  items: [],
  total: null,
  cursor: null,
  failure: null,
  loadingMore: false,
  moreFailed: false,
} as const satisfies OnlineKindState<MusicSearchKind>;

type KindAtoms = { readonly [K in MusicSearchKind]: PrimitiveAtom<OnlineKindState<K>> };

const kindAtoms = (): KindAtoms => ({
  track: atom<OnlineKindState<'track'>>(IDLE),
  album: atom<OnlineKindState<'album'>>(IDLE),
  artist: atom<OnlineKindState<'artist'>>(IDLE),
  playlist: atom<OnlineKindState<'playlist'>>(IDLE),
});

export interface OnlineSearch {
  readonly text: Atom<string>;
  /** `kinds` 读的是哪个平台的结果 */
  readonly platform: Atom<MusicPlatform>;
  /** 当前平台的各类结果；换平台时换成那个平台已取到的，不重取 */
  readonly kinds: { readonly [K in MusicSearchKind]: Atom<OnlineKindState<K>> };
  /** 换查询词：各平台各类清空，不发请求。与当前相同时不动 */
  setText(text: string): void;
  /** 取当前平台这些类别的第一页：还没要过或第一页失败的才取，已取到或正在取的不重取；平台不搜的类别略过 */
  load(kinds: readonly MusicSearchKind[]): void;
  /** 接着取当前平台下一页；没有下一页、第一页还没取到或正在取时不动 */
  more(kind: MusicSearchKind): Promise<void>;
  dispose(): void;
}

function failureOf(error: unknown): MusicClientFailureCode {
  return error instanceof MusicClientError ? error.code : 'backend-unavailable';
}

/**
 * 一个查询词的在线结果，按平台、按类别分开取、分开续页。换查询词或释放时取消在途请求，晚到的应答丢弃；
 * 换平台不取消别的平台在途的请求，应答写进它自己那个平台的状态；续页的结果按身份去重，平台翻页时偶尔会把上一页的条目再给一次
 * `port` 是本地后端连上的端口：当前平台因后端还没连上而没取到的类别，连上后自己重取；上游失败不自动重取
 * `platform` 是当前要看的平台，缺省网易云
 */
export function startOnlineSearch(
  store: Store,
  client: Pick<MusicClient, 'search'>,
  port?: Atom<number | null>,
  platform: Atom<MusicPlatform> = atom(ONLINE_PLATFORM),
): OnlineSearch {
  const text = atom('');
  const states = new Map(MUSIC_PLATFORMS.map((one) => [one, kindAtoms()] as const));
  let round = new AbortController();
  let disposed = false;

  const atomOf = <K extends MusicSearchKind>(
    owner: MusicPlatform,
    kind: K,
  ): PrimitiveAtom<OnlineKindState<K>> => {
    const found = states.get(owner);
    if (!found) throw new Error(`没有 ${owner} 的在线搜索状态`);
    return found[kind];
  };
  const current = <K extends MusicSearchKind>(kind: K) =>
    atom((get) => get(atomOf(get(platform), kind)));
  const kinds = {
    track: current('track'),
    album: current('album'),
    artist: current('artist'),
    playlist: current('playlist'),
  };

  function patch<K extends MusicSearchKind>(
    owner: MusicPlatform,
    kind: K,
    signal: AbortSignal,
    change: (state: OnlineKindState<K>) => OnlineKindState<K>,
  ) {
    if (!signal.aborted) store.set(atomOf(owner, kind), change(store.get(atomOf(owner, kind))));
  }

  const page = <K extends MusicSearchKind>(
    owner: MusicPlatform,
    kind: K,
    cursor: string | null,
    signal: AbortSignal,
  ) => client.search({ platform: owner, kind, query: store.get(text), cursor }, { signal });

  async function first<K extends MusicSearchKind>(owner: MusicPlatform, kind: K) {
    const signal = round.signal;
    patch(owner, kind, signal, () => ({ ...IDLE, status: 'loading' }));
    try {
      const result = await page(owner, kind, null, signal);
      patch(owner, kind, signal, () => ({
        ...IDLE,
        status: 'ready',
        items: result.items,
        total: result.total,
        cursor: result.nextCursor,
      }));
    } catch (error) {
      patch(owner, kind, signal, () => ({ ...IDLE, status: 'failed', failure: failureOf(error) }));
    }
  }

  const stop = port
    ? store.sub(port, () => {
        if (store.get(port) === null || disposed) return;
        const owner = store.get(platform);
        for (const kind of searchableKinds(owner)) {
          const { status, failure } = store.get(atomOf(owner, kind));
          if (status === 'failed' && failure === 'backend-unavailable') void first(owner, kind);
        }
      })
    : undefined;

  return {
    text,
    platform,
    kinds,
    setText(next) {
      if (next === store.get(text)) return;
      round.abort();
      round = new AbortController();
      store.set(text, next);
      for (const owner of MUSIC_PLATFORMS)
        for (const kind of MUSIC_SEARCH_KINDS) store.set(atomOf(owner, kind), IDLE);
    },
    load(wanted) {
      if (disposed || !store.get(text).trim()) return;
      const owner = store.get(platform);
      const allowed = searchableKinds(owner);
      for (const kind of wanted) {
        if (!allowed.includes(kind)) continue;
        const { status } = store.get(atomOf(owner, kind));
        if (status === 'idle' || status === 'failed') void first(owner, kind);
      }
    },
    more: async <K extends MusicSearchKind>(kind: K) => {
      const owner = store.get(platform);
      if (!searchableKinds(owner).includes(kind)) return;
      const state = store.get(atomOf(owner, kind));
      if (state.status !== 'ready' || state.cursor === null || state.loadingMore) return;
      const signal = round.signal;
      patch(owner, kind, signal, (now) => ({ ...now, loadingMore: true, moreFailed: false }));
      try {
        const result = await page(owner, kind, state.cursor, signal);
        patch(owner, kind, signal, (now) => {
          const seen = new Set(now.items.map((item) => item.ref.id));
          return {
            ...now,
            items: [...now.items, ...result.items.filter((item) => !seen.has(item.ref.id))],
            total: result.total ?? now.total,
            cursor: result.nextCursor,
            loadingMore: false,
          };
        });
      } catch {
        patch(owner, kind, signal, (now) => ({ ...now, loadingMore: false, moreFailed: true }));
      }
    },
    dispose() {
      disposed = true;
      stop?.();
      round.abort();
    },
  };
}
