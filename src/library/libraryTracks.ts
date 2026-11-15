import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { collator } from './albumSections.ts';
import type { LibraryMirrorSource } from './mirror/mirrorSource.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  trackAlbumKeyOf,
  type AlbumKey,
  type LibraryEventsFace,
} from '../host/libraryContract.ts';

/** 取整库的查询共用的条数上限，盖得住整个库 */
export const TRACK_LIMIT = 1_000_000;

/**
 * 整库曲目每页请求的行数；宿主分页查询占用主线程，分页过大阻塞并发调用，分页过小增加往返开销，
 * 2000 行是兼顾吞吐量与界面响应的折中上限
 */
export const TRACK_PAGE_SIZE = 2000;

/** foobar2000 的 ALL 查询命中库里的每一首 */
const ALL_QUERY = 'ALL';

/** idle：还没要过；failed：最近一次读取失败，手上的旧曲目照旧留着 */
export type LibraryTracksStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface LibraryTracksState {
  readonly status: LibraryTracksStatus;
  /** 按专辑键分好的曲目，每张按碟号、曲号排好；没有专辑名的曲目不在里面 */
  readonly byAlbum: ReadonlyMap<AlbumKey, readonly LibraryTrack[]>;
  /** 整库曲目按句柄索引，包含无专辑名曲目；歌曲页按宿主返回的句柄次序取行 */
  readonly byHandle: ReadonlyMap<string, LibraryTrack>;
  /** 这一份发请求之前从评分服务拿的戳，见 `TrackRatingsService.stamp` */
  readonly stamp: number;
  /** 每换一份曲目加一；按它认是不是同一份 */
  readonly generation: number;
}

const INITIAL: LibraryTracksState = {
  status: 'idle',
  byAlbum: new Map(),
  byHandle: new Map(),
  stamp: 0,
  generation: 0,
};
const stateAtom = atom<LibraryTracksState>(INITIAL);

export const libraryTracksAtom: Atom<LibraryTracksState> = atom((get) => get(stateAtom));

export interface LibraryTracksFace extends HostReadyFace, LibraryEventsFace {
  library: Pick<typeof fb.library, 'search'>;
}

export interface LibraryTracksService {
  /**
   * 登记使用并返回释放函数，释放函数重复调用无效；无使用方时不抓取整库曲目，全部释放后保留当前缓存并收下进行中的响应；
   * 库变更时仅标记过期，重新登记时若库未变则沿用缓存
   */
  want(): () => void;
  /** 临时持有曲目并等待当前刷新完成；失败或服务释放时答 null */
  read(): Promise<LibraryTracksState | null>;
  /**
   * 同步评分服务的重取信号（`ratingsRefetchAtom`）；信号变更触发重新抓取，未抓取前仅记录当前值
   */
  syncRefetch(signal: number): void;
  /** 失败横幅上的重试 */
  retry(): Promise<void>;
  dispose(): void;
}

/** 碟号、曲号，再按路径与 subsong，同一张专辑里的曲目排成专辑本来的顺序 */
function compareTracks(a: LibraryTrack, b: LibraryTrack): number {
  return (
    a.discNumber - b.discNumber ||
    a.trackNumber - b.trackNumber ||
    collator.compare(a.path, b.path) ||
    a.subsong - b.subsong
  );
}

function groupByAlbum(tracks: readonly LibraryTrack[]): Map<AlbumKey, LibraryTrack[]> {
  const byAlbum = new Map<AlbumKey, LibraryTrack[]>();
  for (const track of tracks) {
    const key = trackAlbumKeyOf(track);
    if (!key) continue;
    const list = byAlbum.get(key);
    if (list) list.push(track);
    else byAlbum.set(key, [track]);
  }
  for (const list of byAlbum.values()) list.sort(compareTracks);
  return byAlbum;
}

/**
 * 按页抓取整库曲目；缺省 fields 时返回完整字段；分页期间若库内容发生增删，后续库变更事件会触发整份重取；
 * 请求失败或被新请求取代时返回 null
 */
async function fetchAllTracks(
  host: LibraryTracksFace,
  stale: () => boolean,
): Promise<LibraryTrack[] | null> {
  const tracks: LibraryTrack[] = [];
  for (;;) {
    const page = await settle(() =>
      host.library.search(ALL_QUERY, TRACK_PAGE_SIZE, { offset: tracks.length }),
    );
    if (stale() || !page || page.success === false) return null;
    tracks.push(...(page.tracks as LibraryTrack[]));
    if (page.tracks.length === 0 || tracks.length >= page.total) return tracks;
  }
}

