import { expect, test, type Page } from '@playwright/test';
import { choosePlayerBar } from '../fixtures/playerPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';

// 内容卡顶部的导航行，只有播放栏在标题栏时才有：几何照设计量，后退、前进与侧边栏键照旧可用，歌词置灰，
// 页面切换的动效不带着它动，窗口跨档时它不重挂、焦点留在原处。播放栏在底部或是胶囊时这几个键在标题栏，
// 见 titlebar.spec.ts。

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

type Box = { x: number; y: number; width: number; height: number };

/** 导航行里各件相对内容卡左上角的位置，取整到像素。 */
function layoutOf(page: Page) {
  return page.locator('[data-nav-row]').evaluate((row) => {
    const card = row.parentElement?.getBoundingClientRect();
    const of = (element: Element | null | undefined): Box | null => {
      if (!element || !card) return null;
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x - card.x),
        y: Math.round(box.y - card.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    return {
      card: card ? { width: Math.round(card.width) } : null,
      history: of(row.querySelector('[data-nav="back"]')?.parentElement),
      sidebarKey: of(row.querySelector('[data-sidebar-key]')?.parentElement),
      panels: of(row.querySelector('[data-nav="lyrics"]')?.parentElement),
      back: of(row.querySelector('[data-nav="back"]')),
    };
  });
}

test('导航行离卡片上缘 12、左右各 24；「后退 前进」91 × 36、中间一道竖线，侧边栏键 36 × 36，与胶囊隔 8', async ({
  page,
}) => {
  const { errors } = await openSidebar(page);
  const layout = await layoutOf(page);
  const cardWidth = layout.card?.width ?? 0;
  // 内容卡有 1 像素的描边，里面的东西从描边内侧量起。
  expect(layout.history).toEqual({ x: 25, y: 13, width: 91, height: 36 });
  expect(layout.sidebarKey).toEqual({ x: 25 + 91 + 8, y: 13, width: 36, height: 36 });
  expect(layout.panels).toEqual({ x: cardWidth - 1 - 24 - 88, y: 13, width: 88, height: 36 });
  const divider = await page
    .locator('[data-nav-row] [data-nav="back"] + [aria-hidden]')
    .evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width: Math.round(width), height: Math.round(height) };
    });
  expect(divider).toEqual({ width: 1, height: 16 });
  expect(errors).toEqual([]);
});

test('胶囊里的键 40 × 30、侧边栏键 30 × 30，离外框四周都是 3，悬停底与外框同心', async ({
  page,
}) => {
  const { errors } = await openSidebar(page);
  const layout = await layoutOf(page);
  expect(layout.back).toEqual({ x: 25 + 3, y: 13 + 3, width: 40, height: 30 });
  const keys = await page.locator('[data-nav-row]').evaluate((row) => {
    const of = (selector: string) => {
      const key = row.querySelector(selector);
      const frame = key?.parentElement;
      if (!key || !frame) return null;
      const inner = key.getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      return {
        width: Math.round(inner.width),
        height: Math.round(inner.height),
        top: Math.round(inner.top - outer.top),
        bottom: Math.round(outer.bottom - inner.bottom),
        // 圆角超过半高的按半高画：外框 18、键 15，差的 3 正好是间距。
        radius: {
          frame: Math.min(
            parseFloat(getComputedStyle(frame).borderTopLeftRadius),
            outer.height / 2,
          ),
          key: Math.min(parseFloat(getComputedStyle(key).borderTopLeftRadius), inner.height / 2),
        },
      };
    };
    return {
      queue: of('[data-nav="queue"]'),
      forward: of('[data-nav="forward"]'),
      sidebar: of('[data-sidebar-key]'),
    };
  });
  const radius = { frame: 18, key: 15 };
  expect(keys.queue).toEqual({ width: 40, height: 30, top: 3, bottom: 3, radius });
  expect(keys.forward).toEqual({ width: 40, height: 30, top: 3, bottom: 3, radius });
  expect(keys.sidebar).toEqual({ width: 30, height: 30, top: 3, bottom: 3, radius });
  expect(errors).toEqual([]);
});

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
  await key.hover();
  await expect(page.getByRole('tooltip', { name: '歌词', exact: true })).toBeVisible();
  await key.click();
  await expect(page.locator('[data-lyrics-panel]')).toBeVisible();
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
  // 键自己的悬停、启用这类 CSS 过渡不算；只看有没有动画作用在导航行或它的祖先上。
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
