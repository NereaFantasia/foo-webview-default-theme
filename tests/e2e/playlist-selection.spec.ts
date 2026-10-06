import { expect, test, type Page } from '@playwright/test';
import type { MenuCommand, MenuItem, MenuSubmenu } from 'foo-webview-sdk';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { installFakeQueue, queueTracks } from '../fixtures/fakeQueue.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';

// 播放列表页的选中与曲目菜单：本地选中推给宿主，菜单作用于宿主那份选中；入队、发送到与宿主命令树。

const menuOf = (page: Page) => page.locator('[data-playlist-track-menu]');

function command(label: string, commandId: number, radioChecked = false): MenuCommand {
  return {
    type: 'command',
    label,
    displayLabel: label,
    path: label,
    displayPath: label,
    available: true,
    enabled: true,
    commandId,
    radioChecked,
  };
}

/** 宿主的命令树：属性、评分五档（勾在 3 上）加「未设置」。 */
const RATING: MenuSubmenu = {
  type: 'submenu',
  label: 'Rating',
  displayLabel: 'Rating',
  path: 'Rating',
  displayPath: 'Rating',
  children: [
    ...[1, 2, 3, 4, 5].map((value) => command(String(value), 20 + value, value === 3)),
    command('<not set>', 20),
  ],
};
const TREE: MenuItem[] = [command('Properties', 7), RATING];

test('单击、Ctrl 单击、Shift 单击都推给宿主；Ctrl+A 走宿主的全选', async ({ page }) => {
  const { host, lists, guid, row, errors } = await openPlaylist(page, 'Mix');
  const selection = () => lists.content.selection(guid);
  await row('Mix 2').click();
  await expect.poll(selection).toEqual([1]);
  await row('Mix 4').click({ modifiers: ['Control'] });
  await expect.poll(selection).toEqual([1, 3]);
  await row('Mix 6').click({ modifiers: ['Shift'] });
  await expect.poll(selection).toEqual([3, 4, 5]);

  await page.keyboard.press('Control+A');
  await expect.poll(() => host.callsTo('playlist.selectAll').length).toBe(1);
  await expect.poll(() => selection().length).toBe(12);
  expect(errors).toEqual([]);
});

test('右键落在选中里作用于整批，菜单头写首数；落在外面改成只选它', async ({ page }) => {
  const { lists, guid, row, errors } = await openPlaylist(page, 'Mix');
  await row('Mix 2').click();
  await row('Mix 3').click({ modifiers: ['Shift'] });
  await row('Mix 3').click({ button: 'right' });
  await expect(menuOf(page)).toContainText('2 首');
  await page.keyboard.press('Escape');
  await expect(menuOf(page)).toHaveCount(0);

  await row('Mix 8').click({ button: 'right' });
  await expect(menuOf(page)).toContainText('Mix 8');
  await expect.poll(() => lists.content.selection(guid)).toEqual([7]);
  expect(errors).toEqual([]);
});

test('入队与发送到：加入队列按路径接到队尾，下一首播放挪到队首；发送到列出各列表、锁着的置灰', async ({
  page,
}) => {
  const { host, lists, row, errors } = await openPlaylist(page, 'Mix');
  const tracks = [makeRow('Mix', 1), makeRow('Mix', 2)];
  const queue = installFakeQueue(host, queueTracks('已入队'), tracks);
  await row('Mix 2').click();
  await row('Mix 3').click({ modifiers: ['Shift'] });
  await row('Mix 3').click({ button: 'right' });
  await menuOf(page).locator('[data-action="enqueue"]').click();
  await expect.poll(() => queue.titles()).toEqual(['已入队', 'Mix 2', 'Mix 3']);
  expect(queue.items.every((item) => item.playlist === null && item.playlistItem === null)).toBe(
    true,
  );
  expect(host.callsTo('queue.insertNext')[0]).toMatchObject({
    paths: tracks.map((track) => track.handle),
    position: 1,
  });

  await row('Mix 3').click({ button: 'right' });
  await menuOf(page).locator('[data-action="play-next"]').click();
  await expect.poll(() => queue.titles()).toEqual(['Mix 2', 'Mix 3', '已入队']);
  expect(host.callsTo('queue.insertNext')).toHaveLength(2);

  await row('Mix 3').click({ button: 'right' });
  await menuOf(page).locator('[data-action="send-to"]').click();
  await expect(page.getByRole('menuitem', { name: 'Smart' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('menuitem', { name: 'Default' }).click();
  await expect
    .poll(() => host.callsTo('playlist.insertTracks'))
    .toMatchObject([{ playlistGuid: lists.guid('Default') }]);
  expect(errors).toEqual([]);
});

test('宿主的几项：开菜单时按宿主选中重读命令树，评分一档与属性按编号执行', async ({ page }) => {
  const { host, row, errors } = await openPlaylist(page, 'Mix');
  host.answer('menu.getContextMenu', {
    success: true,
    mode: 'selection',
    locale: 'zh-CN',
    i18n: true,
    withAvailability: true,
    items: TREE,
  });
  await row('Mix 5').click({ button: 'right' });
  await expect
    .poll(() => host.callsTo('menu.getContextMenu'))
    .toMatchObject([{ mode: 'selection' }]);
  await menuOf(page).locator('[data-action="rating"]').click();
  await expect(page.getByRole('menuitemradio', { name: '3 星' })).toBeChecked();
  await page.getByRole('menuitemradio', { name: '5 星' }).click();
  await expect
    .poll(() => host.callsTo('menu.runContextCommandById'))
    .toMatchObject([{ id: 25, mode: 'selection' }]);

  await row('Mix 5').click({ button: 'right' });
  await menuOf(page).locator('[data-action="properties"]').click();
  await expect
    .poll(() => host.callsTo('menu.runContextCommandById'))
    .toMatchObject([{ id: 25 }, { id: 7, mode: 'selection' }]);
  expect(errors).toEqual([]);
});
