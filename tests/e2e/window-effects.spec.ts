import { expect, test } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { enterSettings, openSettings } from '../fixtures/settingsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

for (const scheme of ['light', 'dark'] as const) {
  for (const choice of ['mica', 'mica-alt', 'acrylic', 'inherit']) {
    test(`Win10 回退及信息中心：${scheme} / ${choice}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((saved) => {
        localStorage.setItem('default-theme.backdrop.v1', saved);
        Object.defineProperty(navigator, 'userAgentData', {
          configurable: true,
          value: {
            platform: 'Windows',
            getHighEntropyValues: async () => ({ platformVersion: '10.0.0' }),
          },
        });
      }, choice);
      const settings = await openSettings(page);
      await expect(page.locator('[data-window-background="solid"]')).toBeVisible();
      await expect(settings.card('窗口背景')).toContainText('Windows 10 使用主题色背景');
      await expect(settings.select('窗口背景')).toHaveText('主题色背景');
      await settings.select('窗口背景').click();
      for (const name of ['Mica', 'Mica Alt', 'Acrylic', '跟随 foobar2000 首选项'])
        await expect(page.getByRole('option', { name, exact: true })).toBeDisabled();
      await expect(page.getByRole('option', { name: '主题色背景', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect
        .poll(() => settings.host.callsTo('window.setBackdropPolicy').at(-1)?.['backdropPolicy'])
        .toMatchObject({ activeEffect: 'none' });
      expect(await page.evaluate(() => localStorage.getItem('default-theme.backdrop.v1'))).toBe(
        choice,
      );
      await page.locator('[data-info-center-trigger]').click();
      const message = page.locator('[data-info-kind="windowEffectsLimited"]');
      await expect(message).toContainText('Mica、Mica Alt');
      await expect(message).toContainText('原生窗口保留直角');
      await expect(message).toHaveCount(1);
      await message.getByRole('button', { name: '不再提示' }).click();
      await expect(message).toHaveCount(0);
      await page.keyboard.press('Escape');
      await settings.choose('窗口背景', '正在播放的封面');
      await expect(page.locator('[data-window-background="cover"]')).toBeVisible();
      expect(settings.errors).toEqual([]);
    });
  }
}

test('检测失败与 Windows 10 分开提示，主窗口和托盘都使用纯色', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('default-theme.backdrop.v1', 'mica');
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
  });
  const settings = await openSettings(page);
  await expect(page.locator('[data-window-background="solid"]')).toBeVisible();
  await expect(settings.card('窗口背景')).toContainText('无法确认系统材质支持情况');
  await page.locator('[data-info-center-trigger]').click();
  const message = page.locator('[data-info-kind="windowEffectsLimited"]');
  await expect(message).toContainText('无法确认系统是否支持窗口材质');
  await expect(message).not.toContainText('Windows 10');
  await expect
    .poll(() => settings.host.callsTo('tray.setMenuZones').at(-1)?.['config'])
    .toMatchObject({ backdrop: 'none' });
  expect(settings.errors).toEqual([]);
});

test('材质应用失败后使用纯色，成功事件恢复材质并撤去提醒', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('default-theme.backdrop.v1', 'mica');
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({ platformVersion: '13.0.0' }),
      },
    });
  });
  const settings = await openSettings(page, {
    answers: { window: { setBackdropPolicy: hostFailure('OPERATION_FAILED') } },
  });
  await expect(page.locator('[data-window-background="solid"]')).toBeVisible();
  await expect(settings.card('窗口背景')).toContainText('窗口材质未能应用');
  await page.locator('[data-info-center-trigger]').click();
  await expect(page.locator('[data-info-kind="windowEffectsLimited"]')).toContainText(
    '窗口材质未能应用',
  );
  await settings.host.emit('window:backdropStateChanged', {
    windowId: 'main',
    active: true,
    mode: 'active',
    effect: 'mica',
  });
  await expect(page.locator('[data-info-kind="windowEffectsLimited"]')).toHaveCount(0);
  await expect(page.locator('[data-window-background="solid"]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('default-theme.backdrop.v1'))).toBe('mica');
  expect(settings.errors).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const version of ['10.0.0', '13.0.0']) {
    test(`主题色背景与主视图跟随强调色并保存参数：${scheme} / ${version}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.addInitScript((platformVersion) => {
        localStorage.setItem(
          'default-theme.backdrop.v1',
          platformVersion === '10.0.0' ? 'mica' : 'none',
        );
        localStorage.setItem('default-theme.cover-accent.v1', 'off');
        localStorage.setItem(
          'default-theme.base-accent.v1',
          JSON.stringify({ mode: 'custom', custom: '#ff0000', windows: null }),
        );
        Object.defineProperty(navigator, 'userAgentData', {
          configurable: true,
          value: { platform: 'Windows', getHighEntropyValues: async () => ({ platformVersion }) },
        });
      }, version);
      const settings = await openSettings(page);
      await expect(settings.select('窗口背景')).toHaveText('主题色背景');
      await settings.expand('窗口背景');
      await expect(page.getByRole('combobox', { name: '背景取色', exact: true })).toHaveCount(0);
      const background = page.locator('[data-window-background="solid"]');
      const pane = page.locator('main [data-reading-fill]').first();
      const backgroundColor = () =>
        background.evaluate((element) => getComputedStyle(element).backgroundColor);
      const paneColor = () => pane.evaluate((element) => getComputedStyle(element).backgroundColor);
      const redBackground = await backgroundColor();
      const redPane = await paneColor();
      await settings.expand('强调色');
      await page.getByRole('button', { name: '自定义颜色', exact: true }).click();
      await page.getByRole('textbox', { name: '十六进制颜色', exact: true }).fill('#0000ff');
      await page.keyboard.press('Escape');
      await expect.poll(backgroundColor).not.toBe(redBackground);
      await expect.poll(paneColor).not.toBe(redPane);
      await page.getByRole('slider', { name: '主题色强度', exact: true }).press('End');
      await page.getByRole('slider', { name: '内容区域不透明度', exact: true }).press('End');
      await page.getByRole('slider', { name: '磨砂模糊', exact: true }).press('End');
      await page.getByRole('slider', { name: '磨砂颗粒', exact: true }).press('End');
      await expect(pane).toHaveCSS('backdrop-filter', 'blur(60px) saturate(1.1)');
      await expect
        .poll(() => pane.evaluate((element) => getComputedStyle(element, '::before').opacity))
        .toBe('0.1');
      await page.reload();
      await enterSettings(page);
      await settings.expand('窗口背景');
      await expect(page.getByRole('slider', { name: '主题色强度', exact: true })).toHaveValue('40');
      await expect(page.getByRole('slider', { name: '内容区域不透明度', exact: true })).toHaveValue(
        '100',
      );
      await expect(page.getByRole('slider', { name: '磨砂模糊', exact: true })).toHaveValue('60');
      await expect(page.getByRole('slider', { name: '磨砂颗粒', exact: true })).toHaveValue('10');
      expect(settings.errors).toEqual([]);
    });
  }
}

