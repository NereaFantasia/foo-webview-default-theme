import { MUSIC_ARTIST_ALBUMS_LIMIT } from '../../src/server/musicArtistAlbums.ts';
import {
  MUSIC_LIST_LIMIT,
  type MusicListResult,
  type MusicSearchItems,
  type MusicSearchKind,
  type MusicSearchResult,
} from '../../src/server/musicProtocol.ts';
import type {
  MusicAccess,
  MusicAlbum,
  MusicAlbumKind,
  MusicAlbumSubType,
  MusicArtist,
  MusicArtistCredit,
  MusicPlaylist,
  MusicQuality,
  MusicRef,
  MusicTrack,
} from '../../src/server/musicObjects.ts';
import { isRecord } from './lxSource.ts';
import { MusicError } from './musicError.ts';

export const NCM_PAGE_SIZE = 20;

// 网易云音质标识到标准音质档位的映射表
const LEVELS: readonly (readonly [string, MusicQuality])[] = [
  ['l', '128k'],
  ['h', '320k'],
  ['sq', 'flac'],
  ['hr', 'flac24bit'],
];

export function ncmText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  return value.trim() || null;
}

/** 将正整数 ID 解析为网易云平台引用；无效标识返回 null */
function ref(value: unknown): MusicRef | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? { platform: 'wy', id: String(value) }
    : null;
}

/** 提取数组首个非空文本字段；非数组或空值返回 null */
function first(value: unknown): string | null {
  return Array.isArray(value) ? ncmText(value[0]) : null;
}

function httpUrl(value: unknown): URL | null {
  const address = ncmText(value);
  if (!address) return null;
  try {
    const url = new URL(address);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048
      ? url
      : null;
  } catch {
    return null;
  }
}

/** 归一化图片地址协议为 HTTPS，防止跨域或混合内容受阻 */
function artwork(value: unknown): string | null {
  const url = httpUrl(value);
  if (url && (url.hostname === '126.net' || url.hostname.endsWith('.126.net')))
    url.protocol = 'https:';
  return url?.href ?? null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function credits(list: unknown): MusicArtistCredit[] {
  const artists: MusicArtistCredit[] = [];
  for (const artist of Array.isArray(list) ? list.slice(0, 100) : []) {
    const name = isRecord(artist) ? ncmText(artist.name) : null;
    if (isRecord(artist) && name) artists.push({ ref: ref(artist.id), name });
  }
  return artists;
}

/** 解析东八区发行日期（YYYY-MM-DD）；时间戳为 0 或无效时返回 null */
function releaseDate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) return null;
  const date = new Date(value + 8 * 3600 * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toISOString().slice(0, 10);
  return /^\d{4}-/.test(day) ? day : null;
}

function access(song: Record<string, unknown>, privilege: unknown): MusicAccess | null {
  if (isRecord(privilege) && typeof privilege.st === 'number' && privilege.st < 0)
    return 'unavailable';
  if (song.fee === 0 || song.fee === 8) return 'free';
  if (song.fee === 1) return 'vip';
  return song.fee === 4 ? 'purchase' : null;
}

/** 提取各音质档位对应的文件字节大小映射表 */
function sizes(song: Record<string, unknown>): Partial<Record<MusicQuality, number>> {
  const found: Partial<Record<MusicQuality, number>> = {};
  for (const [key, quality] of LEVELS) {
    const level = song[key];
    const size = isRecord(level) ? level.size : null;
    if (typeof size === 'number' && Number.isSafeInteger(size) && size > 0) found[quality] = size;
  }
  return found;
}

/** 解析网易云曲目记录；支持搜索结果内置权限或详情接口传入的独立权限结构 */
export function readNcmTrack(song: unknown, privilege?: unknown): MusicTrack | null {
  if (!isRecord(song)) return null;
  const reference = ref(song.id);
  const title = ncmText(song.name);
  if (!reference || !title) return null;
  const album = isRecord(song.al) ? song.al : {};
  const albumTitle = ncmText(album.name);
  const levelSizes = sizes(song);
  return {
    ref: reference,
    title,
    subtitle: first(song.alia) ?? first(song.tns),
    artists: credits(song.ar),
    album: albumTitle ? { ref: ref(album.id), title: albumTitle } : null,
    durationMs:
      typeof song.dt === 'number' && Number.isSafeInteger(song.dt) && song.dt >= 0 ? song.dt : null,
    artwork: artwork(album.picUrl),
    qualities: LEVELS.filter(([key]) => isRecord(song[key])).map(([, quality]) => quality),
    ...(Object.keys(levelSizes).length ? { sizes: levelSizes } : {}),
    access: access(song, privilege ?? song.privilege),
  };
}

