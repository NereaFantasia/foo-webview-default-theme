import type { NavHistoryService } from '../nav/navHistory.ts';
import type { KindOpener, ObjectOpener } from '../nav/objectOpener.ts';
import type { ObjectRef } from '../nav/objectRef.ts';
import type { Store } from '../kit/store.ts';
import { playlistsAtom, type PlaylistsService } from '../playback/playlists.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 播放列表作为历史里的地点：去一张列表就是去「播放列表页」，主体是它的 GUID。GUID 不随增删、重排、
 * 改名变；列表删了就认不回来，历史按跳过失效主体的规则越过那一条。后退、前进回到列表的记录时在宿主里
 * 重新激活那张。当前正在列表页上、宿主那边激活了别的列表时，当前这条跟着改成那一张
 */
export interface PlaylistPlaces {
  /** 去这张列表：经对象打开服务，先进历史，再在宿主里激活它。刚新建、清单还没读回的列表也能去 */
  open(guid: string): void;
  dispose(): void;
}

/**
 * 播放列表在对象打开服务里的打开方式：清单里有这个 GUID 才算能去；进了历史之后再激活，顺序不能反：
 * 激活一发出，页面此刻的主体就按它报，先激活会把正在看的另一张列表的历史记录改写成新的这张
 */
export function playlistKind(
  store: Store,
  playlists: Pick<PlaylistsService, 'activate'>,
): KindOpener<Extract<ObjectRef, { kind: 'playlist' }>> {
  return {
    revision: playlistsAtom,
    availability(ref) {
      const { items, revision } = store.get(playlistsAtom);
      if (items.some((item) => item.guid === ref.guid)) return 'ready';
      return revision === 0 ? 'pending' : 'missing';
    },
    arrived: (ref) => void playlists.activate(ref.guid),
  };
}

export function startPlaylistPlaces(
  store: Store,
  history: NavHistoryService,
  playlists: Pick<PlaylistsService, 'activate' | 'requestedTarget'>,
  objects: Pick<ObjectOpener, 'open'>,
): PlaylistPlaces {
  const exists = (guid: string) =>
    store.get(playlistsAtom).items.some((item) => item.guid === guid);
  const activate = (guid: string) => void playlists.activate(guid);

  const unregister = history.registerSubject('playlist', {
    // 活动列表要等宿主答了、清单读回才变。这期间主体报最近一次要去的那张：否则点完列表立刻去别处，
    // 或点了 B 又点回 A 时 B 的读回先到，都会把这条记录改写成还没换走的那张。被拒时照样报要去的那张，
    // 直到活动列表下一次变化
    current: () => playlists.requestedTarget() ?? store.get(playlistsAtom).activeGuid,
    exists,
    enter(subject) {
      if (exists(subject)) activate(subject);
    },
  });
  // 清单一变：删了的列表认不回来了，后退、前进的去向要重算；宿主激活了别的列表，当前这条跟着改
  const offItems = store.sub(playlistsAtom, () => history.subjectsChanged());

  return {
    open(guid) {
      void objects.open({ kind: 'playlist', guid });
    },
    dispose() {
      offItems();
      unregister();
    },
  };
}

export const playlistPlacesKey = serviceKey<PlaylistPlaces>('playlistPlaces');
