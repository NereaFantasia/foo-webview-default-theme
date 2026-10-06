import { expect, test } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  focusedColumn,
  gotoHarness,
  harnessGrid as grid,
  harnessHeader as header,
  harnessLog,
  harnessRow as row,
  openTableHarness,
  storedColumns,
} from '../fixtures/tableHarnessPage.ts';

// 列头的勾选菜单：鼠标与键盘都能开、能勾，改了立刻落盘；关掉之后焦点回到哪里。调用方给了排序与分组段时，
// 列的勾选收进子菜单，其余几段的命令交给调用方。

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

test('给了排序与分组段：第一层的次序，列的勾选收进「列」子菜单照样立刻生效', async ({ page }) => {
  await openTableHarness(page, { albums: 3, rows: 5, menu: true });
  await header(page, '专辑').click({ button: 'right' });
  const first = page.getByRole('menu').first();
  await expect(first.locator(':scope > [role^="menuitem"]')).toHaveText([
    '列',
    '排序',
    '启用分组',
    '分组依据',
    '全部折叠',
    '全部展开',
  ]);
  await expect(page.getByRole('menuitemcheckbox', { name: '启用分组' })).toBeChecked();

  await page.getByRole('menuitem', { name: '列' }).click();
  await page.getByRole('menuitemcheckbox', { name: '艺人' }).click();
  await expect(header(page, '艺人')).toHaveCount(0);
  await expect(page.getByRole('menuitemcheckbox', { name: '艺人' })).not.toBeChecked();
});

test('排序子菜单：点一档、随机与反向交给调用方，点完菜单关掉', async ({ page }) => {
  await openTableHarness(page, { albums: 3, rows: 5, menu: true });
  const pick = async (name: string) => {
    await header(page, '专辑').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '排序' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  await pick('艺人');
  await pick('随机排序');
  await pick('反向');
  expect(await harnessLog(page)).toEqual([
    { type: 'sortBy', id: 'artist' },
    { type: 'shuffle' },
    { type: 'reverse' },
  ]);
});

test('分组开关勾了不关菜单，关掉时依据与折叠置灰；依据选一档交给调用方', async ({ page }) => {
  await openTableHarness(page, { albums: 3, rows: 5, menu: true });
  await header(page, '专辑').click({ button: 'right' });
  const toggle = page.getByRole('menuitemcheckbox', { name: '启用分组' });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('menuitem', { name: '分组依据' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('menuitem', { name: '全部折叠' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await toggle.click();
  await page.getByRole('menuitem', { name: '分组依据' }).click();
  await expect(page.getByRole('menuitemradio', { name: '专辑' })).toBeChecked();
  await page.getByRole('menuitemradio', { name: '艺人' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await harnessLog(page)).toEqual([
    { type: 'grouping', enabled: false },
    { type: 'grouping', enabled: true },
    { type: 'groupMode', mode: 'artist' },
  ]);
});

test('折叠全部、展开全部；键盘从子菜单里点完命令，焦点回到打开菜单的那一格', async ({ page }) => {
  await openTableHarness(page, { albums: 3, rows: 5, menu: true });
  await header(page, '专辑').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '全部折叠' }).click();
  await expect(row(page, 'Track 0001')).toHaveCount(0);
  await header(page, '专辑').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '全部展开' }).click();
  await expect(row(page, 'Track 0001')).toBeVisible();

  await header(page, '专辑').click();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: '排序' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: '标题' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await focusedColumn(page)).toBe('album');
  expect((await harnessLog(page)).at(-1)).toEqual({ type: 'sortBy', id: 'title' });
});
