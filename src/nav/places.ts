import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import type { PageTransitionKind } from '../motion/pageTransition.ts';

/**
 * 地点表：中央区域能显示的每一种页面。一级地点从侧边栏进，二级地点从一级地点里的内容进；
 * 带主体的地点用同一种页面放不同的对象（哪位艺术家、哪张专辑、哪张列表），换主体就是换地点。
 * 侧边栏的图标态与浮层、搜索下拉、菜单、对话框、页内的形态切换都不是地点，不进历史。
 */
export const PLACES = {
  video: { level: 2, subject: false },
  home: { level: 1, subject: false },
  channel: { level: 2, subject: true },
  recent: { level: 1, subject: false },
  /** 列表与详情同页，主体是艺术家名；空串表示未填写。 */
  artists: { level: 1, subject: true },
  albums: { level: 1, subject: false },
  /** 主体是专辑键：专辑名 + `\0` + 专辑艺术家（缺则艺术家），与宿主折叠专辑的键同构。 */
  album: { level: 2, subject: true },
  songs: { level: 1, subject: false },
  genres: { level: 1, subject: true },
  /** 主体是流派名。 */
  genre: { level: 2, subject: true },
  folders: { level: 1, subject: true },
  playlists: { level: 1, subject: false },
  /**
   * 主体是哪张列表。从侧边栏的列表项进是一级，从所有播放列表进是二级：
   * 表里记一级，从所有播放列表进的调用方自己指明 `drill`。
   */
  playlist: { level: 1, subject: true },
  /** 主体是查询词。 */
  search: { level: 2, subject: true },
  settings: { level: 1, subject: false },
  /** 从播放栏进，过渡按二级地点的深入。 */
  nowPlaying: { level: 2, subject: false },
} as const satisfies Record<string, { level: 1 | 2; subject: boolean }>;

export type PlaceId = keyof typeof PLACES;

/** 历史里的一个地点：哪种页面，加上可选的主体。 */
export interface Place {
  readonly id: PlaceId;
  readonly subject?: string;
}

/** 中央区里每种页面拿到的参数：当前的地点。 */
export interface PageProps {
  readonly place: Place;
}

/** 地点的名字：后退、前进键的悬停提示与占位页用它。 */
export const PLACE_LABELS: Readonly<Record<PlaceId, MessageKey>> = {
  video: 'place.video',
  home: 'place.home',
  channel: 'place.channel',
  recent: 'place.recent',
  artists: 'place.artists',
  albums: 'place.albums',
  album: 'place.album',
  songs: 'place.songs',
  genres: 'place.genres',
  genre: 'place.genre',
  folders: 'place.folders',
  playlists: 'place.playlists',
  playlist: 'place.playlist',
  search: 'place.search',
  settings: 'place.settings',
  nowPlaying: 'place.nowPlaying',
};

/** 打开窗口时落在专辑。历史不落盘，每次打开都从这里记起。 */
export const START_PLACE: Place = { id: 'albums' };

/**
 * 地点给人看的名字：后退、前进键的悬停提示与占位页用它。带主体的写主体（专辑写专辑名、列表写列表名、
 * 查询写查询词），其余写地点的名字。列表的主体是 GUID，名字按 `playlistName` 从此刻的清单里查，
 * 查不到（删了、还没读回）写地点名。
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
  if (place.id === 'genres' && subject.startsWith('\0')) return label;
  if (place.id === 'playlist') return playlistName(subject) || label;
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
  // 专辑键是专辑名 + `\0` + 专辑艺术家，只取前半。
  if (place.id === 'album') return subject.split('\0')[0] || label;
  return subject;
}

export function samePlace(a: Place, b: Place): boolean {
  return a.id === b.id && (a.subject ?? null) === (b.subject ?? null);
}

/** 去一个地点时缺省的过渡：去一级地点是页面刷新，去二级地点是深入。 */
export function defaultTransition(id: PlaceId): PageTransitionKind {
  return PLACES[id].level === 2 ? 'drill' : 'refresh';
}
