import { expect, test } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  focusedColumn,
  gotoHarness,
  harnessGrid as grid,
  harnessHeader as header,
  harnessRow as row,
  openTableHarness,
  storedColumns,
} from '../fixtures/tableHarnessPage.ts';

// 列头的勾选菜单：鼠标与键盘都能开、能勾，改了立刻落盘；关掉之后焦点回到哪里。菜单里只有列的勾选，排序与
// 分组不在这里。

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('列头右键勾掉一列，落盘后重载还藏着；标题列勾不掉', async ({ page }) => {
  await openTableHarness(page);
  await header(page, '艺人').click({ button: 'right' });
  await expect(page.getByRole('menuitemcheckbox', { name: '标题' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('menuitemcheckbox', { name: '艺人' }).click();
  await expect(header(page, '艺人')).toHaveCount(0);
  await expect(grid(page).locator('[role="gridcell"][data-column-id="artist"]')).toHaveCount(0);
  expect(await storedColumns(page)).toMatchObject({ hidden: ['artist'] });

  await gotoHarness(page);
  await expect(header(page, '标题')).toBeVisible();
  await expect(header(page, '艺人')).toHaveCount(0);
  await header(page, '标题').click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: '艺人' }).click();
  await expect(header(page, '艺人')).toBeVisible();
});

test('Shift+F10 与 Menu 键在列头上开菜单，空格勾选；Esc 关掉后焦点回到那一格', async ({ page }) => {
  await openTableHarness(page);
  await header(page, '专辑').click();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await focusedColumn(page)).toBe('album');

  await page.keyboard.press('ContextMenu');
  await page.getByRole('menuitemcheckbox', { name: '艺人' }).focus();
  await page.keyboard.press(' ');
  await expect(header(page, '艺人')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await focusedColumn(page)).toBe('album');
});

test('把焦点所在的那一列藏掉，关菜单后焦点回到表格', async ({ page }) => {
  await openTableHarness(page);
  await header(page, '艺人').click();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitemcheckbox', { name: '艺人' }).focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('Escape');
  await expect(header(page, '艺人')).toHaveCount(0);
  await expect(grid(page)).toBeFocused();
});

test('菜单开着时点一行：菜单关掉，焦点留在表格上，键盘接着走', async ({ page }) => {
  await openTableHarness(page);
  await header(page, '专辑').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await row(page, 'Track 0003').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Track 0004')).toHaveAttribute('data-row-focus', 'true');
});
