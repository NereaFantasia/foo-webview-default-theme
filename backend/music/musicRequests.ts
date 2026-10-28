// 页面发来的音乐请求体：逐项校验，多出的键、类型不符或越界都答请求无效

import type { MusicArtistAlbumsRequest } from '../../src/server/musicArtistAlbums.ts';
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
