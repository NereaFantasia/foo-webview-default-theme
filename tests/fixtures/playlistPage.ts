import { expect, type Locator, type Page } from '@playwright/test';
import type { PlaylistInfo, PlaylistTrack } from 'foo-webview-sdk';
import { makePlaylist, makeRow } from './fakePlaylists.ts';
import { openSidebar, type SidebarPage } from './sidebarPage.ts';

// 播放列表页的 e2e 共用：装上带记账播放列表的宿主替身，给一张列表放好曲目，从侧边栏点进它的页。

/** 缺省的三张：活动的 Default、要进的 Mix、锁着的智能列表 Smart。 */
export const PLAYLIST_LISTS: readonly PlaylistInfo[] = [
  makePlaylist(0, 'Default', { isActive: true, trackCount: 3 }),
  makePlaylist(1, 'Mix', { trackCount: 12 }),
  makePlaylist(2, 'Smart', { isAutoplaylist: true, isLocked: true, trackCount: 4 }),
];

/**
 * 一张按专辑排好的列表：每张专辑 `perAlbum` 首，专辑名 `Album 1` 起，年份 2001 起；`dirs` 给了时第 n 首放进
 * 第 n % dirs 个目录，拿来造跨目录的组。
 */
export function albumTracks(
  list: string,
  albums: number,
  perAlbum: number,
  dirs = 1,
): PlaylistTrack[] {
  return Array.from({ length: albums * perAlbum }, (_, row) => {
    const album = Math.floor(row / perAlbum) + 1;
    const folder = `${list}/Album ${album}${dirs > 1 ? `/CD${(row % dirs) + 1}` : ''}`;
    return makeRow(list, row, {
      album: `Album ${album}`,
      albumArtist: `Artist ${album}`,
      artist: `Artist ${album}`,
      date: String(2000 + album),
      trackNumber: (row % perAlbum) + 1,
      path: `file://E:/Music/${folder}/${String(row + 1).padStart(3, '0')}.flac`,
    });
  });
}

export interface PlaylistPage extends SidebarPage {
  readonly guid: string;
  /** 播放列表页本身。 */
  readonly view: Locator;
  readonly grid: Locator;
  /** 标题正是 `title` 的那一行曲目。 */
  row(title: string): Locator;
  /** 组键是 `key` 的组头；缺省分组依据下是「专辑 | 专辑艺术家」，如 `Album 1 | Artist 1`。 */
  group(key: string): Locator;
}

/** 打开侧边栏，给 `name` 那张放上 `tracks`（不给就按曲目数现造），点进它的页，等表格画出来。 */
export async function openPlaylist(
  page: Page,
  name: string,
  tracks?: readonly PlaylistTrack[],
  lists: readonly PlaylistInfo[] = PLAYLIST_LISTS,
): Promise<PlaylistPage> {
  const sidebar = await openSidebar(page, lists);
  const guid = sidebar.lists.guid(name);
  if (tracks) sidebar.lists.setTracks(guid, tracks);
  await sidebar.entry(name).click();
  const view = page.locator('[data-page="playlist"]');
  await expect(view.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  const grid = view.getByRole('treegrid', { name: '曲目' });
  await expect(grid).toBeVisible();
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    ...sidebar,
    guid,
    view,
    grid,
    row: (title) => grid.getByRole('row', { name: new RegExp(`(^|\\s)${escaped(title)}(\\s|$)`) }),
    group: (key) => grid.locator(`[role="row"]:has([data-playlist-group="${key}"])`),
  };
}
