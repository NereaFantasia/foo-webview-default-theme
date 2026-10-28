import { readMusicAlbum, type MusicRef } from './musicObjects.ts';
import { readPage, type MusicSearchResult } from './musicProtocol.ts';

/** 单页专辑数与丢弃数之和的上限 */
export const MUSIC_ARTIST_ALBUMS_LIMIT = 200;

/** 艺人的全部专辑，按发行时间倒序排列；cursor 取上一页返回的 nextCursor，为 null 时表示首页 */
export interface MusicArtistAlbumsRequest {
  readonly ref: MusicRef;
  readonly cursor: string | null;
}

export function readMusicArtistAlbums(value: unknown): MusicSearchResult<'album'> | null {
  return readPage(value, readMusicAlbum, MUSIC_ARTIST_ALBUMS_LIMIT);
}
