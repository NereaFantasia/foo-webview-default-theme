import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import type { PageTransitionKind } from '../motion/pageTransition.ts';
import { MUSIC_LIST_KINDS, type MusicListKind } from '../server/musicProtocol.ts';
import {
  MUSIC_ALBUM_SUBTYPES,
  readMusicRef,
  type MusicAlbumSubType,
  type MusicRef,
} from '../server/musicObjects.ts';

/**
 * 地点表：中央区域能显示的每一种页面。一级地点从侧边栏进，二级地点从一级地点里的内容进；
 * 带主体的地点用同一种页面放不同的对象（哪位艺术家、哪张专辑、哪张列表），换主体就是换地点
 * 侧边栏的图标态与浮层、搜索下拉、菜单、对话框、页内的形态切换都不是地点，不进历史
 */
export const PLACES = {
  /** 跟着正在播放的画面：侧边栏的「视频」项与播放栏的视频键进同一个地点，从播放栏进的调用方自己指明 `drill` */
  video: { level: 1, subject: false },
  home: { level: 1, subject: false },
  /** 在线专辑、歌单（含榜单）或艺人的热门曲目；主体见 `onlineListSubject` */
  onlineList: { level: 2, subject: true },
  /** 在线艺人专辑页签里的一节（专辑、合集、参与的专辑）铺成的一张墙；主体见 `onlineAlbumsSubject` */
  onlineAlbums: { level: 2, subject: true },
  channel: { level: 2, subject: true },
  recent: { level: 1, subject: false },
  /** 列表与详情同页，主体是艺术家名；空串表示未填写 */
  artists: { level: 1, subject: true },
  albums: { level: 1, subject: false },
  /** 主体是专辑键：专辑名 + `\0` + 专辑艺术家（缺则艺术家），与宿主折叠专辑的键同构 */
  album: { level: 2, subject: true },
  songs: { level: 1, subject: false },
  /** 主体：单个流派是标签原值，`EMPTY_GENRE` 是没有流派的曲目，以它开头的其余主体是多选 */
  genres: { level: 1, subject: true },
  folders: { level: 1, subject: true },
  playlists: { level: 1, subject: false },
  /**
   * 主体是哪张列表。从侧边栏的列表项进是一级，从所有播放列表进是二级：
   * 表里记一级，从所有播放列表进的调用方自己指明 `drill`
   */
  playlist: { level: 1, subject: true },
  /** 主体是查询词 */
  search: { level: 2, subject: true },
  settings: { level: 1, subject: false },
  /** 从播放栏进，过渡按二级地点的深入 */
  nowPlaying: { level: 2, subject: false },
} as const satisfies Record<string, { level: 1 | 2; subject: boolean }>;

export type PlaceId = keyof typeof PLACES;

/** 历史里的一个地点：哪种页面，加上可选的主体 */
export interface Place {
  readonly id: PlaceId;
  readonly subject?: string;
}

/** 中央区里每种页面拿到的参数：当前的地点 */
export interface PageProps {
  readonly place: Place;
}

/** 地点的名字：后退、前进键的悬停提示与占位页用它 */
export const PLACE_LABELS: Readonly<Record<PlaceId, MessageKey>> = {
  video: 'place.video',
  home: 'place.home',
  onlineList: 'place.onlineList',
  onlineAlbums: 'place.onlineAlbums',
  channel: 'place.channel',
  recent: 'place.recent',
  artists: 'place.artists',
  albums: 'place.albums',
  album: 'place.album',
  songs: 'place.songs',
  genres: 'place.genres',
  folders: 'place.folders',
  playlists: 'place.playlists',
  playlist: 'place.playlist',
  search: 'place.search',
  settings: 'place.settings',
  nowPlaying: 'place.nowPlaying',
};

/** 打开窗口时落在专辑。历史不落盘，每次打开都从这里记起 */
export const START_PLACE: Place = { id: 'albums' };

/**
 * 地点给人看的名字：后退、前进键的悬停提示与占位页用它。带主体的写主体（专辑写专辑名、列表写列表名、
 * 查询写查询词），其余写地点的名字。列表的主体是 GUID，名字按 `playlistName` 从此刻的清单里查，
 * 查不到（删了、还没读回）写地点名
 */
export function placeName(
  place: Place,
  t: Translate,
  playlistName: (guid: string) => string | undefined = () => undefined,
): string {
  const label = t(PLACE_LABELS[place.id]);
  const subject = place.subject ?? '';
  if (subject === '') return label;
  if (place.id === 'channel') return label;
  if (place.id === 'genres' && !isPlainGenre(subject)) return label;
  if (place.id === 'playlist') return playlistName(subject) || label;
  if (place.id === 'onlineList') return readOnlineListSubject(subject)?.title || label;
  if (place.id === 'onlineAlbums') {
    const wall = readOnlineAlbumsSubject(subject);
    return wall
      ? t('place.onlineAlbumsName', {
          artist: wall.name,
          section: t(WALL_SECTION_LABELS[wall.section]),
        })
      : label;
  }
  if (place.id === 'folders') {
    try {
      const address: unknown = JSON.parse(subject);
      if (!Array.isArray(address) || address.length !== 2) return label;
      const [root, path]: unknown[] = address;
      if (typeof root !== 'string' || typeof path !== 'string') return label;
      return (
        (path || root)
          .replace(/[/\\]+$/, '')
          .split(/[/\\]/)
          .at(-1) || label
      );
    } catch {
      return label;
    }
  }
  // 专辑键是专辑名 + `\0` + 专辑艺术家，只取前半
  if (place.id === 'album') return subject.split('\0')[0] || label;
  return subject;
}

