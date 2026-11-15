import { describe, expect, it, vi } from 'vitest';
import {
  favoriteLabelKey,
  isFavoriteObject,
  isFollowable,
  toggleFavoriteObject,
} from '../../../../../src/library/search/online/objectFavorite.ts';
import { canFavorite } from '../../../../../src/server/musicFavorites.ts';
import { musicAlbum, musicArtist, musicPlaylist } from '../../../../fixtures/music.ts';

function favorites(on: boolean) {
  return {
    isFavorite: vi.fn(() => on),
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  };
}

describe('在线对象的收藏', () => {
  it('艺人写关注，专辑与歌单写收藏', () => {
    expect(favoriteLabelKey(musicArtist('1'), false)).toBe('favorite.follow');
    expect(favoriteLabelKey(musicArtist('1'), true)).toBe('favorite.unfollow');
    expect(favoriteLabelKey(musicAlbum('1'), false)).toBe('favorite.add');
    expect(favoriteLabelKey(musicPlaylist('1'), true)).toBe('favorite.remove');
    expect(isFollowable(musicArtist('1'))).toBe(true);
    expect(isFollowable(musicAlbum('1'))).toBe(false);
  });

  it('按对象的种类走对应的一类：没收藏就收，收了就取消', async () => {
    const album = musicAlbum('9');
    const off = favorites(false);
    await toggleFavoriteObject(off, album);
    expect(off.add).toHaveBeenCalledWith('album', [album]);
    const on = favorites(true);
    await toggleFavoriteObject(on, musicPlaylist('4'));
    expect(on.remove).toHaveBeenCalledWith('playlist', [{ platform: 'wy', id: '4' }]);
    await toggleFavoriteObject(on, musicArtist('3'));
    expect(on.remove).toHaveBeenLastCalledWith('artist', [{ platform: 'wy', id: '3' }]);
    expect(isFavoriteObject(on, album)).toBe(true);
    expect(on.isFavorite).toHaveBeenLastCalledWith('album', album.ref);
  });

  it('首期只收网易云的：别的平台的不能收', () => {
    expect(canFavorite({ platform: 'wy', id: '1' })).toBe(true);
    for (const platform of ['tx', 'kw', 'kg', 'mg'] as const)
      expect(canFavorite({ platform, id: '1' })).toBe(false);
  });
});
