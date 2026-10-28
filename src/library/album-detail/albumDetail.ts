import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { historyAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import type { ObjectOpener } from '../../nav/objectOpener.ts';
import type { Store } from '../../kit/store.ts';
import { readAlbumFacts, type AlbumFacts, type AlbumFactsFace } from './albumDetailFacts.ts';
import { albumKind, listedAlbum, type AlbumKind, type AlbumOpenOrigin } from './albumDetailOpen.ts';
import { albumsAtom, type AlbumsState } from '../albums.ts';
import { fetchAlbumTracks, type AlbumTracksFace } from '../albumTracks.ts';
import {
  albumKeyOf,
  trackAlbumKeyOf,
  type Album,
  type TrackAlbumFields,
} from '../../host/libraryContract.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/** 没有页面在看、还留着数据的专辑张数：后退、前进回到这几张时不必再等 */
const KEEP = 4;

/** loading：头一次取曲目；missing：这张已不在媒体库（清单里没有了，或宿主答了空） */
export type AlbumDetailPhase = 'loading' | 'ready' | 'missing';

export interface AlbumDetail {
  /** 清单里的这一行；已不在清单里时留最后一次见到的。清单还没读回、之前也没见过时为 null */
  readonly album: Album | null;
  readonly phase: AlbumDetailPhase;
  /** 曲目，按碟、曲、标题排；重取期间留着旧的。不在媒体库了为空 */
  readonly tracks: readonly LibraryTrack[];
  /** 取这批曲目的请求发出之前拿的评分戳 */
  readonly stamp: number;
  /** 最近一次取曲目失败；手上有旧曲目时照旧显示 */
  readonly failed: boolean;
  /** 格式与各碟副标题；曲目到了才去取，取到之前为 null */
  readonly facts: AlbumFacts | null;
}

const detailsAtom = atom<ReadonlyMap<string, AlbumDetail>>(new Map());

/** 各张专辑的详情页数据，按专辑键（`album` 地点的主体） */
export const albumDetailsAtom: Atom<ReadonlyMap<string, AlbumDetail>> = atom((get) =>
  get(detailsAtom),
);

export interface AlbumDetailFace extends AlbumTracksFace, AlbumFactsFace {}

export interface AlbumDetailDeps {
  readonly history: Pick<NavHistoryService, 'registerSubject' | 'subjectsChanged'>;
  /** 评分服务的戳，见 `TrackRatingsService.stamp`：每次取曲目前拿一个 */
  readonly stamp: () => number;
  /** 评分事件没报全时变一下，被看着的几张要重取 */
  readonly refetch: Atom<number>;
  /** 进详情页经对象打开服务走：连点、转圈与提示和别的对象共用一套 */
  readonly objects: Pick<ObjectOpener, 'open'>;
}

export interface AlbumDetailService {
  readonly catalog: Atom<AlbumsState>;
  /** 对象打开服务里专辑这一种的打开器 */
  readonly kind: AlbumKind;
  findAlbum(track: TrackAlbumFields): Album | null;
  isCurrent(album: Album): boolean;
  /** 进这张专辑的详情页：先取曲目，取到了再进；取不到只挂提示 */
  open(album: Album, origin?: AlbumOpenOrigin): void;
  /**
   * 页面挂上时要这张的数据，返回放手函数。手上没有就去取；几个页面同时要同一张（切换动画里的新旧两层）
   * 共用一份。都放手后数据先留着，至多留 `KEEP` 张；库一变没人看的就丢掉
   */
  want(key: string): () => void;
  /** 失败横幅上的重试 */
  retry(key: string): void;
  dispose(): void;
}

const LOADING: Omit<AlbumDetail, 'album'> = {
  phase: 'loading',
  tracks: [],
  stamp: 0,
  failed: false,
  facts: null,
};

/**
 * 专辑详情页的数据：按专辑键存曲目、格式与碟副标题，正在看的几张跟着库变更与评分重取信号重取，重取期间
 * 旧内容留着。这张移出了媒体库时标成 missing，页面留在原处。历史认得专辑主体：后退、前进越过已不在库里的
 */
export function startAlbumDetail(
  store: Store,
  deps: AlbumDetailDeps,
  host: AlbumDetailFace = fb,
): AlbumDetailService {
  store.set(detailsAtom, new Map());
  let disposed = false;
  /** 各张有几个页面在看、最近一次放手是第几次、在途请求的代次 */
  const holders = new Map<string, { count: number; released: number; generation: number }>();
  let releases = 0;

  const recordOf = (key: string) => {
    let record = holders.get(key);
    if (!record) holders.set(key, (record = { count: 0, released: 0, generation: 0 }));
    return record;
  };
  function patch(key: string, change: Partial<AlbumDetail> | null): void {
    const next = new Map(store.get(detailsAtom));
    const now = next.get(key);
    if (change === null) next.delete(key);
    else next.set(key, { album: null, ...LOADING, ...now, ...change });
    store.set(detailsAtom, next);
  }

  /** 曲目到了：落下，再取格式与碟副标题。`mine` 是这次请求的代次，过期的不落 */
  async function land(key: string, album: Album, tracks: readonly LibraryTrack[], stamp: number) {
    const record = recordOf(key);
    const mine = record.generation;
    patch(key, { album, phase: 'ready', tracks, stamp, failed: false });
    const facts = await readAlbumFacts(host, tracks);
    if (!disposed && record.generation === mine) patch(key, { facts });
  }

  async function load(key: string, album: Album): Promise<void> {
    const record = recordOf(key);
    const mine = ++record.generation;
    const stamp = deps.stamp();
    const tracks = await settle(() => fetchAlbumTracks(host, album, { fresh: true }));
    if (disposed || record.generation !== mine) return;
    if (!tracks) patch(key, { failed: true, phase: 'ready' });
    else if (tracks.length === 0) patch(key, { phase: 'missing', tracks: [], failed: false });
    else await land(key, album, tracks, stamp);
  }

  function drop(key: string): void {
    const record = holders.get(key);
    if (record) record.generation += 1;
    if (record?.count === 0) holders.delete(key);
    patch(key, null);
  }
  /** 还留着的数据里挑没人看的，从最早放手的起丢，丢到只剩 `KEEP` 张 */
  function prune(): void {
    const idle = [...store.get(detailsAtom).keys()]
      .filter((key) => (holders.get(key)?.count ?? 0) === 0)
      .sort((a, b) => (holders.get(a)?.released ?? 0) - (holders.get(b)?.released ?? 0));
    for (const key of idle.slice(0, Math.max(0, idle.length - KEEP))) drop(key);
  }

  /** 按此刻的清单重取被看着的几张；没人看的丢掉，下次要时重取 */
  function refresh(): void {
    const state = store.get(albumsAtom);
    for (const [key, detail] of store.get(detailsAtom)) {
      if ((holders.get(key)?.count ?? 0) === 0) {
        drop(key);
        continue;
      }
      const album = listedAlbum(state, key);
      if (album === null) {
        recordOf(key).generation += 1;
        patch(key, { phase: 'missing', tracks: [], failed: false });
      } else if (album) {
        if (detail.phase === 'missing') patch(key, { album, phase: 'loading' });
        void load(key, album);
      }
    }
  }

  const kind = albumKind(
    store,
    {
      stamp: deps.stamp,
      seed(album, tracks, stamp) {
        const key = albumKeyOf(album);
        const record = recordOf(key);
        record.generation += 1;
        if (record.count === 0) record.released = ++releases;
        void land(key, album, tracks, stamp);
        prune();
      },
    },
    host,
  );
  const offSubject = deps.history.registerSubject('album', {
    exists: (subject) => listedAlbum(store.get(albumsAtom), subject) !== null,
  });
  let list = store.get(albumsAtom);
  const offAlbums = store.sub(albumsAtom, () => {
    const next = store.get(albumsAtom);
    const changed = next.albums !== list.albums || next.status !== list.status;
    list = next;
    if (!changed) return;
    deps.history.subjectsChanged();
    refresh();
  });
  const offRefetch = store.sub(deps.refetch, refresh);

  return {
    catalog: albumsAtom,
    kind,
    findAlbum(track) {
      const key = trackAlbumKeyOf(track);
      return key === null ? null : (listedAlbum(store.get(albumsAtom), key) ?? null);
    },
    isCurrent(album) {
      const { place } = store.get(historyAtom);
      return place.id === 'album' && place.subject === albumKeyOf(album);
    },
    open(album, origin) {
      kind.hand(album);
      void deps.objects.open({ kind: 'album', key: albumKeyOf(album) }, { origin });
    },
    want(key) {
      const record = recordOf(key);
      record.count += 1;
      if (!store.get(detailsAtom).has(key)) {
        const album = listedAlbum(store.get(albumsAtom), key);
        if (album === null) patch(key, { phase: 'missing' });
        else {
          patch(key, { album: album ?? null });
          if (album) void load(key, album);
        }
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        record.count -= 1;
        if (record.count > 0) return;
        record.released = ++releases;
        prune();
      };
    },
    retry(key) {
      const album = store.get(detailsAtom).get(key)?.album;
      if (album && !disposed) void load(key, album);
    },
    dispose() {
      disposed = true;
      offRefetch();
      offAlbums();
      offSubject();
    },
  };
}

export const albumDetailKey = serviceKey<AlbumDetailService>('albumDetail');
