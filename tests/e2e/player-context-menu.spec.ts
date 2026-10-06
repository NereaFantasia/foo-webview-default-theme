import { expect, test } from '@playwright/test';
import type { MenuCommand } from 'foo-webview-sdk';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import {
  choosePlayerBar,
  openPlayer,
  PLAYING_TRACK,
  switchPreference,
} from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

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
const TREE = {
  success: true as const,
  mode: 'handles' as const,
  locale: 'zh-CN',
  i18n: true,
  withAvailability: true,
  items: [command('Properties', 7), command('转换格式', 8)],
};

for (const [style, width, surface] of [
  ['bottom', 1280, '[data-player-bar]'],
  ['titlebar', 1280, '[data-now-playing]'],
  ['capsule', 390, '[data-player-capsule]'],
] as const) {
  test(`${style} 右键和键盘菜单绑定当前分轨；Escape 还焦点，停止时随播放栏收掉`, async ({
    page,
  }) => {
    await choosePlayerBar(page, style);
    const track = makeTrack({ ...PLAYING_TRACK, path: 'file://E:/Disc.cue', subsong: 2 });
    const { host, state } = await openPlayer(page, { width, state: { track } });
    host.answer('menu.getContextMenu', TREE);
    host.answer('playback.getStopAfterCurrent', { success: true, enabled: true });
    const root = page.locator(surface);
    const cover = root.locator('[data-player-key="cover"]');
    await cover.click({ button: 'right' });
    const menu = page.locator('[data-now-playing-menu]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="stop-after"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect
      .poll(() => host.callsTo('menu.getContextMenu').at(-1))
      .toMatchObject({
        mode: 'handles',
        handles: [`${track.path}|subsong:2`],
      });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(cover).toBeFocused();
    await cover.press('Shift+F10');
    await expect(menu).toBeVisible();
    await menu.locator('[data-action="properties"]').click();
    await expect
      .poll(() => host.callsTo('menu.runContextCommandById'))
      .toEqual([{ id: 7, mode: 'handles', handles: [`${track.path}|subsong:2`] }]);
    await expect(menu).toHaveCount(0);
    await cover.click({ button: 'right' });
    await expect(menu).toBeVisible();
    state.track = null;
    state.state = 'stopped';
    await host.emit('playback:stopped', { reason: 'user' });
    await expect(root).toHaveCount(0);
    await expect(menu).toHaveCount(0);
  });
}

test('更多按钮执行停止选项，枚举只禁用接管的项；换曲关闭并丢弃迟到树', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const { host } = await openPlayer(page);
  host.answer('menu.getContextMenu', TREE);
  host.answer('playback.getStopAfterCurrent', { success: true, enabled: false });
  host.answer('playback.setStopAfterCurrent', { success: true, enabled: true });
  const more = page.locator('[data-now-playing] [data-player-key="more"]');
  const menu = page.locator('[data-now-playing-menu]');
  await more.click();
  await menu.locator('[data-action="stop-after"]').click();
  await expect
    .poll(() => host.callsTo('playback.setStopAfterCurrent'))
    .toEqual([{ enabled: true }]);
  await more.click();
  await menu.locator('[data-action="more-commands"]').click();
  await expect(page.getByRole('menuitem', { name: 'Properties', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('menuitem', { name: '转换格式', exact: true }).click();
  await expect
    .poll(() => host.callsTo('menu.runContextCommandById').at(-1))
    .toMatchObject({ id: 8 });
  const held = host.hold('menu.getContextMenu');
  await more.click();
  await expect(menu).toBeVisible();
  await host.emit(
    'playback:trackChanged',
    makeTrack({ path: 'file://E:/Next.flac', title: 'Next' }),
  );
  await expect(menu).toHaveCount(0);
  held.release();
  await expect(menu).toHaveCount(0);
});

test('扩展失败可重试，评分写完重开保持新值；播放栏换形态不留下菜单', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const { host } = await openPlayer(page, { harness: true });
  host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
  host.answer('rating.set', (params) => ({
    success: true,
    path: String(params['path']),
    rating: Number(params['rating']),
    storage: 'file',
  }));
  const more = page.locator('[data-player-capsule] [data-player-key="more"]');
  const menu = page.locator('[data-now-playing-menu]');
  await more.click();
  await menu.locator('[data-action="more-commands"]').click();
  await expect(page.getByRole('status').filter({ hasText: '扩展命令读取失败' })).toBeVisible();
  host.answer('menu.getContextMenu', TREE);
  await page.locator('[data-action="host-retry"]').click();
  await expect(page.getByRole('menuitem', { name: '转换格式', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await more.click();
  await menu.locator('[data-action="rating"]').click();
  await page.getByRole('menuitemradio', { name: '4 星', exact: true }).click();
  await expect.poll(() => host.callsTo('rating.set').length).toBe(1);
  await more.click();
  await menu.locator('[data-action="rating"]').click();
  await expect(page.getByRole('menuitemradio', { name: '4 星', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await switchPreference(page, 'player-bar', 'bottom');
  await expect(menu).toHaveCount(0);
});

test('网络流禁用评分及从头播放，音量和进度条右键不打开曲目菜单', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const { host } = await openPlayer(page, {
    state: {
      canSeek: false,
      track: makeTrack({ path: 'https://radio.example/live', duration: 0 }),
    },
  });
  host.answer('menu.getContextMenu', TREE);
  const root = page.locator('[data-now-playing]');
  const menu = page.locator('[data-now-playing-menu]');
  await root.locator('[data-player-key="more"]').click();
  await expect(menu.locator('[data-action="rating"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(menu.locator('[data-action="play"]')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await root.locator('[data-form="lcd"]').click({ button: 'right', force: true });
  await expect(menu).toHaveCount(0);
  await page.locator('[data-player-key="volume"]').click({ button: 'right' });
  await expect(menu).toHaveCount(0);
});
