import { expect, test } from '@playwright/test';
import { albumTracks, openPlaylist } from '../fixtures/playlistPage.ts';

// 播放列表页的分组：组头的内容与开合、分组开关、组封面只对画出来的组取、跨目录多张、F5 重取封面

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

test('视图面板选「不分组」：没有组头也没有封面列；再选回缺省依据回到分组', async ({ page }) => {
  const { view, grid, group, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const cover = grid.locator('[role="columnheader"][data-column-id="cover"]');
  await expect(cover).toHaveCount(1);
  await view.locator('[data-playlist-view]').click();
  await page.locator('[data-view-grouping]').click();
  await page.getByRole('option', { name: '不分组', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(group(A1)).toHaveCount(0);
  await expect(cover).toHaveCount(0);
  await expect(grid.locator('[role="row"][aria-level="1"]').first()).toBeVisible();

  await view.locator('[data-playlist-view]').click();
  await page.locator('[data-view-grouping]').click();
  await page.getByRole('option', { name: '专辑艺人、专辑、光盘', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(group(A1)).toBeVisible();
  expect(errors).toEqual([]);
});

test('全部折叠后只取组头那几行所在的页，组与组之间的行不取', async ({ page }) => {
  // 每组 500 首，两个组头之间隔着两页多
  const { host, view, group, errors } = await openPlaylist(
    page,
    'Mix',
    albumTracks('Mix', 40, 500),
  );
  await expect(group(A1)).toBeVisible();
  await view.locator('[data-playlist-view]').click();
  const before = host.callsTo('playlist.getTracks').length;
  await page.locator('[data-action="collapse"]').click();
  await page.keyboard.press('Escape');
  await expect(group('Album 12 | Artist 12')).toBeVisible();
  await expect(group('Album 12 | Artist 12').locator('[data-group-pending]')).toHaveCount(0);
  const starts = host
    .callsTo('playlist.getTracks')
    .slice(before)
    .map((call) => call['start']);
  expect(starts).toContain(5000);
  // 第 3、4 页（600 起、800 起）落在第一、二组的组头之间
  expect(starts).not.toContain(600);
  expect(starts).not.toContain(800);
  expect(errors).toEqual([]);
});

test('组封面只对画出来的组取，请求量不随列表长度涨；同组跨目录出多张', async ({ page }) => {
  // 每组四首轮流放进两个目录：组首与组尾（封面的采样点）落在不同目录
  const { host, group, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 80, 4, 2));
  await expect(group(A1).locator('img')).toHaveCount(2);
  const asked = host.callsTo('artwork.getFb2kUrlByPath');
  // 80 组、每组两个目录：全取要 160 次，一屏只画得下十来组
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

/** 两张专辑各两首，顺序隔开：专辑 1、2、1、2，同一专辑被拆成两段 */
function interleaved(list: string) {
  const [a1, a2, b1, b2] = albumTracks(list, 2, 2);
  return [a1, b1, a2, b2].flatMap((track) => (track ? [track] : []));
}

test('锁定的自动播放列表里同一组被拆成几段：横幅说明无法排序并带编辑入口', async ({ page }) => {
  const { view, errors } = await openPlaylist(page, 'Smart', interleaved('Smart'));
  const notice = view.locator('[data-playlist-notice="groupsLocked"]');
  await expect(notice).toContainText('此自动播放列表无法排序，仅展示分组');
  await expect(notice.getByRole('button', { name: '编辑自动播放列表' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('没锁的列表顺序再乱也不出这条横幅', async ({ page }) => {
  const { view, group, errors } = await openPlaylist(page, 'Mix', interleaved('Mix'));
  // 分组画出来时横幅的条件已经定了，再数才不是在横幅出现之前数到零
  await expect(group(A1).first()).toBeVisible();
  await expect(view.locator('[data-playlist-notice="groupsLocked"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
