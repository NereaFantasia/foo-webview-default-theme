import { atom, type Atom } from 'jotai/vanilla';
import type { MessageKey } from '../i18n/en.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import {
  FAVORITE_BATCH_LIMIT,
  FAVORITE_KINDS,
  favoriteKeyOf,
  type FavoriteEntry,
  type FavoriteItems,
  type FavoriteKind,
  type FavoriteList,
} from '../server/musicFavorites.ts';
import type { MusicRef } from '../server/musicObjects.ts';
import { MusicClientError, type MusicClient, type MusicClientFailureCode } from './musicClient.ts';

/** `has` 的原子缓存超过这个数就清空重来：原子本身从成员表算，清掉不影响正确性 */
const HAS_CACHE_LIMIT = 2000;

export interface FavoritesState {
  /** loading 是还没读到收藏的身份，unavailable 是读失败（后端没连上、文件读不出） */
  readonly phase: 'loading' | 'ready' | 'unavailable';
  readonly failure: MusicClientFailureCode | null;
}

/** 一类快照（收藏页要显示的内容）的读取状态 */
export type SnapshotPhase = 'idle' | 'loading' | 'ready' | 'failed';

interface Member {
  readonly kind: FavoriteKind;
  readonly ref: MusicRef;
  readonly addedAt: number;
}

type Snapshots = { readonly [K in FavoriteKind]: ReadonlyMap<string, FavoriteItems[K]> };

const emptySnapshots = (): Snapshots => ({
  track: new Map(),
  album: new Map(),
  artist: new Map(),
  playlist: new Map(),
});
const refKey = (ref: MusicRef) => JSON.stringify([ref.platform, ref.id]);

export interface OnlineFavoritesService {
  readonly state: Atom<FavoritesState>;
  /** 各类收藏了几项；读到之前都是 0 */
  readonly counts: Atom<Readonly<Record<FavoriteKind, number>>>;
  /** 最近一次写失败的原因（改动没有生效）；界面读了写完提示就调 `clearNotice`。读不出来看 `state` 与 `snapshotPhase` */
  readonly notice: Atom<MusicClientFailureCode | null>;
  clearNotice(): void;
  /** 一项此刻有没有收藏；读到收藏之前与后端没连上时是 false */
  has(kind: FavoriteKind, ref: MusicRef): Atom<boolean>;
  /** 此刻有没有收藏，不订阅；菜单打开那一刻按它定「收藏」还是「取消收藏」 */
  isFavorite(kind: FavoriteKind, ref: MusicRef): boolean;
  /** 收藏已读到，菜单才出收藏项 */
  isReady(): boolean;
  /** 收藏页的条目：收藏时间新到旧，只含已经读到快照的，取消收藏即刻消失 */
  entries<K extends FavoriteKind>(kind: K): Atom<readonly FavoriteEntry<K>[]>;
  /** 每类一个固定的原子，可以直接在渲染里订阅 */
  snapshotPhase(kind: FavoriteKind): Atom<SnapshotPhase>;
  /** 页面要这一类的快照：没有就分页读全，返回放手函数；都放手后在途的读取作废 */
  want(kind: FavoriteKind): () => void;
  /** 加入收藏，即刻生效，失败回滚并记下原因。还没读到收藏、正在重读时不收，答 false */
  add<K extends FavoriteKind>(kind: K, items: readonly FavoriteItems[K][]): Promise<boolean>;
  remove(kind: FavoriteKind, refs: readonly MusicRef[]): Promise<boolean>;
  toggle<K extends FavoriteKind>(kind: K, item: FavoriteItems[K]): Promise<boolean>;
  /** 重读收藏的身份，也重读失败的那几类快照 */
  retry(): void;
  dispose(): void;
}

/** 写失败的提示用哪一句 */
export function favoriteFailureKey(code: MusicClientFailureCode): MessageKey {
  if (code === 'favorites-full') return 'favorite.failedFull';
  return code === 'settings-unavailable' ? 'favorite.failedSave' : 'favorite.failed';
}

function failureOf(error: unknown): MusicClientFailureCode {
  return error instanceof MusicClientError ? error.code : 'backend-unavailable';
}

function* batches<T>(items: readonly T[]): Generator<readonly T[]> {
  for (let at = 0; at < items.length; at += FAVORITE_BATCH_LIMIT)
    yield items.slice(at, at + FAVORITE_BATCH_LIMIT);
}

/**
 * 本地收藏的页面侧服务。收藏的身份与时间启动时读一次，心形的状态同步可查；加入与取消先改页面，再按次序写后端，
 * 任何一次失败都记下原因、重读后端的为准，不留页面与文件对不上的状态。写入排成一队，后端按点击的先后收到
 * `port` 是本地后端连上的端口：页面载入时后端常还没连上，连上后读不到的自己重读
 */
