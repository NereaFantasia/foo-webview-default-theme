import { expect, type Locator, type Page } from '@playwright/test';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { FakePlaylists, makePlaylist } from './fakePlaylists.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

// 侧边栏的 e2e 共用：装上带一份记账播放列表的宿主替身再打开页面，按名字找列表行。

/** 缺省的四张：活动的 Default、正在播放的 Chill、Road Trip、智能列表 Smart。 */
export const DEFAULT_LISTS: readonly PlaylistInfo[] = [
  makePlaylist(0, 'Default', { isActive: true, trackCount: 3 }),
  makePlaylist(1, 'Chill', { isPlaying: true, trackCount: 12 }),
  makePlaylist(2, 'Road Trip', { trackCount: 48 }),
  makePlaylist(3, 'Smart', { isAutoplaylist: true, isLocked: true }),
];

export interface SidebarPage {
  readonly host: PageHost;
  readonly lists: FakePlaylists;
  readonly errors: string[];
  readonly nav: Locator;
  /** 按名字找列表那一行（导航项本身，带 `data-playlist-entry`）。 */
  entry(name: string): Locator;
  /** 地点的占位页。 */
  /** 播放列表页的标题，按列表名认页面。 */
  playlistPage(name: string): Locator;
  /** 专辑页的标题，启动与后退回专辑时用它认页面。 */
  readonly albumsPage: Locator;
}

export async function openSidebar(
  page: Page,
  initial: readonly PlaylistInfo[] = DEFAULT_LISTS,
): Promise<SidebarPage> {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page);
  const lists = new FakePlaylists(host, initial, (event, payload) => host.emit(event, payload));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '侧边栏' });
  const entry = (name: string) => nav.locator(`[data-playlist-entry="${lists.guid(name)}"]`);
  const first = initial[0];
  if (first) await expect(entry(first.name)).toBeVisible();
  return {
    host,
    lists,
    errors,
    nav,
    entry,
    playlistPage: (name) =>
      page.locator('[data-page="playlist"]').getByRole('heading', { level: 1, name, exact: true }),
    albumsPage: page.getByRole('heading', { level: 1, name: '专辑' }),
  };
}

/** 经 CDP 发一次可信的侧键点击；Playwright 的 mouse 只有左、中、右三个键。 */
export async function clickSideButton(page: Page, button: 'back' | 'forward'): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: 600, y: 400, button, clickCount: 1 });
  }
  await cdp.detach();
}