// 专辑主类别映射表
const ALBUM_KINDS = new Map<unknown, MusicAlbumKind>([
  ['专辑', 'album'],
  ['Single', 'single'],
  ['EP', 'ep'],
  ['精选集', 'compilation'],
]);
// 专辑子版本类型映射表
const ALBUM_SUBTYPES = new Map<unknown, MusicAlbumSubType>([
  ['录音室版', 'studio'],
  ['现场版', 'live'],
  ['Remix', 'remix'],
  ['伴奏版', 'instrumental'],
  ['DEMO', 'demo'],
]);

export function readNcmAlbum(album: unknown): MusicAlbum | null {
  if (!isRecord(album)) return null;
  const reference = ref(album.id);
  const title = ncmText(album.name);
  if (!reference || !title) return null;
  const subType = ALBUM_SUBTYPES.get(album.subType);
  return {
    ref: reference,
    title,
    // 优先提取合作艺人完整列表，退回单主艺人字段
    artists: credits(Array.isArray(album.artists) ? album.artists : [album.artist]),
    artwork: artwork(album.picUrl),
    releaseDate: releaseDate(album.publishTime),
    trackCount: count(album.size),
    kind: ALBUM_KINDS.get(album.type) ?? null,
    ...(subType ? { subType } : {}),
  };
}

export function readNcmArtist(artist: unknown): MusicArtist | null {
  if (!isRecord(artist)) return null;
  const reference = ref(artist.id);
  const name = ncmText(artist.name);
  if (!reference || !name) return null;
  return {
    ref: reference,
    name,
    // 仅采用真实艺人写真，忽略平台默认占位头像
    avatar: artwork(artist.picUrl),
    albumCount: count(artist.albumSize),
    trackCount: count(artist.musicSize),
  };
}

export function readNcmPlaylist(list: unknown): MusicPlaylist | null {
  if (!isRecord(list)) return null;
  const reference = ref(list.id);
  const title = ncmText(list.name);
  if (!reference || !title) return null;
  return {
    ref: reference,
    title,
    cover: artwork(list.coverImgUrl),
    trackCount: count(list.trackCount),
    // 依据榜单标识字段区分普通歌单与官方榜单
    kind: ncmText(list.ToplistType) ? 'chart' : 'playlist',
    description: ncmText(list.description),
    playCount: count(list.playCount),
    updateNote: ncmText(list.updateFrequency),
  };
}

/** 列表解析并去重，记录丢弃条数 */
function readNcmItems<T extends { readonly ref: MusicRef }>(
  list: unknown,
  read: (item: unknown) => T | null,
) {
  if (!Array.isArray(list)) throw new MusicError('invalid-upstream');
  const items: T[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const item = read(raw);
    if (!item || seen.has(item.ref.id)) continue;
    seen.add(item.ref.id);
    items.push(item);
  }
  if (list.length && !items.length) throw new MusicError('invalid-upstream');
  return { items, discardedCount: list.length - items.length };
}

export function readNcmTracks(songs: unknown, privileges: unknown = []) {
  if (!Array.isArray(privileges)) throw new MusicError('invalid-upstream');
  const byId = new Map<unknown, unknown>();
  for (const item of privileges) if (isRecord(item)) byId.set(item.id, item);
  return readNcmItems(songs, (song) =>
    readNcmTrack(song, isRecord(song) ? byId.get(song.id) : undefined),
  );
}

// 搜索类型、上游字段名与结果解析函数的映射定义
export const NCM_SEARCH: {
  readonly [K in MusicSearchKind]: readonly [
    type: number,
    list: string,
    total: string,
    read: (item: unknown) => MusicSearchItems[K] | null,
  ];
} = {
  track: [1, 'songs', 'songCount', (song) => readNcmTrack(song)],
  album: [10, 'albums', 'albumCount', readNcmAlbum],
  artist: [100, 'artists', 'artistCount', readNcmArtist],
  playlist: [1000, 'playlists', 'playlistCount', readNcmPlaylist],
};

