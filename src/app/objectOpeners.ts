import type { Store } from '../kit/store.ts';
import type { ServiceKey } from '../kit/serviceKey.ts';
import { startAlbumDetail, albumDetailKey } from '../library/album-detail/albumDetail.ts';
import type { NavHistoryService } from '../nav/navHistory.ts';
import { startObjectOpener, objectOpenerKey, type ObjectOpener } from '../nav/objectOpener.ts';
import { folderKind } from '../library/folders/folderKind.ts';
import type { FoldersServices } from '../library/folders/foldersServices.ts';
import type { PlaylistsService } from '../playback/playlists.ts';
import { playlistKind } from '../playlist/playlistPlaces.ts';
import { ratingsRefetchAtom, type TrackRatingsService } from '../track/trackRatings.ts';

interface ServiceScope {
  add<T extends { dispose(): void }>(key: ServiceKey<T>, service: T): T;
  bind<T>(key: ServiceKey<T>, service: T): T;
}

/**
 * 组装对象导航服务与实体类打开器
 * 专辑详情服务与对象打开服务存在双向引用：详情页跳转经由打开服务派发，打开服务的专辑处理器由详情服务提供；二者在当前作用域内协同构建，确保打开服务先行注销时详情服务依然存活
 */
export function startObjectOpeners(
  store: Store,
  scope: ServiceScope,
  deps: {
    readonly history: NavHistoryService;
    readonly ratings: Pick<TrackRatingsService, 'stamp'>;
    readonly playlists: Pick<PlaylistsService, 'activate'>;
    /** 文件夹服务初始化晚于打开服务，延迟按需获取 */
    readonly folders: () => FoldersServices;
  },
) {
  const albumDetail = scope.add(
    albumDetailKey,
    startAlbumDetail(store, {
      history: deps.history,
      stamp: () => deps.ratings.stamp(),
      refetch: ratingsRefetchAtom,
      objects: {
        open: (ref, options) => objects.open(ref, options),
      },
    }),
  );
  const objects: ObjectOpener = scope.add(
    objectOpenerKey,
    startObjectOpener(store, {
      history: deps.history,
      kinds: {
        album: albumDetail.kind,
        // 流派引用源自库内专辑与曲目，详情可达性交由流派视图处理
        folder: folderKind(deps.folders),
        genre: { availability: () => 'ready' },
        playlist: playlistKind(store, deps.playlists),
        // 合作客串艺人可能未入媒体库艺人清单，采用乐观可用策略，缺损状态由艺人页展示
        artist: { availability: () => 'ready' },
        onlineList: { availability: () => 'ready' },
        onlineAlbums: { availability: () => 'ready' },
      },
    }),
  );
  return { albumDetail, objects };
}
