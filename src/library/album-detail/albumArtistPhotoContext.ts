import { createContext, useContext } from 'react';
import type { AlbumArtistPhoto } from './albumArtistPhoto.ts';

export const AlbumArtistPhotoContext = createContext<AlbumArtistPhoto | null>(null);

/** 头像服务由 `app/` 在装配好简介资源之后才提供；没有时头像只用宿主按专辑文件夹给的艺人图 */
export function useAlbumArtistPhotoService(): AlbumArtistPhoto | null {
  return useContext(AlbumArtistPhotoContext);
}
