import { expect, test } from '@playwright/test';
import { openSearchBox } from '../fixtures/searchBox.ts';
import { openSongs } from '../fixtures/songsPage.ts';

test.use({ screenshot: 'off' });

// 文本框的编辑菜单挂在 App 层，在各浮层的组件树之外：开着它、点它的菜单项，都不该把输入框所在的浮层收掉

test('搜索框的右键编辑菜单：开着时、点了菜单项后、按 Esc 后，搜索下拉都不收', async ({ page }) => {
  const { errors, input, closedCount } = await openSearchBox(page);
  await input.fill('hello');
  await input.click({ button: 'right' });
  const menu = page.locator('[data-edit-menu]');
  await expect(menu).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'true');

  await menu.getByRole('menuitem', { name: /全选/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toBeFocused();

  // 菜单开着按 Esc 只关菜单，下拉留着
  await input.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(await closedCount()).toBe(0);
  expect(errors).toEqual([]);
});

test('筛选浮层里的分面搜索框：右键编辑菜单点了菜单项，浮层还在、字还在', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-filter-toggle]').click();
  const surface = songs.view.locator('[data-filter-surface]');
  await expect(surface).toBeVisible();
  const box = surface.locator('[data-facet-column="artist"]').getByRole('textbox', {
    name: '筛选艺人',
  });
  await box.fill('mass');
  await box.click({ button: 'right' });
  const menu = page.locator('[data-edit-menu]');
  await expect(menu).toBeVisible();
  await expect(surface).toBeVisible();

  await menu.getByRole('menuitem', { name: /全选/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(surface).toBeVisible();
  await expect(box).toHaveValue('mass');
  await expect(box).toBeFocused();
  expect(songs.errors).toEqual([]);
});
