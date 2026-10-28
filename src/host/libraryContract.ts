import type { AlbumInfo, Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { hostCommand } from './hostCall.ts';
import { trackAbilities } from './trackOrigin.ts';

/** 专辑数据实体，对应 SDK `library.getAlbums` 返回的单个专辑记录 */
export type Album = AlbumInfo;

/**
 * 专辑唯一身份标识键（品牌类型，避免与 TrackKey 混用）
 * 优先使用宿主生成的 `albumId`；缺失时退回以 `专辑名\0专辑艺术家` 拼接复合键（与宿主折叠算法保持同构）
 */
export type AlbumKey = string & { readonly __brand: 'AlbumKey' };

/**
 * 获取用于展示与排序的专辑艺术家名称
 * 优先取宿主折叠生成的 `albumArtist`；若为空则安全回退至第一首曲目的 `artist` 标签值
 */
export function albumArtistOf(album: Pick<Album, 'albumArtist' | 'artist'>): string {
  return album.albumArtist || album.artist;
}

export function albumKeyOf(album: Pick<Album, 'name' | 'albumArtist' | 'albumId'>): AlbumKey {
  const key = album.albumId ?? `${album.name}\0${album.albumArtist}`;
  return key as AlbumKey;
}

/** 生成专辑键所需的最小曲目元数据字段集合 */
export interface TrackAlbumFields {
  /** 曲目文件路径；若为不进本地媒体库的来源（如在线曲目）则不归属任何本地专辑 */
  readonly path?: string;
  readonly album?: string;
  readonly albumId?: string;
  readonly albumArtists?: readonly string[];
  readonly artists?: readonly string[];
}

/**
 * 提取曲目所属专辑的主艺术家标签：优先取首个 album artist，缺失时回退取首个 artist，均缺失返回空串
 */
export function trackAlbumArtistOf(track: TrackAlbumFields): string {
  return track.albumArtists?.[0] ?? track.artists?.[0] ?? '';
}

/**
 * 计算曲目对应的专辑唯一标识键
 * 若缺少专辑名或属于虚拟在线曲目（避免与同名本地专辑混淆），则安全返回 null
 */
export function trackAlbumKeyOf(track: TrackAlbumFields): AlbumKey | null {
  if (!track.album) return null;
  if (track.path !== undefined && !trackAbilities(track.path).libraryActions) return null;
  return albumKeyOf({
    name: track.album,
    albumArtist: trackAlbumArtistOf(track),
    albumId: track.albumId,
  });
}

/** 年份：`year` 是首个 date 标签的原文（`2019`、`2019-05-01`），只取开头四位数字；没有就是空串 */
export function albumYearOf(album: Pick<Album, 'year'>): string {
  return /^\s*(\d{4})/.exec(album.year)?.[1] ?? '';
}

/**
 * 交给宿主的曲目路径：`path` 加 `|subsong:N`（N 为 0 时不加），`library.addToPlaylist` 与
 * `menu.getContextMenu` 的 handles 都认这种写法。`path` 本身不带后缀
 */
export function trackPathOf(track: Pick<Track, 'path' | 'subsong'>): string {
  return track.subsong > 0 ? `${track.path}|subsong:${track.subsong}` : track.path;
}

/**
 * 媒体库的四个变更信号。载荷带 `handles`（变化曲目的 handle，一次变化超上限时为空而
 * `truncated` 为真）；`itemsModified` 另有 `fromHook`：文件没变、foo_playcount 之类的组件
 * 请 fb2k 刷新它提供的字段时为真，此时路径、标签与专辑归组都没变，页面显示里只有播放统计
 * 可能出新值，其余内容照旧
 */
export const LIBRARY_EVENTS = [
  'library:itemsAdded',
  'library:itemsRemoved',
  'library:itemsModified',
  'library:initialized',
] as const;
export type LibraryEvent = (typeof LIBRARY_EVENTS)[number];

/** 四个库事件里会被读取的载荷字段；旧宿主不发这些键，读作假值或空，行为与不发时一致 */
export interface LibraryEventPayload {
  readonly handles?: readonly string[] | undefined;
  readonly truncated?: boolean | undefined;
  readonly fromHook?: boolean | undefined;
}

/** 库变更连发时的合并窗口，毫秒。库扫描期间事件一串一串地来，每次重拉都是一遍全库扫描 */
export const LIBRARY_COALESCE_MS = 1000;

/** 听库变更要的宿主接口：只订这四个事件 */
export interface LibraryEventsFace {
  on(event: LibraryEvent, handler: (payload: LibraryEventPayload) => void): () => void;
}

/**
 * 四个事件都订上，返回一次全摘掉的函数。`itemsModified` 的 hook 刷新（`fromHook`）不报给
 * handler：标签与归组都没变，整份重拉没有必要；会变的播放统计由 `onLibraryStatsRefresh`
 * 单独订
 */
export function onLibraryChanged(host: LibraryEventsFace, handler: () => void): () => void {
  const offs = LIBRARY_EVENTS.map((event) =>
    host.on(event, (payload) => {
      if (event === 'library:itemsModified' && payload?.fromHook === true) return;
      handler();
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}

/**
 * 只订 `itemsModified` 的 hook 刷新，把载荷交给 handler：`handles` 是变化的曲目，`truncated`
 * 为真时它是空的，要按整份重取对待
 */
export function onLibraryStatsRefresh(
  host: LibraryEventsFace,
  handler: (payload: LibraryEventPayload) => void,
): () => void {
  return host.on('library:itemsModified', (payload) => {
    if (payload?.fromHook === true) handler(payload);
  });
}

export interface LibraryPreferencesFace {
  config: Pick<typeof fb.config, 'showLibraryPreferences'>;
}

/**
 * 打开 foobar2000 首选项里的媒体库一页。主题不能自己添加媒体库文件夹，只能把用户带到这里
 * 宿主照做了为真；失败信封、框架级错误与没连上宿主都为假，怎么提示归调用方
 */
export function openLibraryPreferences(host: LibraryPreferencesFace = fb): Promise<boolean> {
  return hostCommand(() => host.config.showLibraryPreferences());
}
