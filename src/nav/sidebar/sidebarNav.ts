import type { Place, PlaceId } from '../places.ts';

/**
 * 侧边栏的固定导航项：每一项是一个一级地点，点它经全局历史切过去，与后退、前进走同一条路。
 * 播放列表节里的各张列表不在这张表里，它们随宿主的清单变，由那一节自己画。
 *
 * 页面还没上线的项 `ready` 为假：照样画出来、置灰，悬停提示「即将推出」，点了不去任何地方。
 */
export type SidebarItemId =
  | 'home'
  | 'recent'
  | 'artists'
  | 'albums'
  | 'songs'
  | 'genres'
  | 'folders'
  | 'playlists'
  | 'settings';

export interface SidebarEntry {
  readonly id: SidebarItemId;
  readonly place: PlaceId;
  readonly ready: boolean;
}

const item = (id: SidebarItemId, ready = false): SidebarEntry => ({ id, place: id, ready });

export const TOP_ITEMS: readonly SidebarEntry[] = [item('home', true)];

export const LIBRARY_ITEMS: readonly SidebarEntry[] = [
  item('recent'),
  item('artists', true),
  item('albums', true),
  item('songs', true),
  item('genres', true),
  item('folders', true),
];

/** 播放列表节头部的「所有播放列表」。 */
export const ALL_PLAYLISTS_ITEM: SidebarEntry = item('playlists');

export const SETTINGS_ITEM: SidebarEntry = item('settings', true);

export const SIDEBAR_ITEMS: readonly SidebarEntry[] = [
  ...TOP_ITEMS,
  ...LIBRARY_ITEMS,
  ALL_PLAYLISTS_ITEM,
  SETTINGS_ITEM,
];

/** 二级地点点亮进它的那个一级地点：进了专辑详情页，侧边栏仍亮着「专辑」。 */
const PARENT_ITEM: Partial<Record<PlaceId, SidebarItemId>> = {
  channel: 'home',
  album: 'albums',
  genre: 'genres',
};

/**
 * 当前地点在侧边栏里点亮哪一处：一个固定项，或播放列表节里的一张（带主体，由那一节按主体认）；
 * 搜索结果页与正在播放全屏页在侧边栏里没有对应项，一处都不亮。
 */
export type SidebarSelection =
  | { readonly kind: 'item'; readonly id: SidebarItemId }
  | { readonly kind: 'playlist'; readonly subject: string };

export function sidebarSelectionOf(place: Place): SidebarSelection | null {
  if (place.id === 'playlist') {
    return place.subject === undefined ? null : { kind: 'playlist', subject: place.subject };
  }
  const own = SIDEBAR_ITEMS.find((candidate) => candidate.place === place.id);
  const id = own?.id ?? PARENT_ITEM[place.id];
  return id ? { kind: 'item', id } : null;
}

/** 导航项的选中键：固定项是 `item:` 加项名，播放列表是 `playlist:` 加它的 GUID。 */
export const itemKey = (id: SidebarItemId): string => `item:${id}`;
export const playlistKey = (guid: string): string => `playlist:${guid}`;
