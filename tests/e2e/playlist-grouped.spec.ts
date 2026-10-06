import { expect, test } from '@playwright/test';
import { albumTracks, openPlaylist } from '../fixtures/playlistPage.ts';

// 播放列表页的分组：组头的内容与开合、分组开关、组封面只对画出来的组取、跨目录多张、F5 重取封面。

const A1 = 'Album 1 | Artist 1';

test('组头排成一条：专辑、艺术家、首数与年份；点组头折起整组，再点展开', async ({ page }) => {
  const { group, row, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const head = group(A1);
  await expect(head).toContainText('Album 1');
  await expect(head).toContainText('Artist 1');
  await expect(head).toContainText('4 首');
  await expect(head).toContainText('2001');
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(row('Mix 1')).toBeVisible();

  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(row('Mix 1')).toHaveCount(0);
  await expect(row('Mix 5')).toBeVisible();
  await head.click();
  await expect(row('Mix 1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('列头菜单关掉分组：没有组头也没有封面列；再打开回到分组', async ({ page }) => {
  const { view, grid, group, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const cover = grid.locator('[role="columnheader"][data-column-id="cover"]');
  await expect(cover).toHaveCount(1);
  await view.getByRole('columnheader', { name: '标题' }).click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: '启用分组' }).click();
  await page.keyboard.press('Escape');
  await expect(group(A1)).toHaveCount(0);
  await expect(cover).toHaveCount(0);
  await expect(grid.locator('[role="row"][aria-level="1"]').first()).toBeVisible();

  await view.getByRole('columnheader', { name: '标题' }).click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: '启用分组' }).click();
  await page.keyboard.press('Escape');
  await expect(group(A1)).toBeVisible();
  expect(errors).toEqual([]);
});

test('全部折叠后只取组头那几行所在的页，组与组之间的行不取', async ({ page }) => {
  // 每组 500 首，两个组头之间隔着两页多。
  const { host, view, group, errors } = await openPlaylist(
    page,
    'Mix',
    albumTracks('Mix', 40, 500),
  );
  await expect(group(A1)).toBeVisible();
  await view.getByRole('columnheader', { name: '标题' }).click({ button: 'right' });
  const before = host.callsTo('playlist.getTracks').length;
  await page.getByRole('menuitem', { name: '全部折叠' }).click();
  await expect(group('Album 12 | Artist 12')).toBeVisible();
  await expect(group('Album 12 | Artist 12').locator('[data-group-pending]')).toHaveCount(0);
  const starts = host
    .callsTo('playlist.getTracks')
    .slice(before)
    .map((call) => call['start']);
  expect(starts).toContain(5000);
  // 第 3、4 页（600 起、800 起）落在第一、二组的组头之间。
  expect(starts).not.toContain(600);
  expect(starts).not.toContain(800);
  expect(errors).toEqual([]);
});

test('组封面只对画出来的组取，请求量不随列表长度涨；同组跨目录出多张', async ({ page }) => {
  // 每组四首轮流放进两个目录：组首与组尾（封面的采样点）落在不同目录。
  const { host, group, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 80, 4, 2));
  await expect(group(A1).locator('img')).toHaveCount(2);
  const asked = host.callsTo('artwork.getFb2kUrlByPath');
  // 80 组、每组两个目录：全取要 160 次，一屏只画得下十来组。
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.length).toBeLessThan(60);
  expect(errors).toEqual([]);
});

test('F5 重取看得见的组封面，不动选中与滚动', async ({ page }) => {
  const { host, row, grid, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  await row('Mix 2').click();
  await expect.poll(() => host.callsTo('artwork.getFb2kUrlByPath').length).toBeGreaterThan(0);
  const before = host.callsTo('artwork.getFb2kUrlByPath').length;
  await page.keyboard.press('F5');
  await expect.poll(() => host.callsTo('artwork.getFb2kUrlByPath').length).toBeGreaterThan(before);
  await expect(row('Mix 2')).toHaveAttribute('aria-selected', 'true');
  await expect(grid).toBeFocused();
  expect(errors).toEqual([]);
});
