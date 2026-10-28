import { expect, test } from '@playwright/test';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';

test.use({ screenshot: 'off' });

test('播放列表列菜单提供元数据、音频属性和统计，选中后显示真实值', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix', [
    makeRow('Mix', 0, {
      title: 'Example',
      albumArtist: 'Album Artist',
      genre: 'Jazz',
      date: '2001',
      codec: 'FLAC',
      bitrate: 900,
      sampleRate: 96000,
      channels: 2,
      fileSize: 1048576,
      playCount: 12,
      added: '2024-01-02 00:00:00',
      lastPlayed: '2024-02-03 00:00:00',
    }),
  ]);
  await page.setViewportSize({ width: 1600, height: 900 });
  const header = env.grid.getByRole('columnheader', { name: '标题', exact: true });
  for (const [label, id, value] of [
    ['采样率', 'sampleRate', '96,000 Hz'],
    ['播放次数', 'playCount', '12'],
    ['文件大小', 'fileSize', '1.0 MiB'],
  ] as const) {
    await header.click({ button: 'right' });
    await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(
      env.row('Example').locator(`[role="gridcell"][data-column-id="${id}"]`),
    ).toHaveText(value);
  }
  await env.view.getByRole('searchbox', { name: '在此播放列表中搜索' }).fill('Example');
  await expect(env.row('Example').locator('[data-column-id="playCount"]')).toHaveText('12');
  expect(env.errors).toEqual([]);
});

test('列表排序可指定降序，标记跟随宿主成功结果且撤销可恢复', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix', [
    makeRow('Mix', 0, { title: 'A', duration: 600 }),
    makeRow('Mix', 1, { title: 'B', duration: 120 }),
    makeRow('Mix', 2, { title: 'C', duration: 3600 }),
  ]);
  const order = () =>
    env.grid.locator('[role="gridcell"][data-column-id="title"]').allTextContents();
  await expect.poll(order).toEqual(['A', 'B', 'C']);
  await env.view.locator('[data-playlist-more]').click();
  await page.locator('[data-playlist-sort]').click();
  await page.locator('[data-sort-choice="duration"]').click();
  await page.getByRole('menuitem', { name: '降序', exact: true }).click();
  await expect.poll(order).toEqual(['C', 'A', 'B']);
  await expect(env.grid.getByRole('columnheader', { name: '时长', exact: true })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await env.grid
    .getByRole('columnheader', { name: '时长', exact: true })
    .getByRole('button', { name: '时长', exact: true })
    .press('Enter');
  await expect.poll(order).toEqual(['B', 'A', 'C']);
  await env.row('B').click();
  await page.keyboard.press('Control+z');
  await expect.poll(order).toEqual(['C', 'A', 'B']);
  expect(env.errors).toEqual([]);
});

test('锁定播放列表的列表排序不允许重排', async ({ page }) => {
  const env = await openPlaylist(page, 'Smart');
  await env.view.locator('[data-playlist-more]').click();
  await page.locator('[data-playlist-sort]').click();
  await expect(page.locator('[data-sort-choice="duration"]')).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: '反向', exact: true })).toBeDisabled();
  expect(env.host.callsTo('playlist.sort')).toHaveLength(0);
  expect(env.errors).toEqual([]);
});