/**
 * 列表视图使用的整库曲目服务：以 ALL 查询分页抓取并按专辑归类；遵循先订阅变更再抓取、1 秒合并重取、保留旧状态与丢弃过期响应原则
 *
 * 使用方采用引用计数管理：无使用方时仅标记过期不执行重取，避免全库频繁刷新
 */
export function startLibraryTracks(
  store: Store,
  stamp: () => number,
  host: LibraryTracksFace = fb,
  mirror?: Pick<LibraryMirrorSource, 'tracks'>,
): LibraryTracksService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let active = 0;
  let dirty = true;
  let connected = false;
  let loading: Promise<void> | null = null;
  let generation = 0;
  let signal: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  const waiter = waitForHost(host);
  let cancelRead: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    cancelRead = resolve;
  });

  async function load(): Promise<void> {
    const mine = ++generation;
    dirty = false;
    const stale = () => disposed || mine !== generation;
    const before = store.get(stateAtom);
    if (before.status !== 'ready') store.set(stateAtom, { ...before, status: 'loading' });
    const taken = stamp();
    // 镜像追平了宿主就读镜像，不占宿主主线程；读不到（没建好、落后、后端没连）退回宿主翻页
    const mirrored = mirror ? await mirror.tracks(stale) : null;
    const tracks = mirrored ?? (stale() ? null : await fetchAllTracks(host, stale));
    if (stale()) return;
    const current = store.get(stateAtom);
    if (!tracks) {
      store.set(stateAtom, { ...current, status: 'failed' });
      return;
    }
    store.set(stateAtom, {
      status: 'ready',
      byAlbum: groupByAlbum(tracks),
      byHandle: new Map(tracks.map((track) => [track.handle, track])),
      stamp: taken,
      generation: current.generation + 1,
    });
  }

  /** 记下进行中的请求，连续登记时不重复发请求；这一次取已含库变更，还在等的合并作废 */
  function reload(): Promise<void> {
    cancelTimer();
    const next = load();
    loading = next;
    void next.finally(() => {
      if (loading === next) loading = null;
    });
    return next;
  }

  function cancelTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(): void {
    if (disposed) return;
    dirty = true;
    cancelTimer();
    timer = setTimeout(() => {
      timer = undefined;
      if (active > 0) void reload();
    }, LIBRARY_COALESCE_MS);
  }

  async function connect(): Promise<void> {
    // 连上之前登记几次就进来几次，只有头一次订阅
    if (!(await waiter.done) || disposed || connected) return;
    connected = true;
    offLibrary = onLibraryChanged(host, schedule);
    if (active > 0 && dirty && !loading) await reload();
  }

  function want(): () => void {
    if (disposed) return () => {};
    active += 1;
    if (!connected) void connect();
    // 上次读取失败的，第一处再要时重取；已有人在要的，失败留给界面上的重试
    else if (dirty || (active === 1 && !loading && store.get(stateAtom).status === 'failed'))
      void reload();
    let released = false;
    return () => {
      if (released || disposed) return;
      released = true;
      active -= 1;
    };
  }

  return {
    want,
    async read() {
      const release = want();
      try {
        if (!(await Promise.race([waiter.done, stopped])) || disposed) return null;
        // ready 保留上次可画的快照，不能据此判断后台刷新是否结束
        while (!disposed) {
          if (dirty) {
            await Promise.race([reload(), stopped]);
          } else if (loading) {
            await Promise.race([loading, stopped]);
          } else break;
        }
        const state = store.get(stateAtom);
        return !disposed && state.status === 'ready' ? state : null;
      } finally {
        release();
      }
    },
    syncRefetch(next) {
      const changed = signal !== null && signal !== next;
      signal = next;
      if (!changed || disposed || !connected) return;
      dirty = true;
      if (active === 0) return;
      void reload();
    },
    retry() {
      if (disposed || !connected) return Promise.resolve();
      return reload();
    },
    dispose() {
      disposed = true;
      cancelRead();
      generation += 1;
      waiter.cancel();
      cancelTimer();
      offLibrary?.();
    },
  };
}
