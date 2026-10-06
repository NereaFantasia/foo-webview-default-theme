import { guidOf } from '../fixtures/fakePlaylists.ts';
import { expect, test } from '@playwright/test';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { albumTracks, openPlaylist } from '../fixtures/playlistPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';

// 播放列表页：从侧边栏进一张列表，页头、曲目表与选中同步，页头不随行滚走。

test('点侧边栏的列表进它的页：页头写列表名、首数与总时长，表格画出行，双击起播', async ({
  page,
}) => {
  const { host, lists, entry, errors } = await openSidebar(page);
  await entry('Road Trip').click();
  const view = page.locator('[data-page="playlist"]');
  await expect(view.getByRole('heading', { level: 1, name: 'Road Trip' })).toBeVisible();
  // 副题：首数，再接宿主报的总时长。
  await expect(view.locator('[data-playlist-subtitle]')).toHaveText(/^48 首 · \d+:\d{2}(:\d{2})?$/);
  const grid = view.getByRole('treegrid', { name: '曲目' });
  await expect(grid).toBeVisible();
  // 缺省按专辑分组：组头在第 1 层，曲目行在第 2 层。
  await expect(grid.locator('[role="row"][aria-level="1"]').first()).toBeVisible();
  const first = grid.locator('[role="row"][aria-level="2"]').first();
  await expect(first).toBeVisible();
  await first.dblclick();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBeGreaterThan(0);
  expect(lists.guid('Road Trip')).toBeTruthy();
  expect(errors).toEqual([]);
});

test('曲目菜单与 Delete：移除选中的曲目；锁着的列表 Delete 不发', async ({ page }) => {
  const { host, entry, errors } = await openSidebar(page);
  await entry('Road Trip').click();
  const grid = page.locator('[data-page="playlist"]').getByRole('treegrid', { name: '曲目' });
  const row = grid.locator('[role="row"][aria-level="2"]').nth(2);
  await row.click({ button: 'right' });
  const menu = page.locator('[data-playlist-track-menu]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-action="remove"]').click();
  await expect.poll(() => host.callsTo('playlist.removeSelectedTracks').length).toBe(1);

  await grid.locator('[role="row"][aria-level="2"]').first().click();
  await page.keyboard.press('Delete');
  await expect.poll(() => host.callsTo('playlist.removeSelectedTracks').length).toBe(2);

  await entry('Smart').click();
  const smart = page.locator('[data-page="playlist"]');
  await expect(smart.getByRole('heading', { level: 1, name: 'Smart' })).toBeVisible();
  await smart.locator('[role="row"][aria-level="2"]').first().click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  expect(host.callsTo('playlist.removeSelectedTracks')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('页内过滤：键入后只列命中的行，副题接命中数；列头菜单里有排序与分组两段', async ({ page }) => {
  const { host, entry, errors } = await openSidebar(page);
  await entry('Road Trip').click();
  const view = page.locator('[data-page="playlist"]');
  await view.getByRole('textbox', { name: '筛选此播放列表' }).fill('zzz-no-such-track');
  await expect(view.locator('[data-playlist-empty="noMatch"]')).toBeVisible();
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 0 首');
  await page.keyboard.press('Escape');
  await expect(view.locator('[data-playlist-empty]')).toHaveCount(0);

  await view.getByRole('columnheader', { name: '标题' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '排序' })).toBeVisible();
  await page.getByRole('menuitem', { name: '排序' }).click();
  await page.getByRole('menuitem', { name: '艺人', exact: true }).click();
  await expect.poll(() => host.callsTo('playlist.sort').length).toBe(1);
  expect(errors).toEqual([]);
});

test('滚到表尾：页头、过滤框与列头还在原处，过滤框照常能用', async ({ page }) => {
  const { view, grid, row, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 30, 10));
  const filter = view.getByRole('textbox', { name: '筛选此播放列表' });
  // 点得着行时换页的动效已经走完，这时量的才是页头的落脚处。
  await row('Mix 2').click();
  const top = await filter.boundingBox();
  await page.keyboard.press('End');
  await expect(row('Mix 300')).toBeInViewport();
  await expect(view.getByRole('heading', { level: 1, name: 'Mix', exact: true })).toBeInViewport();
  await expect(grid.getByRole('columnheader', { name: '标题' })).toBeInViewport();
  expect((await filter.boundingBox())?.y).toBe(top?.y);
  await filter.fill('Mix 299');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 1 首');
  expect(errors).toEqual([]);
});

test('单击列头排序后记号在；撤销、别处增删行之后记号收起，再点从升序起', async ({ page }) => {
  const { host, lists, guid, view, errors } = await openPlaylist(page, 'Mix');
  const title = view.getByRole('columnheader', { name: '标题' });
  await title.click();
  await expect(title).toHaveAttribute('aria-sort', 'ascending');
  await title.click();
  await expect(title).toHaveAttribute('aria-sort', 'descending');
  await view.getByRole('treegrid', { name: '曲目' }).focus();
  await page.keyboard.press('Control+Z');
  await expect(title).not.toHaveAttribute('aria-sort', /ascending|descending/);

  const fetched = host.callsTo('playlist.getTracks').length;
  await title.click();
  await expect(title).toHaveAttribute('aria-sort', 'ascending');
  // 等排序带来的那次重排落地（行重取过）再从别处删行：两次变化挤在一个合并窗口里就只算一版。
  await expect.poll(() => host.callsTo('playlist.getTracks').length).toBeGreaterThan(fetched);
  lists.setTracks(
    guid,
    Array.from({ length: 11 }, (_, at) => makeRow('Mix', at + 1)),
  );
  await host.emit('playlist:itemsRemoved', {
    playlistGuid: guidOf(1),
    playlist: 1,
    oldCount: 12,
    newCount: 11,
  });
  await expect(title).not.toHaveAttribute('aria-sort', /ascending|descending/);
  expect(host.callsTo('playlist.sort').map((call) => call['descending'])).toEqual([
    false,
    true,
    false,
  ]);
  expect(errors).toEqual([]);
});
