import { expect, test, type Locator, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';

// 进沉浸视图的入口：三种播放栏的封面，底部通栏宽窗最右的沉浸键。没连上宿主时置灰，停止时照样能进。
// F11 切换宿主主窗全屏；在沉浸视图里经视图自己的全屏记账，Esc 离开时一并退出。

const view = (page: Page) => page.getByRole('region', { name: '正在播放' });
const playerKey = (page: Page, scope: string, name: string): Locator =>
  page.locator(`${scope} [data-player-key="${name}"]`);

/** 按下入口进视图、按 Esc 回来，焦点回到入口上。 */
async function enterAndLeave(page: Page, entry: Locator): Promise<void> {
  await entry.click();
  await expect(view(page)).toBeVisible();
  await expect(view(page).locator('[data-field="title"]')).toHaveText(PLAYING_TRACK.title);
  await page.keyboard.press('Escape');
  await expect(view(page)).toHaveCount(0);
  await expect(entry).toBeFocused();
}

test('底部通栏：封面与最右的沉浸键都进沉浸视图，名字都是「沉浸视图」', async ({ page }) => {
  const { errors } = await openPlayer(page);
  const cover = playerKey(page, '[data-player-bar]', 'cover');
  const key = playerKey(page, '[data-player-bar]', 'immersive');
  await expect(cover).toHaveAccessibleName('沉浸视图');
  await expect(key).toHaveAccessibleName('沉浸视图');
  await enterAndLeave(page, cover);
  await enterAndLeave(page, key);
  expect(errors).toEqual([]);
});

test('底部通栏窄窗收掉沉浸键，封面照样进', async ({ page }) => {
  const { errors } = await openPlayer(page, { width: 900 });
  await expect(playerKey(page, '[data-player-bar]', 'immersive')).toHaveCount(0);
  await enterAndLeave(page, playerKey(page, '[data-player-bar]', 'cover'));
  expect(errors).toEqual([]);
});

test('标题栏的正在播放条：点封面进', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const { errors } = await openPlayer(page);
  await enterAndLeave(page, playerKey(page, '[data-now-playing]', 'cover'));
  expect(errors).toEqual([]);
});

test('胶囊：点封面进', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const { errors } = await openPlayer(page);
  await enterAndLeave(page, playerKey(page, '[data-player-capsule]', 'cover'));
  expect(errors).toEqual([]);
});

test('视图开着时停止：视图留着，图纸上的字段写「—」', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page);
  await playerKey(page, '[data-player-bar]', 'cover').click();
  await expect(view(page)).toBeVisible();
  state.state = 'stopped';
  state.track = null;
  await host.emit('playback:stopped', { reason: 'user' });
  await expect(view(page).locator('[data-field="title"]')).toHaveText('—');
  await expect(view(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('没连上宿主时封面与沉浸键置灰，点了不进', async ({ page }) => {
  await page.goto('/');
  const cover = playerKey(page, '[data-player-bar]', 'cover');
  await expect(cover).toBeDisabled();
  await expect(playerKey(page, '[data-player-bar]', 'immersive')).toBeDisabled();
  await cover.click({ force: true });
  await expect(view(page)).toHaveCount(0);
});

test('F11 在视图外让宿主切换全屏；在视图里经视图的记账进全屏，Esc 离开时一并退出', async ({
  page,
}) => {
  const { host, calls, errors } = await openPlayer(page);
  host.answer('window.toggleFullscreen', { success: true, fullscreen: true });
  host.answer('window.isFullscreen', {
    success: true,
    fullscreen: false,
    isFullscreen: false,
    windowId: 'main',
  });
  host.answer('window.enterFullscreen', { success: true, isFullscreen: true });
  host.answer('window.exitFullscreen', { success: true, isFullscreen: false });

  await page.keyboard.press('F11');
  await expect.poll(() => calls('window.toggleFullscreen').length).toBe(1);

  await playerKey(page, '[data-player-bar]', 'cover').click();
  // 视图问到宿主的全屏态之后才出全屏键，F11 这时才有记账可走。
  await expect(view(page).locator('[data-fullscreen="off"]')).toBeVisible();
  await page.keyboard.press('F11');
  await expect.poll(() => calls('window.enterFullscreen').length).toBe(1);
  expect(calls('window.toggleFullscreen')).toHaveLength(1);

  await page.keyboard.press('Escape');
  await expect(view(page)).toHaveCount(0);
  await expect.poll(() => calls('window.exitFullscreen').length).toBe(1);
  expect(errors).toEqual([]);
});
