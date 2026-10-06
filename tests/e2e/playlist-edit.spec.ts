import { expect, test, type Page } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';

// 播放列表页改列表内容的几条：裁剪、移除的失败提示、撤销与重做。移除本身与锁定列表上的 Delete 在
// playlist-page。

const CROP = '{383D4E8D-7E30-4FB8-B5DD-8C975D89E58E}';
const menuOf = (page: Page) => page.locator('[data-playlist-track-menu]');

test('选两行点裁剪：先让宿主选中这两行，再发裁剪的主菜单命令', async ({ page }) => {
  const { host, lists, guid, row, errors } = await openPlaylist(page, 'Mix');
  await row('Mix 2').click();
  await row('Mix 5').click({ modifiers: ['Control'] });
  await row('Mix 5').click({ button: 'right' });
  await menuOf(page).locator('[data-action="crop"]').click();
  await expect
    .poll(() => host.callsTo('menu.runMainMenuCommand'))
    .toMatchObject([{ command: CROP }]);
  expect(lists.content.selection(guid)).toEqual([1, 4]);
  expect(errors).toEqual([]);
});

test('全选时、过滤时、锁着的列表上，裁剪置灰', async ({ page }) => {
  const { view, row, entry, errors } = await openPlaylist(page, 'Mix');
  await row('Mix 2').click();
  await page.keyboard.press('Control+A');
  await row('Mix 2').click({ button: 'right' });
  await expect(menuOf(page).locator('[data-action="crop"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');

  await view.getByRole('textbox', { name: '筛选此播放列表' }).fill('Mix 1');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配');
  await row('Mix 10').click({ button: 'right' });
  await expect(menuOf(page).locator('[data-action="crop"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');

  await entry('Smart').click();
  const smart = page.locator('[data-page="playlist"]');
  await expect(smart.getByRole('heading', { level: 1, name: 'Smart' })).toBeVisible();
  await smart.locator('[role="row"][aria-level="2"]').first().click({ button: 'right' });
  await expect(menuOf(page).locator('[data-action="crop"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(menuOf(page).locator('[data-action="remove"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(errors).toEqual([]);
});

test('宿主没办成移除：出横幅，可以关掉', async ({ page }) => {
  const { host, view, row, errors } = await openPlaylist(page, 'Mix');
  host.answer('playlist.removeSelectedTracks', hostFailure('OPERATION_FAILED'));
  await row('Mix 3').click();
  await page.keyboard.press('Delete');
  const notice = view.locator('[data-playlist-notice="command"]');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '关闭' }).click();
  await expect(notice).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Ctrl+Z 撤销、Ctrl+Y 与 Ctrl+Shift+Z 重做，只在焦点在表格上时认', async ({ page }) => {
  const { host, view, row, errors } = await openPlaylist(page, 'Mix');
  await row('Mix 3').click();
  await page.keyboard.press('Delete');
  await expect(row('Mix 3')).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect(row('Mix 3')).toBeVisible();
  await page.keyboard.press('Control+Y');
  await expect(row('Mix 3')).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(() => host.callsTo('playlist.redo').length).toBe(2);

  await view.getByRole('textbox', { name: '筛选此播放列表' }).focus();
  await page.keyboard.press('Control+Z');
  expect(host.callsTo('playlist.undo')).toHaveLength(2);
  expect(errors).toEqual([]);
});
