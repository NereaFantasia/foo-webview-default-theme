import {
  isInteger,
  isRecord,
  isText,
  MUSIC_PLATFORMS,
  readMusicAlbum,
  readMusicArtist,
  readMusicPlaylist,
  readMusicRef,
  readMusicTrack,
  type MusicAlbum,
  type MusicArtist,
  type MusicPlatform,
  type MusicPlaylist,
  type MusicRef,
  type MusicTrack,
} from './musicObjects.ts';
import { isMusicCursor } from './musicProtocol.ts';

/** 本地收藏的四类对象：曲目、专辑、艺人、歌单 */
export const FAVORITE_KINDS = ['track', 'album', 'artist', 'playlist'] as const;
export type FavoriteKind = (typeof FAVORITE_KINDS)[number];

export interface FavoriteItems {
  readonly track: MusicTrack;
  readonly album: MusicAlbum;
  readonly artist: MusicArtist;
  readonly playlist: MusicPlaylist;
}

/** 首期只收网易云：别的平台的曲目按 ID 重建不了，取地址又依赖后端缓存里的私有记录 */
export const canFavorite = (ref: MusicRef): boolean => ref.platform === 'wy';

/** 一次加入、取消、刷新最多带这么多项 */
export const FAVORITE_BATCH_LIMIT = 100;
/** 一页最多给这么多条 */
export const FAVORITE_PAGE_LIMIT = 500;
/** 全部种类加起来最多收这么多项 */
export const FAVORITE_TOTAL_LIMIT = 20000;

/** 收藏的一项：展示用的快照加收藏时间（Unix 毫秒）；快照只用于显示，能否播放以取地址时为准 */
export interface FavoriteEntry<K extends FavoriteKind = FavoriteKind> {
  readonly kind: K;
  readonly item: FavoriteItems[K];
  readonly addedAt: number;
}

/** 键表里的一行：平台、对象 ID、收藏时间 */
export type FavoriteKeyRow = readonly [platform: MusicPlatform, id: string, addedAt: number];

/** 各类收藏的身份与时间，不带快照；页面启动时读一次，心形的状态靠它 */
export type FavoriteKeys = { readonly [K in FavoriteKind]: readonly FavoriteKeyRow[] };

export interface FavoriteListRequest {
  readonly kind: FavoriteKind;
  /** 上一页的 `nextCursor`，原样传回；null 表示第一页 */
  readonly cursor: string | null;
}

export interface FavoriteList<K extends FavoriteKind = FavoriteKind> {
  /** 收藏时间新到旧 */
  readonly items: readonly FavoriteEntry<K>[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/** 加入与刷新的请求：同一类、同一平台的曲目 */
export interface FavoriteWriteRequest<K extends FavoriteKind = FavoriteKind> {
  readonly kind: K;
  readonly items: readonly FavoriteItems[K][];
}

export interface FavoriteRemoveRequest {
  readonly kind: FavoriteKind;
  readonly refs: readonly MusicRef[];
}

/** 写入后各项的收藏时间，按请求里的顺序；刷新时只列库里本来就有的 */
export interface FavoriteStamp {
  readonly ref: MusicRef;
  readonly addedAt: number;
}

const ITEM_READERS: { readonly [K in FavoriteKind]: (value: unknown) => FavoriteItems[K] | null } =
  {
    track: readMusicTrack,
    album: readMusicAlbum,
    artist: readMusicArtist,
    playlist: readMusicPlaylist,
  };

export const readFavoriteItem = <K extends FavoriteKind>(
  kind: K,
  value: unknown,
): FavoriteItems[K] | null => ITEM_READERS[kind](value);

export const favoriteKind = (value: unknown): FavoriteKind | null =>
  FAVORITE_KINDS.find((item) => item === value) ?? null;

/** 条目在文件与内存里的键：同一类里同一引用只有一条 */
export const favoriteKeyOf = (kind: FavoriteKind, ref: MusicRef): string =>
  JSON.stringify([kind, ref.platform, ref.id]);

export function readFavoriteKeys(value: unknown): FavoriteKeys | null {
  if (!isRecord(value) || Object.keys(value).length !== FAVORITE_KINDS.length) return null;
  const keys: { [K in FavoriteKind]?: FavoriteKeyRow[] } = {};
  let total = 0;
  for (const kind of FAVORITE_KINDS) {
    const rows = value[kind];
    if (!Array.isArray(rows)) return null;
    const seen = new Set<string>();
    const read: FavoriteKeyRow[] = [];
    for (const row of rows) {
      const platform = Array.isArray(row)
        ? MUSIC_PLATFORMS.find((item) => item === row[0])
        : undefined;
      if (
        !Array.isArray(row) ||
        row.length !== 3 ||
        !platform ||
        !isText(row[1], 256) ||
        !isInteger(row[2])
      )
        return null;
      const key = `${platform}\0${row[1]}`;
      if (seen.has(key)) return null;
      seen.add(key);
      read.push([platform, row[1], row[2]]);
    }
    total += read.length;
    keys[kind] = read;
  }
  const { track, album, artist, playlist } = keys;
  return total <= FAVORITE_TOTAL_LIMIT && track && album && artist && playlist
    ? { track, album, artist, playlist }
    : null;
}

export function readFavoriteList<K extends FavoriteKind>(
  value: unknown,
  kind: K,
): FavoriteList<K> | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    value.items.length > FAVORITE_PAGE_LIMIT ||
    !(value.nextCursor === null || isMusicCursor(value.nextCursor)) ||
    !isInteger(value.total)
  )
    return null;
  const items: FavoriteEntry<K>[] = [];
  const seen = new Set<string>();
  for (const raw of value.items) {
    if (!isRecord(raw) || raw.kind !== kind || !isInteger(raw.addedAt)) return null;
    const item = readFavoriteItem(kind, raw.item);
    if (!item) return null;
    const key = favoriteKeyOf(kind, item.ref);
    if (seen.has(key)) return null;
    seen.add(key);
    items.push({ kind, item, addedAt: raw.addedAt });
  }
  return { items, nextCursor: value.nextCursor, total: value.total };
}

export function readFavoriteStamps(value: unknown): readonly FavoriteStamp[] | null {
  if (!Array.isArray(value) || value.length > FAVORITE_BATCH_LIMIT) return null;
  const stamps: FavoriteStamp[] = [];
  for (const raw of value) {
    const ref = isRecord(raw) ? readMusicRef(raw.ref) : null;
    if (!isRecord(raw) || !ref || !isInteger(raw.addedAt)) return null;
    stamps.push({ ref, addedAt: raw.addedAt });
  }
  return stamps;
}

export function readFavoriteRemoved(value: unknown): number | null {
  return isRecord(value) && isInteger(value.removed, 0) && value.removed <= FAVORITE_BATCH_LIMIT
    ? value.removed
    : null;
}
