import { expect, test, type Locator } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { installPageHost } from '../fixtures/pageHost.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';
import { openSongs } from '../fixtures/songsPage.ts';

test.use({ screenshot: 'off', reducedMotion: 'reduce' });

async function bounded(menu: Locator, height: number) {
  await expect(menu).toBeVisible();
  const rect = await menu.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(height + 1);
}

test('低窗口下排序菜单滚动，键盘到末项只滚动菜单', async ({ page }) => {
  await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  await page.setViewportSize({ width: 900, height: 320 });
  await page.goto('/');
  await page.locator('[data-album-tool="sort"]').click();
  const menu = page.locator('[data-scroll-menu]:visible').last();
  await bounded(menu, 320);
  const list = menu.locator('[data-scroll-menu-list]');
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitemradio', { name: '降序', exact: true })).toBeFocused();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-album-tool="sort"]')).toBeFocused();
});

test('列头菜单复用同一滚动区，窗口变矮后仍在视口内', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix');
  await page.setViewportSize({ width: 900, height: 360 });
  await env.grid
    .getByRole('columnheader', { name: '标题', exact: true })
    .click({ button: 'right' });
  const menu = page.locator('[data-scroll-menu]:visible').last();
  await bounded(menu, 360);
  await page.setViewportSize({ width: 900, height: 300 });
  await expect
    .poll(async () => {
      const rect = await menu.boundingBox();
      return rect ? rect.y + rect.height : 1000;
    })
    .toBeLessThanOrEqual(301);
  expect(
    await menu
      .locator('[data-scroll-menu-list]')
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
});

test('条件字段下拉使用同一视口高度限制，可滚到末尾字段', async ({ page }) => {
  const songs = await openSongs(page);
  await page.setViewportSize({ width: 900, height: 360 });
  await songs.view.locator('[data-filter-toggle]').click();
  await songs.view.locator('[data-condition-add]').click();
  await page.getByRole('combobox', { name: '字段', exact: true }).click();
  const list = page.getByRole('listbox');
  await bounded(list, 360);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole('option', { name: '最近播放', exact: true })).toBeInViewport();
});
