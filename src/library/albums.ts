import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type Album,
  type LibraryEventsFace,
} from '../host/libraryContract.ts';

/**
 * 一次取全的上限。宿主不夹 `limit`，库大过它时答 `hasMore`，界面据此提示「只显示前 N 张」，
 * 不静默截断。
 */
export const ALBUM_LIMIT = 100_000;

/** idle：还没连上宿主；failed：最近一次读取失败，手上的旧清单照旧留着。 */
export type AlbumsStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface AlbumsState {
  readonly status: AlbumsStatus;
  /** 媒体库开没开。没开时清单恒为空，界面画「去配置媒体库」而不是空库。 */
  readonly enabled: boolean;
  /** 宿主按专辑名排的整份清单；过滤、排序、分节都在客户端做。 */
  readonly albums: readonly Album[];
  /** 宿主折叠出的专辑总数，截断时大于 `albums.length`。 */
  readonly total: number;
  readonly truncated: boolean;
}

const INITIAL: AlbumsState = {
  status: 'idle',
  enabled: true,
  albums: [],
  total: 0,
  truncated: false,
};

const stateAtom = atom<AlbumsState>(INITIAL);

export const albumsAtom: Atom<AlbumsState> = atom((get) => get(stateAtom));

/** 宿主答了媒体库没开：信息中心据此提醒用户去配置。还在读的时候不算。 */
export const libraryNotConfiguredAtom: Atom<boolean> = atom((get) => {
  const albums = get(stateAtom);
  return albums.status === 'ready' && !albums.enabled;
});

/**
 * 媒体库里没有可浏览的东西：没配文件夹，或配了但一张专辑都没有。各地点的空态据此带「添加文件夹」；
 * 媒体库有东西、只是这一页筛不出来时不带。还在读、读失败都不算。
 */
export const libraryEmptyAtom: Atom<boolean> = atom((get) => {
  const albums = get(stateAtom);
  return albums.status === 'ready' && (!albums.enabled || albums.total === 0);
});

export interface AlbumsFace extends HostReadyFace, LibraryEventsFace {
  library: Pick<typeof fb.library, 'isEnabled' | 'getAlbums'>;
}

export interface AlbumsService {
  /** 连上宿主后的订阅与初读做完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /** 失败横幅上的重试：排着的合并重拉一并撤掉，不让它随后再打一次。 */
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * 启动专辑清单服务：先订库变更，再初读，两者之间的变化才不会漏；变更按 1 s 合并后整份重拉。
 * 重拉期间旧清单留着、状态不退回 loading，否则每次库变更网格都闪一次骨架；晚到的旧应答丢掉。
 */
export function startAlbums(store: Store, host: AlbumsFace = fb): AlbumsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  const waiter = waitForHost(host);

  const update = (change: (state: AlbumsState) => AlbumsState) =>
    store.set(stateAtom, change(store.get(stateAtom)));

  async function load(): Promise<void> {
    const mine = ++generation;
    const stale = () => disposed || mine !== generation;
    update((state) => (state.status === 'ready' ? state : { ...state, status: 'loading' }));
    // 库没开时 getAlbums 也答成功的空清单，要另问一次才分得清「空库」与「没开」。
    const enabled = await settle(() => host.library.isEnabled());
    if (stale()) return;
    if (!enabled || enabled.success === false) {
      update((state) => ({ ...state, status: 'failed' }));
      return;
    }
    if (!enabled.enabled) {
      store.set(stateAtom, { ...INITIAL, status: 'ready', enabled: false });
      return;
    }
    // 宿主只在 offset 为 0、不带 includeTracks、query / sort / includeCover 都相同且上次取的是整份时
    // 读缓存，所以这几项固定不变；真正的顺序在客户端定。
    const answer = await settle(() =>
      host.library.getAlbums({ sort: 'name', limit: ALBUM_LIMIT, useCache: true }),
    );
    if (stale()) return;
    if (!answer || answer.success === false) {
      update((state) => ({ ...state, status: 'failed', enabled: true }));
      return;
    }
    store.set(stateAtom, {
      status: 'ready',
      enabled: true,
      albums: answer.albums,
      total: answer.total,
      truncated: answer.hasMore,
    });
  }

  function cancelTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(): void {
    if (disposed) return;
    cancelTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void load();
    }, LIBRARY_COALESCE_MS);
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    offLibrary = onLibraryChanged(host, schedule);
    await load();
  }

  return {
    ready: connect(),
    retry() {
      if (disposed || !offLibrary) return Promise.resolve();
      cancelTimer();
      return load();
    },
    dispose() {
      disposed = true;
      generation += 1;
      waiter.cancel();
      cancelTimer();
      offLibrary?.();
    },
  };
}
