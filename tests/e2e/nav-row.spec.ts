import { expect, test } from '@playwright/test';
import { choosePlayerBar } from '../fixtures/playerPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';

// 内容卡顶部的导航行，只有播放栏在标题栏时才有：后退、前进与侧边栏键照旧可用，歌词置灰，
// 页面切换的动效不带着它动，窗口跨档时它不重挂、焦点留在原处。播放栏在底部或是胶囊时这几个键在标题栏，
// 见 titlebar.spec.ts

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

test('胶囊形态没有导航行：后退、前进、侧边栏键与歌词、队列都在标题栏', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const { errors } = await openSidebar(page);
  await expect(page.locator('[data-nav-row]')).toHaveCount(0);
  await expect(page.locator('header [data-nav="back"]')).toBeVisible();
  await expect(page.locator('header [data-sidebar-key]')).toBeVisible();
  await expect(page.locator('header').getByRole('button', { name: '播放队列' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('后退、前进走全局历史；侧边栏键照旧藏起与摆回侧边栏', async ({ page }) => {
  const { entry, playlistPage, albumsPage, errors } = await openSidebar(page);
  const navRow = page.locator('[data-nav-row]');
  const back = navRow.getByRole('button', { name: '后退' });
  await expect(back).toBeDisabled();
  await entry('Road Trip').click();
  await expect(playlistPage('Road Trip')).toBeVisible();
  await expect(navRow.getByRole('button', { name: '后退到「专辑」' })).toBeEnabled();
  await navRow.getByRole('button', { name: '后退到「专辑」' }).click();
  await expect(albumsPage).toBeVisible();
  await navRow.getByRole('button', { name: '前进到「Road Trip」' }).click();
  await expect(playlistPage('Road Trip')).toBeVisible();

  await navRow.getByRole('button', { name: '隐藏侧边栏' }).click();
  await expect(page.locator('[data-sidebar]')).toHaveAttribute('data-sidebar', 'none');
  await navRow.getByRole('button', { name: '显示侧边栏' }).click();
  await expect(page.locator('[data-sidebar]')).toHaveAttribute('data-sidebar', 'expanded');
  expect(errors).toEqual([]);
});

test('歌词键可聚焦并开合歌词页，保留当前地点', async ({ page }) => {
  const { albumsPage, errors } = await openSidebar(page);
  const navRow = page.locator('[data-nav-row]');
  const key = navRow.locator('[data-nav="lyrics"]');
  await expect(key).toBeEnabled();
  await expect(key).toHaveAccessibleName('歌词');
  // 悬停不出提示，卡关着时悬停是以浮层预览歌词页
  await key.hover();
  await expect(page.locator('[data-lyrics-panel]')).toBeVisible();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await key.click();
  // 预览的浮层交接给停靠的卡，交接的一瞬两份并存，等剩下一份
  await expect(page.locator('[data-lyrics-panel]')).toHaveCount(1);
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(albumsPage).toBeVisible();
  await key.focus();
  await expect(key).toBeFocused();
  await key.click();
  await expect(page.locator('[data-lyrics-panel]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('队列键开合右侧卡的队列页，卡开着时键亮着', async ({ page }) => {
  const { errors } = await openSidebar(page);
  const key = page.locator('[data-nav-row] [data-nav="queue"]');
  await expect(key).toHaveAccessibleName('播放队列');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await key.click();
  await expect(page.locator('[data-right-card]')).toBeVisible();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await key.click();
  await expect(page.locator('[data-right-card]')).toHaveCount(0);
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('换页时只有导航行下面的页面在动，导航行不在任何一层页面里', async ({ page }) => {
  const { entry, playlistPage, errors } = await openSidebar(page);
  await entry('Road Trip').click();
  // 键自己的悬停、启用这类 CSS 过渡不算；只看有没有动画作用在导航行或它的祖先上
  const moving = await page.locator('[data-nav-row]').evaluate((row) => {
    const layers = document.getAnimations().flatMap((animation) => {
      const effect = animation.effect;
      const target = effect instanceof KeyframeEffect ? effect.target : null;
      return target ? [target] : [];
    });
    return {
      pages: layers.length > 0,
      row: layers.filter((target) => target.contains(row)).map((target) => target.tagName),
    };
  });
  expect(moving).toEqual({ pages: true, row: [] });
  await expect(playlistPage('Road Trip')).toBeVisible();
  expect(errors).toEqual([]);
});

test('窗口跨档时导航行不重挂：焦点在侧边栏键、后退键上的，跨过去还在原处', async ({ page }) => {
  const { entry, playlistPage, errors } = await openSidebar(page);
  const navRow = page.locator('[data-nav-row]');
  await entry('Road Trip').click();
  await expect(playlistPage('Road Trip')).toBeVisible();
  const key = page.locator('[data-sidebar-key]');
  await key.focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(key).toHaveAccessibleName('展开侧边栏');
  await expect(key).toBeFocused();
  const back = navRow.locator('[data-nav="back"]');
  await back.focus();
  await page.setViewportSize({ width: 600, height: 800 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(key).toHaveAccessibleName('隐藏侧边栏');
  await expect(back).toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  expect(errors).toEqual([]);
});
