import { expect, test, type Page } from '@playwright/test';
import { hostFailure, isRecord } from '../fixtures/hostAnswers.ts';
import {
  enterSettings,
  openSettings,
  waitFrames,
  type SettingsPage,
} from '../fixtures/settingsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 「外观」一组：深浅模式手选、强调色、窗口材质与播放栏位置。只断言状态与下发的参数，观感实机看。

/** 宿主正放着一首：没有当前曲目时底部通栏不出。 */
const PLAYING = {
  getState: { success: true, state: 'playing', canSeek: true, canPause: true },
  getCurrentTrack: { success: true, found: true, track: makeTrack() },
} as const;

const themeRoot = (page: Page) => page.locator('#root > .fui-FluentProvider');

const stored = (page: Page, key: string) =>
  page.evaluate((name) => localStorage.getItem(name), key);

/** 最近一次下发的材质与深浅；线上的参数把它们包在 `backdropPolicy` 里。 */
function lastPolicy(settings: SettingsPage): Readonly<Record<string, unknown>> {
  const policy = settings.host.callsTo('window.setBackdropPolicy').at(-1)?.['backdropPolicy'];
  return isRecord(policy) ? policy : {};
}

test.describe('系统是浅色', () => {
  test.use({ colorScheme: 'light' });

  test('深浅模式：跟随系统时写出此刻是哪一档；手选后立即生效、下发给宿主，刷新后还在', async ({
    page,
  }) => {
    const settings = await openSettings(page);
    await expect(settings.select('颜色模式')).toHaveText('跟随系统');
    await expect(settings.card('颜色模式')).toContainText('当前：浅色');
    await expect(themeRoot(page)).toHaveCSS('color-scheme', 'light');

    await settings.choose('颜色模式', '深色');
    await expect(themeRoot(page)).toHaveCSS('color-scheme', 'dark');
    await expect(settings.card('颜色模式')).not.toContainText('当前：');
    await expect.poll(() => lastPolicy(settings)['darkMode']).toBe(true);

    // 系统的深浅变了，手选的这一档不跟着变。matchMedia 的 change 在渲染更新那一步才派发：每换一次等两帧，
    // 不然两次换在同一帧里互相抵掉、一个事件也没有，断言跟不跟都能过。
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitFrames(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await waitFrames(page);
    await expect(themeRoot(page)).toHaveCSS('color-scheme', 'dark');

    await page.reload();
    await expect(themeRoot(page)).toHaveCSS('color-scheme', 'dark');
    await enterSettings(page);
    await expect(settings.select('颜色模式')).toHaveText('深色');

    await settings.choose('颜色模式', '跟随系统');
    await expect(themeRoot(page)).toHaveCSS('color-scheme', 'light');
    await expect(settings.card('颜色模式')).toContainText('当前：浅色');
    expect(settings.errors).toEqual([]);
  });
});

test('窗口材质：换档即下发；跟随首选项时写出宿主报的实际效果，报来的状态不触发下发', async ({
  page,
}) => {
  const settings = await openSettings(page);
  await expect(settings.select('窗口背景')).toHaveText('跟随 foobar2000 首选项');
  await expect(settings.card('窗口背景')).not.toContainText('当前：');

  await settings.host.waitForListener('window:backdropStateChanged');
  const before = settings.host.callsTo('window.setBackdropPolicy').length;
  await settings.host.emit('window:backdropStateChanged', {
    windowId: 'main',
    active: true,
    mode: 'active',
    effect: 'mica',
  });
  await expect(settings.card('窗口背景')).toContainText('当前：Mica');
  expect(settings.host.callsTo('window.setBackdropPolicy')).toHaveLength(before);

  await settings.choose('窗口背景', 'Acrylic');
  await expect(settings.select('窗口背景')).toHaveText('Acrylic');
  await expect.poll(() => lastPolicy(settings)['activeEffect']).toBe('acrylic');
  await expect(settings.card('窗口背景')).not.toContainText('当前：');
  expect(settings.host.callsTo('window.setBackdropPolicy')).toHaveLength(before + 1);

  await page.reload();
  await enterSettings(page);
  await expect(settings.select('窗口背景')).toHaveText('Acrylic');
  expect(settings.errors).toEqual([]);
});

test('播放栏位置：换到标题栏，底部通栏即时收掉并记住，刷新后还在；换回窗口底部', async ({
  page,
}) => {
  const key = 'default-theme.player-bar.v1';
  const settings = await openSettings(page, { answers: { playback: PLAYING } });
  const bar = page.locator('[data-player-bar]');
  await expect(settings.select('播放栏位置')).toHaveText('窗口底部');
  await expect(bar).toBeVisible();

  await settings.choose('播放栏位置', '标题栏');
  await expect(bar).toHaveCount(0);
  expect(await stored(page, key)).toBe('titlebar');

  await page.reload();
  await enterSettings(page);
  await expect(settings.select('播放栏位置')).toHaveText('标题栏');
  await expect(bar).toHaveCount(0);

  await settings.choose('播放栏位置', '窗口底部');
  await expect(bar).toBeVisible();
  expect(await stored(page, key)).toBe('bottom');
  expect(settings.errors).toEqual([]);
});

test('强调色：进页面时收起，卡头写来源；Windows 强调色读不到时卡头与那一行写同一条错误', async ({
  page,
}) => {
  const failure = 'Windows 强调色读取失败，使用上次颜色或默认青绿';
  const settings = await openSettings(page);
  const accent = settings.expander('强调色');
  const head = accent.locator(':scope > :first-child');
  await expect(accent.locator('[data-settings-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await expect(settings.row('基础强调色')).toHaveCount(0);
  await expect(head).toContainText('当前：默认青绿');

  settings.host.answer('system.getTheme', hostFailure('OPERATION_FAILED'));
  await settings.expand('强调色');
  await settings.choose('基础强调色', 'Windows 强调色');
  await expect(settings.row('基础强调色')).toContainText(failure);
  await expect(head).toContainText(failure);

  await accent.locator('[data-settings-toggle]').click();
  await expect(settings.row('基础强调色')).toHaveCount(0);
  await expect(head).toContainText(failure);
  expect(settings.errors).toEqual([]);
});
