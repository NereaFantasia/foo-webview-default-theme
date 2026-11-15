// 页面发来的音乐请求体：逐项校验，多出的键、类型不符或越界都答请求无效

import {
  FAVORITE_BATCH_LIMIT,
  canFavorite,
  favoriteKind,
  readFavoriteItem,
  type FavoriteListRequest,
  type FavoriteRemoveRequest,
  type FavoriteWriteRequest,
} from '../../src/server/musicFavorites.ts';
import type { MusicArtistAlbumsRequest } from '../../src/server/musicArtistAlbums.ts';
import {
  MUSIC_DISCOVER_AREAS,
  MUSIC_DISCOVER_KINDS,
  type MusicDiscoverRequest,
} from '../../src/server/musicDiscover.ts';
import {
  isMusicCursor,
  MUSIC_LIST_KINDS,
  MUSIC_SEARCH_KINDS,
  MUSIC_TRACKS_LIMIT,
  type MusicListRequest,
  type MusicLxConfigRequest,
  type MusicResolveRequest,
  type MusicSearchRequest,
  type MusicTracksRequest,
} from '../../src/server/musicProtocol.ts';
import type { MusicPlatform, MusicRef } from '../../src/server/musicObjects.ts';
import { isMusicPlatform, isMusicQuality, isRecord } from './lxSource.ts';
import { MusicError } from './musicError.ts';

/** 请求体只有 `key` 一项时交出它的值，否则请求无效 */
export function single(value: unknown, key: string): unknown {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !(key in value))
    throw new MusicError('invalid-request');
  return value[key];
}

export function empty(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length) throw new MusicError('invalid-request');
}

