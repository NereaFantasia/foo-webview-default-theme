import { expect, test, type Page } from '@playwright/test';
import { PLAYER_BAR_STORAGE_KEY } from '../../src/theme/playerBarStyle.ts';
import { amplitudeOf, dbOf, positionOf } from '../../src/playback/volumeScale.ts';
import { boxOf, openPlayer, PLAYING_TRACK, switchPreference } from '../fixtures/playerPage.ts';

// 播放栏的两项偏好在运行中改（设置页调的就是这两个写入口）：播放栏形态换了即时换版式、标题栏高度与
// 最大化键的矩形重报给宿主，刷新后还在；音量刻度换了音量条按新刻度重算、往宿主发的音量按新刻度换算。

const VOLUME_SCALE_KEY = 'default-theme.volume-scale.v1';

const stored = (page: Page, key: string) =>
  page.evaluate((name) => localStorage.getItem(name), key);

test('宽窗里底部通栏换成标题栏再换回来：版式即时换，高度与最大化键的矩形都重报，刷新后还在', async ({
  page,
}) => {
  const { host, errors } = await openPlayer(page, { harness: true });
  const heights = () => host.callsTo('window.setTitlebarHeight');
  const lastRegion = () => host.callsTo('window.setMaximizeButtonRegion').at(-1);
  await expect.poll(heights).toEqual([{ height: 48 }]);
  await expect(page.locator('[data-player-bar]')).toBeVisible();

  await switchPreference(page, 'player-bar', 'titlebar');
  await expect(page.locator('[data-player-bar]')).toHaveCount(0);
  await expect(page.locator('header [data-now-playing]')).toContainText(PLAYING_TRACK.title);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 56 });
  await expect.poll(heights).toEqual([{ height: 48 }, { height: 56 }]);
  await expect.poll(lastRegion).toEqual({ region: { x: 1280 - 92, y: 0, width: 46, height: 56 } });
  expect(await stored(page, PLAYER_BAR_STORAGE_KEY)).toBe('titlebar');

  await page.reload();
  await expect(page.locator('header [data-now-playing]')).toContainText(PLAYING_TRACK.title);
  await expect(page.locator('[data-player-bar]')).toHaveCount(0);

  await switchPreference(page, 'player-bar', 'bottom');
  await expect(page.locator('[data-player-bar]')).toContainText(PLAYING_TRACK.title);
  await expect(page.locator('[data-now-playing]')).toHaveCount(0);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
  await expect.poll(lastRegion).toEqual({ region: { x: 1280 - 92, y: 0, width: 46, height: 48 } });
  expect(await stored(page, PLAYER_BAR_STORAGE_KEY)).toBe('bottom');
  expect(errors).toEqual([]);
});

test('窄窗里换成标题栏形态：通栏换成卡片底部的胶囊，卡片给出 --player-inset；换回来胶囊收掉', async ({
  page,
}) => {
  const { errors } = await openPlayer(page, { width: 900, harness: true });
  // 内容卡是 main 的最后一个子元素（宽窗时前面还有分栏握柄）。
  const inset = () =>
    page.locator('main').evaluate((main) =>
      getComputedStyle(main.lastElementChild ?? main)
        .getPropertyValue('--player-inset')
        .trim(),
    );
  await expect(page.locator('[data-player-bar]')).toBeVisible();
  expect(await inset()).toBe('0px');

  await switchPreference(page, 'player-bar', 'titlebar');
  await expect(page.locator('[data-player-capsule]')).toContainText(PLAYING_TRACK.title);
  await expect(page.locator('[data-player-bar]')).toHaveCount(0);
  expect(await inset()).not.toBe('0px');

  await switchPreference(page, 'player-bar', 'bottom');
  await expect(page.locator('[data-player-capsule]')).toHaveCount(0);
  await expect(page.locator('[data-player-bar]')).toBeVisible();
  expect(await inset()).toBe('0px');
  expect(errors).toEqual([]);
});

test('换成胶囊形态：宽窗里也是卡片底部的胶囊，导航键留在标题栏、没有导航行，标题栏高度不变', async ({
  page,
}) => {
  const { host, errors } = await openPlayer(page, { harness: true });
  await expect(page.locator('header [data-nav="back"]')).toBeVisible();
  await expect(page.locator('[data-nav-row]')).toHaveCount(0);

  await switchPreference(page, 'player-bar', 'capsule');
  await expect(page.locator('[data-player-capsule]')).toContainText(PLAYING_TRACK.title);
  await expect(page.locator('[data-player-bar]')).toHaveCount(0);
  await expect(page.locator('header [data-nav="back"]')).toBeVisible();
  await expect(page.locator('[data-nav-row]')).toHaveCount(0);
  expect(await boxOf(page, '[data-player-capsule]')).toMatchObject({ width: 680, height: 64 });
  expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
  expect(host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 48 }]);
  expect(errors).toEqual([]);
});

test('音量刻度换档：音量条按新刻度重算，按键往宿主发的音量按新刻度换算，刷新后还在', async ({
  page,
}) => {
  const { calls, errors } = await openPlayer(page, { harness: true });
  const volume = page.locator('[data-player-bar]').getByRole('slider', { name: '音量' });
  const perceptual = String(Math.round(positionOf(-20, 'perceptual')));
  await expect(volume).toHaveAttribute('aria-valuenow', perceptual);

  await switchPreference(page, 'volume-scale', 'db');
  await expect(volume).toHaveAttribute('aria-valuenow', '80');
  expect(await stored(page, VOLUME_SCALE_KEY)).toBe('db');
  // 换刻度只改条上的位置，不动 fb2k 的音量。
  expect(calls('playback.setVolume')).toEqual([]);

  await volume.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => calls('playback.setVolume').length).toBe(1);
  expect(Number(calls('playback.setVolume')[0]?.['volume'])).toBeCloseTo(
    amplitudeOf(dbOf(81, 'db')),
    3,
  );

  await page.reload();
  await expect(volume).toHaveAttribute('aria-valuenow', '80');
  await switchPreference(page, 'volume-scale', 'perceptual');
  await expect(volume).toHaveAttribute('aria-valuenow', perceptual);
  expect(errors).toEqual([]);
});
