import type { Atom } from 'jotai/vanilla';
import type { ServiceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import {
  artistAlbumSearchKey,
  startArtistAlbumSearch,
} from '../library/online/artistAlbumSearch.ts';
import { artistAlbumsKey, startArtistAlbums } from '../library/online/artistAlbums.ts';
import type { MusicClient } from '../playback/musicClient.ts';
import { onlineFavoritesKey, startOnlineFavorites } from '../playback/onlineFavorites.ts';
import { onlineListsKey, startOnlineLists } from '../playback/onlineLists.ts';

interface ServiceScope {
  add<T extends { dispose(): void }>(key: ServiceKey<T>, service: T): T;
}

/**
 * 在线音乐里经本地后端读写的几样：在线列表、本地收藏、艺人的专辑与专辑查找。`port` 是后端连上的端口，
 * 页面载入时后端常还没连上，连上后读失败的自己重读
 */
export function startOnlineListServices(
  store: Store,
  scope: ServiceScope,
  music: MusicClient,
  port: Atom<number | null>,
): void {
  scope.add(onlineListsKey, startOnlineLists(store, music, port));
  scope.add(onlineFavoritesKey, startOnlineFavorites(store, music, port));
  scope.add(artistAlbumsKey, startArtistAlbums(store, music, port));
  scope.add(artistAlbumSearchKey, startArtistAlbumSearch(store, music));
}