/** 解析搜索分页响应，生成下一页游标与总数 */
export function readNcmSearchPage<K extends MusicSearchKind>(
  body: unknown,
  offset: number,
  kind: K,
): MusicSearchResult<K> {
  const [, listKey, totalKey, read] = NCM_SEARCH[kind];
  if (!isRecord(body) || !isRecord(body.result)) throw new MusicError('invalid-upstream');
  const list = body.result[listKey] ?? [];
  if (!Array.isArray(list) || list.length > NCM_PAGE_SIZE) throw new MusicError('invalid-upstream');
  const total = count(body.result[totalKey]);
  const next = offset + NCM_PAGE_SIZE;
  return {
    ...readNcmItems(list, read),
    nextCursor:
      list.length === NCM_PAGE_SIZE && (total === null || next < total) ? String(next) : null,
    total,
  };
}

/** 解析全量曲目列表（专辑详情或艺人热门曲目） */
function readNcmWhole(songs: unknown) {
  if (Array.isArray(songs) && songs.length > MUSIC_LIST_LIMIT)
    throw new MusicError('invalid-upstream');
  return readNcmItems(songs, (song) => readNcmTrack(song));
}

export function readNcmAlbumList(body: Record<string, unknown>): MusicListResult<'album'> {
  const owner = readNcmAlbum(body.album);
  if (!owner) throw new MusicError('invalid-upstream');
  return { ...readNcmWhole(body.songs), nextCursor: null, total: owner.trackCount, owner };
}

/** 解析艺人详情与其热门曲目 */
export function readNcmArtistList(body: Record<string, unknown>): MusicListResult<'artist'> {
  const owner = readNcmArtist(body.artist);
  if (!owner) throw new MusicError('invalid-upstream');
  return { ...readNcmWhole(body.hotSongs), nextCursor: null, total: null, owner };
}

/** 解析艺人专辑分页结果 */
export function readNcmArtistAlbums(
  body: Record<string, unknown>,
  offset: number,
): MusicSearchResult<'album'> {
  const list = body.hotAlbums ?? [];
  if (!Array.isArray(list) || list.length > MUSIC_ARTIST_ALBUMS_LIMIT || !isRecord(body.artist))
    throw new MusicError('invalid-upstream');
  const total = count(body.artist.albumSize);
  const next = offset + list.length;
  return {
    ...readNcmItems(list, readNcmAlbum),
    nextCursor:
      list.length > 0 && body.more === true && (total === null || next < total)
        ? String(next)
        : null,
    total,
  };
}

/** 解析歌单元数据与其首屏曲目缓存，返回全量曲目 ID 列表供按需续取 */
export function readNcmPlaylistDetail(body: Record<string, unknown>) {
  const list = isRecord(body.playlist) ? body.playlist : null;
  const owner = readNcmPlaylist(list);
  if (!list || !owner || !Array.isArray(list.trackIds) || !Array.isArray(list.tracks))
    throw new MusicError('invalid-upstream');
  const ids: string[] = [];
  for (const item of list.trackIds) {
    const reference = isRecord(item) ? ref(item.id) : null;
    if (!reference) throw new MusicError('invalid-upstream');
    ids.push(reference.id);
  }
  const songs = list.tracks.slice(0, MUSIC_LIST_LIMIT);
  const first = songs.length
    ? { ...readNcmTracks(songs, body.privileges), taken: songs.length }
    : null;
  return { owner, ids, first };
}

/** 依据请求 ID 顺序还原曲目详情列表，自动过滤未收录条目 */
export function readNcmTracksInOrder(body: Record<string, unknown>, ids: readonly string[]) {
  const { items, discardedCount } = readNcmTracks(body.songs, body.privileges);
  const byId = new Map(items.map((track) => [track.ref.id, track]));
  return { items: ids.flatMap((id) => byId.get(id) ?? []), discardedCount };
}

/** 解析单曲播放地址与实际音质级别 */
export function readNcmUrl(body: Record<string, unknown>, id: string) {
  const data = Array.isArray(body.data)
    ? body.data.find((item: unknown) => isRecord(item) && String(item.id) === id)
    : undefined;
  if (!isRecord(data)) throw new MusicError('invalid-upstream');
  // 拦截试听片段，避免未登录或无权限时将试音频误作完整音频播放
  if (isRecord(data.freeTrialInfo)) throw new MusicError('membership-required');
  const url = httpUrl(data.url)?.href;
  if (!url) throw new MusicError('unplayable');
  return { url, level: data.level };
}