export function searchRequest(value: unknown): MusicSearchRequest {
  const kind = isRecord(value) ? MUSIC_SEARCH_KINDS.find((item) => item === value.kind) : undefined;
  if (
    !isRecord(value) ||
    !kind ||
    !isMusicPlatform(value.platform) ||
    typeof value.query !== 'string' ||
    !value.query.trim() ||
    value.query.length > 256 ||
    !(value.cursor === null || isMusicCursor(value.cursor)) ||
    Object.keys(value).some((key) => !['platform', 'kind', 'query', 'cursor'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { platform: value.platform, kind, query: value.query.trim(), cursor: value.cursor };
}

export function tracksRequest(value: unknown): MusicTracksRequest {
  if (
    !isRecord(value) ||
    !isMusicPlatform(value.platform) ||
    !Array.isArray(value.ids) ||
    Object.keys(value).some((key) => !['platform', 'ids'].includes(key))
  )
    throw new MusicError('invalid-request');
  const ids = value.ids.filter(
    (id): id is string => typeof id === 'string' && !!id.trim() && id.length <= 256,
  );
  if (
    !ids.length ||
    ids.length !== value.ids.length ||
    ids.length > MUSIC_TRACKS_LIMIT ||
    new Set(ids).size !== ids.length
  )
    throw new MusicError('invalid-request');
  return { platform: value.platform, ids };
}

export function lxConfigRequest(value: unknown): MusicLxConfigRequest {
  if (!isRecord(value)) throw new MusicError('invalid-request');
  if (value.url === null && Object.keys(value).length === 1) return { url: null };
  const { url, username, userToken } = value;
  if (
    typeof url !== 'string' ||
    !(username === null || typeof username === 'string') ||
    !(userToken === undefined || typeof userToken === 'string') ||
    Object.keys(value).some((key) => !['url', 'username', 'userToken'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { url, username, ...(userToken === undefined ? {} : { userToken }) };
}

export function refRequest(value: unknown): MusicRef {
  if (
    !isRecord(value) ||
    !isMusicPlatform(value.platform) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    value.id.length > 256 ||
    Object.keys(value).some((key) => !['platform', 'id'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { platform: value.platform, id: value.id };
}

export function resolveRequest(value: unknown): MusicResolveRequest {
  if (
    !isRecord(value) ||
    !isMusicQuality(value.quality) ||
    Object.keys(value).some((key) => !['ref', 'quality'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { ref: refRequest(value.ref), quality: value.quality };
}

export function listRequest(value: unknown): MusicListRequest {
  const kind = isRecord(value) ? MUSIC_LIST_KINDS.find((item) => item === value.kind) : undefined;
  if (
    !isRecord(value) ||
    !kind ||
    !(value.cursor === null || isMusicCursor(value.cursor)) ||
    Object.keys(value).some((key) => !['kind', 'ref', 'cursor'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { kind, ref: refRequest(value.ref), cursor: value.cursor };
}

export function artistAlbumsRequest(value: unknown): MusicArtistAlbumsRequest {
  if (
    !isRecord(value) ||
    !(value.cursor === null || isMusicCursor(value.cursor)) ||
    Object.keys(value).some((key) => !['ref', 'cursor'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { ref: refRequest(value.ref), cursor: value.cursor };
}

export function discoverRequest(value: unknown): MusicDiscoverRequest {
  const kind = isRecord(value)
    ? MUSIC_DISCOVER_KINDS.find((item) => item === value.kind)
    : undefined;
  if (!isRecord(value) || !kind) throw new MusicError('invalid-request');
  if (kind === 'new-tracks' || kind === 'new-albums') {
    const area = MUSIC_DISCOVER_AREAS.find((item) => item === value.area);
    if (!area || Object.keys(value).length !== 2) throw new MusicError('invalid-request');
    return { kind, area };
  }
  if (Object.keys(value).length !== 1) throw new MusicError('invalid-request');
  return { kind };
}

function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new MusicError('invalid-request');
  return value;
}

/** 导入音源：本地文件给文件名与脚本内容，网址只给 `url`；脚本的大小由导入时核对 */
export function lxSourceAddRequest(
  value: unknown,
): { readonly name: string; readonly script: string } | { readonly url: string } {
  if (isRecord(value) && Object.keys(value).length === 1 && 'url' in value) {
    if (typeof value.url !== 'string' || !value.url.trim() || value.url.length > 2048)
      throw new MusicError('invalid-request');
    return { url: value.url.trim() };
  }
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 256 ||
    typeof value.script !== 'string' ||
    !value.script.trim() ||
    Object.keys(value).some((key) => !['name', 'script'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { name: value.name.trim(), script: value.script };
}

export function lxSourceIdRequest(value: unknown): string {
  return sourceId(single(value, 'id'));
}

export function lxSourceToggleRequest(value: unknown): {
  readonly id: string;
  readonly enabled: boolean;
} {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    Object.keys(value).some((key) => !['id', 'enabled'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { id: sourceId(value.id), enabled: value.enabled };
}

/** 检测一个音源在一个平台上能不能用；网易云不走音源脚本，不在内 */
export function lxSourceCheckRequest(value: unknown): {
  readonly id: string;
  readonly platform: MusicPlatform;
} {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['id', 'platform'].includes(key)) ||
    !isMusicPlatform(value.platform) ||
    value.platform === 'wy'
  )
    throw new MusicError('invalid-request');
  return { id: sourceId(value.id), platform: value.platform };
}

/** 调整先后：全部音源的 ID，按新的先后排 */
export function lxSourceOrderRequest(value: unknown): string[] {
  const ids = single(value, 'ids');
  if (!Array.isArray(ids) || !ids.length || ids.length > 200)
    throw new MusicError('invalid-request');
  const checked = ids.map(sourceId);
  if (new Set(checked).size !== checked.length) throw new MusicError('invalid-request');
  return checked;
}

export function favoriteListRequest(value: unknown): FavoriteListRequest {
  const kind = isRecord(value) ? favoriteKind(value.kind) : null;
  if (
    !isRecord(value) ||
    !kind ||
    !(value.cursor === null || isMusicCursor(value.cursor)) ||
    Object.keys(value).some((key) => !['kind', 'cursor'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { kind, cursor: value.cursor };
}

/** 加入与刷新：一类的一批对象，格式不对、重复或超过一批的上限都算请求无效；首期只收网易云的 */
export function favoriteWriteRequest(value: unknown): FavoriteWriteRequest {
  const kind = isRecord(value) ? favoriteKind(value.kind) : null;
  if (
    !isRecord(value) ||
    !kind ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > FAVORITE_BATCH_LIMIT ||
    Object.keys(value).some((key) => !['kind', 'items'].includes(key))
  )
    throw new MusicError('invalid-request');
  const seen = new Set<string>();
  const items = value.items.map((raw) => {
    const item = readFavoriteItem(kind, raw);
    if (!item || seen.has(item.ref.id)) throw new MusicError('invalid-request');
    seen.add(item.ref.id);
    return item;
  });
  if (items.some((item) => !canFavorite(item.ref))) throw new MusicError('unsupported');
  return { kind, items };
}

export function favoriteRemoveRequest(value: unknown): FavoriteRemoveRequest {
  const kind = isRecord(value) ? favoriteKind(value.kind) : null;
  if (
    !isRecord(value) ||
    !kind ||
    !Array.isArray(value.refs) ||
    !value.refs.length ||
    value.refs.length > FAVORITE_BATCH_LIMIT ||
    Object.keys(value).some((key) => !['kind', 'refs'].includes(key))
  )
    throw new MusicError('invalid-request');
  return { kind, refs: value.refs.map(refRequest) };
}
