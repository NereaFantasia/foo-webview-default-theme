import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { collator } from './albumSections.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  trackAlbumKeyOf,
  type AlbumKey,
  type LibraryEventsFace,
} from '../host/libraryContract.ts';

/** `library.getAll` 一次要的条数：要盖住整个库，宿主才留着这一份、下次从缓存答。 */
export const TRACK_LIMIT = 1_000_000;

/** idle：还没要过；failed：最近一次读取失败，手上的旧曲目照旧留着。 */
export type LibraryTracksStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface LibraryTracksState {
  readonly status: LibraryTracksStatus;
  /** 按专辑键分好的曲目，每张按碟号、曲号排好；没有专辑名的曲目不在里面。 */
  readonly byAlbum: ReadonlyMap<AlbumKey, readonly LibraryTrack[]>;
  /** 整库每一首，按 handle；没有专辑名的也在。歌曲页按宿主给的 handle 次序从这里取行。 */
  readonly byHandle: ReadonlyMap<string, LibraryTrack>;
  /** 这一份发请求之前从评分服务拿的戳，见 `TrackRatingsService.stamp`。 */
  readonly stamp: number;
  /** 每换一份曲目加一；按它认是不是同一份。 */
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
  library: Pick<typeof fb.library, 'getAll'>;
}

export interface LibraryTracksService {
  /**
   * 登记一处使用并返回释放函数，释放函数重复调用无效。没有使用方时不取整库曲目；最后一处释放后，进行中的
   * 请求作废，库变更只标记过时，下次登记时再取。
   */
  want(): () => void;
  /**
   * 评分服务的重取信号（`ratingsRefetchAtom`）此刻的值。与上次交来的不同就重取：一次改动报不全时，其余曲目
   * 的评分只能靠重取行更新。还没取过的只记下，取的时候本来就是新的。
   */
  syncRefetch(signal: number): void;
  /** 失败横幅上的重试。 */
  retry(): Promise<void>;
  dispose(): void;
}

/** 碟号、曲号，再按路径与 subsong，同一张专辑里的曲目排成专辑本来的顺序。 */
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
 * 列表形态用的整库曲目：`library.getAll` 一次取全，按专辑分好。与专辑清单同一套规矩：先订库变更再取，变更按
 * 1 s 合并后整份重取；重取期间旧的一份留着、状态不退回 loading；晚到的旧应答丢掉。`stamp` 是评分服务的
 * `stamp`，每次发请求前拿一个。
 *
 * 使用方按引用计数登记：改一首歌的标签或播放统计都会触发库变更，每次重取的都是整库，所以没有使用方时只标记
 * 过时，不重取。
 */
export function startLibraryTracks(
  store: Store,
  stamp: () => number,
  host: LibraryTracksFace = fb,
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

  async function load(): Promise<void> {
    const mine = ++generation;
    dirty = false;
    const stale = () => disposed || mine !== generation;
    const before = store.get(stateAtom);
    if (before.status !== 'ready') store.set(stateAtom, { ...before, status: 'loading' });
    const taken = stamp();
    const answer = await settle(() => host.library.getAll(0, TRACK_LIMIT));
    if (stale()) return;
    const current = store.get(stateAtom);
    if (!answer || answer.success === false) {
      store.set(stateAtom, { ...current, status: 'failed' });
      return;
    }
    store.set(stateAtom, {
      status: 'ready',
      byAlbum: groupByAlbum(answer.tracks),
      byHandle: new Map(answer.tracks.map((track) => [track.handle, track])),
      stamp: taken,
      generation: current.generation + 1,
    });
  }

  /** 记下进行中的请求，连续登记时不重复发请求。 */
  function reload(): Promise<void> {
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
    if (!(await waiter.done) || disposed) return;
    connected = true;
    offLibrary = onLibraryChanged(host, schedule);
    if (active > 0 && dirty && !loading) await reload();
  }

  return {
    want() {
      if (disposed) return () => {};
      active += 1;
      if (!connected) void connect();
      else if (dirty && !loading) void reload();
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        active -= 1;
        if (active > 0) return;
        // 作废进行中的请求：应答回来时已无人使用，写进状态只会多留一份整库。
        cancelTimer();
        generation += 1;
        loading = null;
        dirty = true;
      };
    },
    syncRefetch(next) {
      const changed = signal !== null && signal !== next;
      signal = next;
      if (!changed || disposed || !connected) return;
      dirty = true;
      if (active === 0) return;
      cancelTimer();
      void reload();
    },
    retry() {
      if (disposed || !connected) return Promise.resolve();
      cancelTimer();
      return reload();
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
