import { expect, test, type Page } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { choosePlayerBar, openPlayer } from '../fixtures/playerPage.ts';

// 播放的读取与命令失败在窗口右下角出轻提示：命令失败只能关，读取失败带「重试」。

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

const key = (page: Page, name: string) => page.locator(`header [data-player-key="${name}"]`);
const toast = (page: Page) => page.locator('[data-app-toast="playback"]');

test('命令失败出提示，关掉就收；再失败一次再出一条', async ({ page }) => {
  const { host, calls, errors } = await openPlayer(page);
  host.answer('playback.next', hostFailure('NO_ACTIVE_ITEM'));
  await key(page, 'next').click();
  await expect(toast(page)).toContainText('播放操作失败');
  await toast(page).getByRole('button', { name: '关闭' }).click();
  await expect(toast(page)).toHaveCount(0);

  await key(page, 'next').click();
  await expect.poll(() => calls('playback.next').length).toBe(2);
  await expect(toast(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('读取失败出提示，点「重试」重新读一遍、提示收起', async ({ page }) => {
  const { host, state, calls, errors } = await openPlayer(page);
  host.answer('playback.getState', hostFailure('INTERNAL_ERROR'));
  await key(page, 'previous').click();
  await expect(toast(page)).toContainText('播放状态读取失败');

  host.answer('playback.getState', () => ({
    success: true,
    state: state.state,
    canSeek: state.canSeek,
    canPause: true,
  }));
  const reads = calls('playback.getState').length;
  await toast(page).getByRole('button', { name: '重试' }).click();
  await expect(toast(page)).toHaveCount(0);
  await expect.poll(() => calls('playback.getState').length).toBe(reads + 1);
  // 重试只重新读，不重放上一首。
  expect(calls('playback.previous')).toHaveLength(1);
  expect(errors).toEqual([]);
});