export function startOnlineFavorites(
  store: Store,
  client: Pick<MusicClient, 'favoriteKeys' | 'favoriteList' | 'addFavorites' | 'removeFavorites'>,
  port?: Atom<number | null>,
): OnlineFavoritesService {
  const stateAtom = atom<FavoritesState>({ phase: 'loading', failure: null });
  const members = atom<ReadonlyMap<string, Member>>(new Map());
  const snapshots = atom<Snapshots>(emptySnapshots());
  const loads = atom<Readonly<Record<FavoriteKind, SnapshotPhase>>>({
    track: 'idle',
    album: 'idle',
    artist: 'idle',
    playlist: 'idle',
  });
  const noticeAtom = atom<MusicClientFailureCode | null>(null);
  const counts = atom((get) => {
    const total = { track: 0, album: 0, artist: 0, playlist: 0 };
    for (const member of get(members).values()) total[member.kind] += 1;
    return total;
  });
  /** 收藏页的条目：收藏时间新到旧，只含已经读到快照的 */
  const entriesOf = <K extends FavoriteKind>(kind: K): Atom<readonly FavoriteEntry<K>[]> =>
    atom((get) => {
      const have = get(snapshots)[kind];
      const rows: FavoriteEntry<K>[] = [];
      for (const member of get(members).values()) {
        if (member.kind !== kind) continue;
        const item = have.get(refKey(member.ref));
        if (item) rows.push({ kind, item, addedAt: member.addedAt });
      }
      return rows.sort((a, b) => b.addedAt - a.addedAt);
    });
  const entryAtoms: { readonly [K in FavoriteKind]: Atom<readonly FavoriteEntry<K>[]> } = {
    track: entriesOf('track'),
    album: entriesOf('album'),
    artist: entriesOf('artist'),
    playlist: entriesOf('playlist'),
  };
  const phaseOf = (kind: FavoriteKind) => atom((get) => get(loads)[kind]);
  const phaseAtoms = {
    track: phaseOf('track'),
    album: phaseOf('album'),
    artist: phaseOf('artist'),
    playlist: phaseOf('playlist'),
  };
  const lifetime = new AbortController();
  const hasAtoms = new Map<string, Atom<boolean>>();
  const wanted = new Map<FavoriteKind, { count: number; round: AbortController }>();
  /** 排着的写入；重读与新的写入都等它 */
  let writes: Promise<unknown> = Promise.resolve();
  /** 正在重读收藏的身份：这段时间里页面上的改动无法与后端的答复对账，所以不收 */
  let reloading = false;
  let reloadRound = 0;
  let disposed = false;

  const ready = () => store.get(stateAtom).phase === 'ready' && !reloading;

  async function reload(): Promise<void> {
    const mine = ++reloadRound;
    reloading = true;
    try {
      await writes.catch(() => {});
      const keys = await client.favoriteKeys({ signal: lifetime.signal });
      if (disposed || mine !== reloadRound) return;
      const next = new Map<string, Member>();
      for (const kind of FAVORITE_KINDS)
        for (const [platform, id, addedAt] of keys[kind]) {
          const ref = { platform, id };
          next.set(favoriteKeyOf(kind, ref), { kind, ref, addedAt });
        }
      store.set(members, next);
      store.set(stateAtom, { phase: 'ready', failure: null });
    } catch (error) {
      if (disposed || mine !== reloadRound) return;
      store.set(stateAtom, { phase: 'unavailable', failure: failureOf(error) });
    } finally {
      if (mine === reloadRound) reloading = false;
    }
  }

  function enqueue(send: () => Promise<void>): Promise<boolean> {
    const run = writes
      .catch(() => {})
      .then(send)
      .then(
        () => true,
        (error: unknown) => {
          if (!disposed) {
            store.set(noticeAtom, failureOf(error));
            void reload();
          }
          return false;
        },
      );
    writes = run;
    return run;
  }

  function setSnapshots<K extends FavoriteKind>(kind: K, items: readonly FavoriteItems[K][]) {
    const current = store.get(snapshots);
    const next = new Map(current[kind]);
    for (const item of items) next.set(refKey(item.ref), item);
    store.set(snapshots, { ...current, [kind]: next });
  }

  async function add<K extends FavoriteKind>(
    kind: K,
    items: readonly FavoriteItems[K][],
  ): Promise<boolean> {
    if (!ready() || items.length === 0) return false;
    const now = Date.now();
    const next = new Map(store.get(members));
    for (const item of items) {
      const key = favoriteKeyOf(kind, item.ref);
      if (!next.has(key)) next.set(key, { kind, ref: item.ref, addedAt: now });
    }
    store.set(members, next);
    setSnapshots(kind, items);
    return enqueue(async () => {
      for (const batch of batches(items)) {
        const stamps = await client.addFavorites(
          { kind, items: batch },
          { signal: lifetime.signal },
        );
        if (disposed) return;
        // 以后端记的收藏时间为准；这期间已经取消的不收回来
        const current = new Map(store.get(members));
        for (const stamp of stamps) {
          const key = favoriteKeyOf(kind, stamp.ref);
          const member = current.get(key);
          if (member) current.set(key, { ...member, addedAt: stamp.addedAt });
        }
        store.set(members, current);
      }
    });
  }

  async function remove(kind: FavoriteKind, refs: readonly MusicRef[]): Promise<boolean> {
    if (!ready() || refs.length === 0) return false;
    const next = new Map(store.get(members));
    for (const ref of refs) next.delete(favoriteKeyOf(kind, ref));
    store.set(members, next);
    return enqueue(async () => {
      for (const batch of batches(refs))
        await client.removeFavorites({ kind, refs: batch }, { signal: lifetime.signal });
    });
  }

  async function loadSnapshots(kind: FavoriteKind, signal: AbortSignal): Promise<void> {
    const setPhase = (phase: SnapshotPhase) =>
      store.set(loads, { ...store.get(loads), [kind]: phase });
    setPhase('loading');
    try {
      let cursor: string | null = null;
      do {
        const page: FavoriteList = await client.favoriteList({ kind, cursor }, { signal });
        if (signal.aborted) return;
        // 页面这期间新收的快照更新，不被文件里旧的盖掉
        const have = store.get(snapshots)[kind];
        setSnapshots(
          kind,
          page.items.map((entry) => entry.item).filter((item) => !have.has(refKey(item.ref))),
        );
        cursor = page.nextCursor;
      } while (cursor !== null);
      setPhase('ready');
    } catch {
      if (signal.aborted || disposed) return;
      setPhase('failed');
    }
  }

  const stop = port
    ? store.sub(port, () => {
        if (store.get(port) === null || reloading) return;
        if (store.get(stateAtom).phase !== 'ready') void reload();
      })
    : undefined;
  void reload();

  return {
    state: stateAtom,
    counts,
    notice: noticeAtom,
    clearNotice: () => store.set(noticeAtom, null),
    has(kind, ref) {
      const key = favoriteKeyOf(kind, ref);
      let found = hasAtoms.get(key);
      if (!found) {
        if (hasAtoms.size >= HAS_CACHE_LIMIT) hasAtoms.clear();
        found = atom((get) => get(members).has(key));
        hasAtoms.set(key, found);
      }
      return found;
    },
    entries: (kind) => entryAtoms[kind],
    isFavorite: (kind, ref) => store.get(members).has(favoriteKeyOf(kind, ref)),
    isReady: () => store.get(stateAtom).phase === 'ready',
    snapshotPhase: (kind) => phaseAtoms[kind],
    want(kind) {
      let record = wanted.get(kind);
      if (!record) wanted.set(kind, (record = { count: 0, round: new AbortController() }));
      record.count += 1;
      const phase = store.get(loads)[kind];
      if (phase === 'idle' || phase === 'failed')
        void loadSnapshots(kind, AbortSignal.any([lifetime.signal, record.round.signal]));
      let released = false;
      const mine = record;
      return () => {
        if (released) return;
        released = true;
        mine.count -= 1;
        if (mine.count > 0) return;
        // 没人要了：在途的读取作废，下次再要从头读
        mine.round.abort();
        wanted.delete(kind);
        if (store.get(loads)[kind] === 'loading')
          store.set(loads, { ...store.get(loads), [kind]: 'idle' });
      };
    },
    add,
    remove,
    toggle: (kind, item) =>
      store.get(members).has(favoriteKeyOf(kind, item.ref))
        ? remove(kind, [item.ref])
        : add(kind, [item]),
    retry() {
      if (store.get(stateAtom).phase !== 'ready') void reload();
      for (const [kind, record] of wanted)
        if (store.get(loads)[kind] === 'failed')
          void loadSnapshots(kind, AbortSignal.any([lifetime.signal, record.round.signal]));
    },
    dispose() {
      disposed = true;
      lifetime.abort();
      stop?.();
    },
  };
}

export const onlineFavoritesKey = serviceKey<OnlineFavoritesService>('onlineFavorites');
