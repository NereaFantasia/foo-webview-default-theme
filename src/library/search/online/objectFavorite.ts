import type { MessageKey } from '../../../i18n/en.ts';
import type { OnlineFavoritesService } from '../../../playback/onlineFavorites.ts';
import type { MusicAlbum, MusicArtist, MusicPlaylist } from '../../../server/musicObjects.ts';

export type FavoriteObject = MusicAlbum | MusicArtist | MusicPlaylist;

/** 菜单里这一项的文字：艺人是关注，专辑与歌单是收藏 */
export function favoriteLabelKey(item: FavoriteObject, on: boolean): MessageKey {
  const follow = !('releaseDate' in item) && !('cover' in item);
  if (follow) return on ? 'favorite.unfollow' : 'favorite.follow';
  return on ? 'favorite.remove' : 'favorite.add';
}

export const isFollowable = (item: FavoriteObject): item is MusicArtist =>
  !('releaseDate' in item) && !('cover' in item);

/** 已收藏就取消，否则收藏；按对象的种类走对应的一类 */
export function toggleFavoriteObject(
  favorites: Pick<OnlineFavoritesService, 'add' | 'remove' | 'isFavorite'>,
  item: FavoriteObject,
): Promise<boolean> {
  if ('releaseDate' in item)
    return favorites.isFavorite('album', item.ref)
      ? favorites.remove('album', [item.ref])
      : favorites.add('album', [item]);
  if ('cover' in item)
    return favorites.isFavorite('playlist', item.ref)
      ? favorites.remove('playlist', [item.ref])
      : favorites.add('playlist', [item]);
  return favorites.isFavorite('artist', item.ref)
    ? favorites.remove('artist', [item.ref])
    : favorites.add('artist', [item]);
}

/** 此刻有没有收藏（关注） */
export function isFavoriteObject(
  favorites: Pick<OnlineFavoritesService, 'isFavorite'>,
  item: FavoriteObject,
): boolean {
  if ('releaseDate' in item) return favorites.isFavorite('album', item.ref);
  if ('cover' in item) return favorites.isFavorite('playlist', item.ref);
  return favorites.isFavorite('artist', item.ref);
}
