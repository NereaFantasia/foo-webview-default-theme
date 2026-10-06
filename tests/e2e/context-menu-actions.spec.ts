import { expect, test } from '@playwright/test';
import type { MenuCommand } from 'foo-webview-sdk';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';

const command = (label: string, commandId: number): MenuCommand => ({
  type: 'command',
  label,
  displayLabel: label,
  path: label,
  displayPath: label,
  commandId,
  available: true,
  enabled: true,
  executable: false,
});
const PROPERTIES = command('Properties', 7);
const EXTRA = command('转换格式', 8);
const treeAnswer = () => ({
  success: true as const,
  mode: 'selection' as const,
  locale: 'zh-CN',
  i18n: true,
  withAvailability: true,
  items: [PROPERTIES, EXTRA],
});

test('枚举区仅禁用已有专门入口的功能，没有 GUID 的其他命令仍按编号执行', async ({ page }) => {
  const { host, row } = await openPlaylist(page, 'Mix');
  host.answer('menu.getContextMenu', treeAnswer());
  await row('Mix 2').click({ button: 'right' });
  const menu = page.locator('[data-playlist-track-menu]');
  await menu.locator('[data-action="more-commands"]').click();
  const delegated = page.getByRole('menuitem', { name: 'Properties', exact: true });
  await expect(delegated).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('menuitem', { name: '转换格式', exact: true }).click();
  await expect
    .poll(() => host.callsTo('menu.runContextCommandById'))
    .toEqual([{ id: 8, mode: 'selection' }]);
  await expect(menu).toHaveCount(0);
});

test('播放所选只复制选区并保留重复分轨，从此处播放使用右键落点', async ({ page }) => {
  const path = 'file://E:/Music/Disc.cue';
  const tracks = [0, 1, 2, 3].map((row) =>
    makeRow('Mix', row, row % 2 ? { path, subsong: 2 } : {}),
  );
  const { host, lists, row, guid } = await openPlaylist(page, 'Mix', tracks);
  await row('Mix 2').click();
  await row('Mix 4').click({ modifiers: ['Control'] });
  await row('Mix 4').click({ button: 'right' });
  const menu = page.locator('[data-playlist-track-menu]');
  await menu.locator('[data-action="play-from-here"]').click();
  await expect
    .poll(() => host.callsTo('playlist.playTrack').at(-1))
    .toMatchObject({ playlistGuid: guid, index: 3 });
  await row('Mix 4').click({ button: 'right' });
  await menu.locator('[data-action="play"]').click();
  await expect
    .poll(() => host.callsTo('library.addToPlaylist'))
    .toMatchObject([{ paths: [`${path}|subsong:2`, `${path}|subsong:2`] }]);
  await expect.poll(() => host.callsTo('playlist.playTrack').at(-1)).toMatchObject({ index: 0 });
  await expect.poll(() => lists.content.selection(guid)).toEqual([1, 3]);
});

test('扩展失败可原位重试；选区变化关闭绑定旧对象的菜单', async ({ page }) => {
  const { host, row, guid } = await openPlaylist(page, 'Mix');
  host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
  await row('Mix 2').click({ button: 'right' });
  const menu = page.locator('[data-playlist-track-menu]');
  await menu.locator('[data-action="more-commands"]').click();
  await expect(page.getByRole('status').filter({ hasText: '扩展命令读取失败' })).toBeVisible();
  host.answer('menu.getContextMenu', treeAnswer());
  await page.locator('[data-action="host-retry"]').click();
  await expect(page.getByRole('menuitem', { name: '转换格式', exact: true })).toBeVisible();
  await expect(menu).toHaveCount(1);
  await host.invoke('playlist.deselectAll', { playlistGuid: guid });
  await expect(menu).toHaveCount(0);
});