test('主题色背景和主视图复用强调色的封面取色开关', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('default-theme.backdrop.v1', 'none');
    localStorage.setItem(
      'default-theme.base-accent.v1',
      JSON.stringify({ mode: 'custom', custom: '#0000ff', windows: null }),
    );
    localStorage.setItem('default-theme.cover-accent.v1', 'off');
  });
  const redCover = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL();
  });
  const settings = await openSettings(page, {
    answers: {
      playback: {
        getState: { success: true, state: 'playing', canPause: true, canSeek: true },
        getCurrentTrack: { success: true, found: true, track: makeTrack() },
      },
      artwork: {
        getFb2kUrlByPath: (params) => ({
          success: true,
          available: true,
          type: 'front',
          path: String(params['path']),
          dataUrl: redCover,
        }),
      },
    },
  });
  const background = page.locator('[data-window-background="solid"]');
  const pane = page.locator('main [data-reading-fill]').first();
  const backgroundColor = () =>
    background.evaluate((element) => getComputedStyle(element).backgroundColor);
  const paneColor = () => pane.evaluate((element) => getComputedStyle(element).backgroundColor);
  const blueBackground = await backgroundColor();
  const bluePane = await paneColor();
  await settings.expand('强调色');
  const follow = page.getByRole('switch', { name: '跟随正在播放的封面颜色', exact: true });
  await follow.check();
  await expect.poll(backgroundColor).not.toBe(blueBackground);
  await expect.poll(paneColor).not.toBe(bluePane);
  await follow.uncheck();
  await expect.poll(backgroundColor).toBe(blueBackground);
  await expect.poll(paneColor).toBe(bluePane);
  expect(settings.errors).toEqual([]);
});
