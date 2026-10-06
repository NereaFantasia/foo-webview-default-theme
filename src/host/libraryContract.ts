import type { AlbumInfo, Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { hostCommand } from './hostCall.ts';

/** 一张专辑，就是 `library.getAlbums` 答的那一行。 */
export type Album = AlbumInfo;

/**
 * 专辑身份：专辑名 + `\0` + 专辑艺术家，与宿主 `LibraryGetAlbums` 折叠专辑用的键同构。第二段取行里的
 * `albumArtist`：宿主折叠时 album artist 首值，没有这个标签取 artist 首值，都没有是空串，并把同一个值
 * 写进行的 `albumArtist`。品牌类型只为了不与曲目键、节键混用；构造只走 `albumKeyOf`。
 */
export type AlbumKey = string & { readonly __brand: 'AlbumKey' };

/**
 * 显示用的专辑艺术家：宿主已按「album artist 首值，缺则 artist 首值」落好 `albumArtist`，两个标签都
 * 没有时为空。为空时再看 `artist`（album artist 标签在而值为空时，它是这张里按库序第一首 artist
 * 不为空的曲目的 artist 首值），与宿主排序、过滤专辑时的写法一致。显示、分节、排序与筛选用它；专辑键与取曲目用 `albumArtist` 本身。
 */
export function albumArtistOf(album: Pick<Album, 'albumArtist' | 'artist'>): string {
  return album.albumArtist || album.artist;
}

export function albumKeyOf(album: Pick<Album, 'name' | 'albumArtist'>): AlbumKey {
  const key = `${album.name}\0${album.albumArtist}`;
  return key as AlbumKey;
}

/** 折专辑键要的曲目字段；媒体库曲目、播放中的曲目与投影过的搜索命中行都有。 */
export interface TrackAlbumFields {
  readonly album?: string;
  readonly albumArtists?: readonly string[];
  readonly artists?: readonly string[];
}

/**
 * 一首曲目折进的那张专辑的艺术家，与宿主 `library.getAlbums` 同一写法：album artist 首值，没有这个
 * 标签时取 artist 首值，两样都没有是空串。album artist 有多个值时不能用连起来的 `albumArtist`。
 */
export function trackAlbumArtistOf(track: TrackAlbumFields): string {
  return track.albumArtists?.[0] ?? track.artists?.[0] ?? '';
}

/** 一首曲目属于哪张专辑；没有专辑名的不属于任何一张，答 null。 */
export function trackAlbumKeyOf(track: TrackAlbumFields): AlbumKey | null {
  if (!track.album) return null;
  return albumKeyOf({ name: track.album, albumArtist: trackAlbumArtistOf(track) });
}

/** 年份：`year` 是首个 date 标签的原文（`2019`、`2019-05-01`），只取开头四位数字；没有就是空串。 */
export function albumYearOf(album: Pick<Album, 'year'>): string {
  return /^\s*(\d{4})/.exec(album.year)?.[1] ?? '';
}

/**
 * 交给宿主的曲目路径：`path` 加 `|subsong:N`（N 为 0 时不加），`library.addToPlaylist` 与
 * `menu.getContextMenu` 的 handles 都认这种写法。`path` 本身不带后缀。
 */
export function trackPathOf(track: Pick<Track, 'path' | 'subsong'>): string {
  return track.subsong > 0 ? `${track.path}|subsong:${track.subsong}` : track.path;
}

/**
 * 媒体库的四个变更信号。载荷只有条数与时间戳，不带路径；宿主发出之前已经丢了自己的专辑与
 * 艺术家缓存，所以收到就该整份重拉。
 */
export const LIBRARY_EVENTS = [
  'library:itemsAdded',
  'library:itemsRemoved',
  'library:itemsModified',
  'library:initialized',
] as const;
export type LibraryEvent = (typeof LIBRARY_EVENTS)[number];

/** 库变更连发时的合并窗口，毫秒。库扫描期间事件一串一串地来，每次重拉都是一遍全库扫描。 */
export const LIBRARY_COALESCE_MS = 1000;

/** 听库变更要的宿主接口：只订这四个事件，载荷不读。 */
export interface LibraryEventsFace {
  on(event: LibraryEvent, handler: () => void): () => void;
}

/** 四个事件都订上，返回一次全摘掉的函数。 */
export function onLibraryChanged(host: LibraryEventsFace, handler: () => void): () => void {
  const offs = LIBRARY_EVENTS.map((event) => host.on(event, handler));
  return () => {
    for (const off of offs) off();
  };
}

export interface LibraryPreferencesFace {
  config: Pick<typeof fb.config, 'showLibraryPreferences'>;
}

/**
 * 打开 foobar2000 首选项里的媒体库一页。主题不能自己添加媒体库文件夹，只能把用户带到这里。
 * 宿主照做了为真；失败信封、框架级错误与没连上宿主都为假，怎么提示归调用方。
 */
export function openLibraryPreferences(host: LibraryPreferencesFace = fb): Promise<boolean> {
  return hostCommand(() => host.config.showLibraryPreferences());
}