/** 在线列表地点的主体：哪个平台的哪张列表，加上进来时的名字 */
export interface OnlineListSubject {
  readonly kind: MusicListKind;
  readonly ref: MusicRef;
  /** 只给后退、前进的提示与占位用；换了名字算另一条历史，不影响取哪张列表 */
  readonly title: string;
}

export function onlineListSubject(list: OnlineListSubject): string {
  return JSON.stringify([list.ref.platform, list.kind, list.ref.id, list.title]);
}

/** 主体来自历史与存下的播放来源，形状不对时答 null */
export function readOnlineListSubject(subject: string): OnlineListSubject | null {
  try {
    const value: unknown = JSON.parse(subject);
    if (!Array.isArray(value) || value.length !== 4) return null;
    const [platform, kind, id, title]: unknown[] = value;
    const ref = readMusicRef({ platform, id });
    const known = MUSIC_LIST_KINDS.find((item) => item === kind);
    return ref && known && typeof title === 'string' ? { kind: known, ref, title } : null;
  } catch {
    return null;
  }
}

/** 艺人专辑墙能铺开的节，与专辑页签里的前三节一一对应 */
export const ALBUM_WALL_SECTIONS = ['albums', 'compilations', 'featured'] as const;
export type AlbumWallSection = (typeof ALBUM_WALL_SECTIONS)[number];

const WALL_SECTION_LABELS = {
  albums: 'artistAlbums.tab.albums',
  compilations: 'artistAlbums.compilations',
  featured: 'artistAlbums.featured',
} as const satisfies Record<AlbumWallSection, MessageKey>;

/** 艺人专辑墙地点的主体：哪位艺人的哪一节，加上从概览带进来的查找词、排序与版本筛选 */
export interface OnlineAlbumsSubject {
  readonly ref: MusicRef;
  readonly section: AlbumWallSection;
  /** 艺人名：页头写它，联网搜专辑时拼进搜索词；换了名字算另一条历史，不影响取哪位艺人 */
  readonly name: string;
  readonly query: string;
  /** 排序字段的名字由专辑页签认，这里只存 */
  readonly sort: { readonly field: string; readonly descending: boolean };
  readonly versions: readonly MusicAlbumSubType[];
}

export function onlineAlbumsSubject(wall: OnlineAlbumsSubject): string {
  return JSON.stringify([
    wall.ref.platform,
    wall.ref.id,
    wall.section,
    wall.name,
    wall.query,
    wall.sort.field,
    wall.sort.descending,
    wall.versions,
  ]);
}

/** 主体来自历史，形状不对时答 null */
export function readOnlineAlbumsSubject(subject: string): OnlineAlbumsSubject | null {
  try {
    const value: unknown = JSON.parse(subject);
    if (!Array.isArray(value) || value.length !== 8) return null;
    const [platform, id, section, name, query, field, descending, versions]: unknown[] = value;
    const ref = readMusicRef({ platform, id });
    const known = ALBUM_WALL_SECTIONS.find((item) => item === section);
    if (
      !ref ||
      !known ||
      typeof name !== 'string' ||
      typeof query !== 'string' ||
      typeof field !== 'string' ||
      typeof descending !== 'boolean' ||
      !Array.isArray(versions)
    )
      return null;
    const kinds = MUSIC_ALBUM_SUBTYPES.filter((kind) => versions.includes(kind));
    if (kinds.length !== versions.length) return null;
    return { ref, section: known, name, query, sort: { field, descending }, versions: kinds };
  } catch {
    return null;
  }
}

/** 标签不能包含 NUL，保留此主体表示没有流派的曲目；以它开头的主体都是保留的（`\0[` 起头的是多选） */
export const EMPTY_GENRE = '\0';

/** 单个流派的页面主体就是标签原值；空串与保留前缀开头的不是单个流派 */
export function isPlainGenre(value: string): boolean {
  return value !== '' && !value.startsWith(EMPTY_GENRE);
}

export function samePlace(a: Place, b: Place): boolean {
  return a.id === b.id && (a.subject ?? null) === (b.subject ?? null);
}

/** 去一个地点时缺省的过渡：去一级地点是页面刷新，去二级地点是深入 */
export function defaultTransition(id: PlaceId): PageTransitionKind {
  return PLACES[id].level === 2 ? 'drill' : 'refresh';
}
