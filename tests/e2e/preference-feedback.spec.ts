import { expect, test, type Page } from '@playwright/test';
import { openSettings, enterSettings } from '../fixtures/settingsPage.ts';
import { installPageHost } from '../fixtures/pageHost.ts';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

test.use({ screenshot: 'off' });

async function failBrowserWrites(page: Page, key: string) {
  await page.addInitScript((blocked) => {
    Reflect.set(window, '__failPreferenceWrite', true);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (
        this.name === 'values' &&
        key === blocked &&
        Reflect.get(window, '__failPreferenceWrite')
      ) {
        throw new DOMException('无法写入偏好', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  }, key);
}

async function allowBrowserWrites(page: Page) {
  await page.evaluate(() => Reflect.set(window, '__failPreferenceWrite', false));
}

async function trustedValue(page: Page, key: string) {
  return page.evaluate(async (key) => {
    const { createBrowserDataStorage }: typeof import('../../src/kit/browserDataStorage.ts') =
      await import(`${location.origin}/src/kit/browserDataStorage.ts`);
    const storage = createBrowserDataStorage({ database: indexedDB, legacy: null });
    try {
      return await storage.getItem(key);
    } finally {
      storage.dispose();
    }
  }, key);
}

const center = (page: Page) => page.locator('[data-info-center]');
const summary = (page: Page) => center(page).locator('[data-info-kind="preferencesUnsaved"]');

for (const scheme of ['light', 'dark'] as const) {
  test(`设置保存失败就地提示，保留当前值，重试后可信副本与刷新结果一致（${scheme}）`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const key = 'default-theme.color-mode.v1';
    await failBrowserWrites(page, key);
    const settings = await openSettings(page);
    const chosen = scheme === 'light' ? '深色' : '浅色';
    await settings.choose('颜色模式', chosen);
    const card = settings.card('颜色模式');
    await expect(card).toContainText('设置已生效，但未能保存');
    await expect(settings.select('颜色模式')).toHaveText(chosen);
    expect(await trustedValue(page, key)).toBeNull();
    await settings.choose('音量刻度', '按分贝（同 foobar2000）');
    await expect(card).toContainText('未能保存');
    await allowBrowserWrites(page);
    const retry = card.getByRole('button', { name: '重试保存' });
    await retry.click();
    await expect(card.locator('[data-save-feedback]')).toContainText('已保存');
    await expect(card).not.toContainText('未能保存');
    await expect(retry).toBeFocused();
    expect(await trustedValue(page, key)).toBe(scheme === 'light' ? 'dark' : 'light');
    await page.reload();
    await enterSettings(page);
    await expect(settings.select('颜色模式')).toHaveText(chosen);
    expect(settings.errors).toEqual([]);
  });

  for (const style of ['bottom', 'titlebar', 'capsule']) {
    test(`分栏偏好在信息中心汇总，390 窄窗可重试并用 Esc 收起（${scheme} / ${style}）`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const key = 'default-theme.sidebar.v1';
      await failBrowserWrites(page, key);
      await page.addInitScript(
        (style) => localStorage.setItem('default-theme.player-bar.v1', style),
        style,
      );
      await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
      await page.goto('/');
      const splitter = page.getByRole('separator', { name: '调整侧边栏宽度' });
      await splitter.focus();
      await page.keyboard.press('End');
      await expect(splitter).toHaveAttribute('aria-valuenow', '360');
      const trigger = page.locator('[data-info-center-trigger]');
      await expect(trigger).toBeVisible();
      await page.setViewportSize({ width: 390, height: 540 });
      await trigger.click();
      await expect(summary(page)).toContainText('部分设置未能保存');
      const bounds = await center(page).boundingBox();
      if (!bounds) throw new Error('信息中心未出现');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(541);
      const triggerBounds = await trigger.boundingBox();
      expect(triggerBounds && triggerBounds.x + triggerBounds.width).toBeLessThanOrEqual(390);
      await allowBrowserWrites(page);
      const retry = summary(page).getByRole('button', { name: '重试保存' });
      await retry.click();
      await expect(summary(page)).toContainText('已保存');
      await expect(retry).toBeFocused();
      expect(JSON.parse((await trustedValue(page, key)) ?? '{}')).toMatchObject({ width: 360 });
      await page.keyboard.press('Escape');
      await expect(center(page)).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }
}

test('宿主偏好保存失败汇总后重试，成功后原服务和页面一致', async ({ page }) => {
  const key = 'defaultTheme.browser.form';
  const host = await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  host.answer('config.set', hostFailure('OPERATION_FAILED'));
  await page.goto('/');
  await expect(page.locator('[data-album-tile]').first()).toBeVisible();
  await page.locator('[data-album-form="list"]').click();
  await page.locator('[data-info-center-trigger]').click();
  await expect(summary(page)).toContainText('部分设置未能保存');
  host.answer('config.set', (params) => {
    const name = String(params['key']);
    if (name === key) host.config.set(name, String(params['value']));
    return { success: true, key: name };
  });
  await summary(page).getByRole('button', { name: '重试保存' }).click();
  await expect(summary(page)).toContainText('已保存');
  expect(host.config.get(key)).toBe('list');
  await page.keyboard.press('Escape');
  await page.locator('[data-album-form="wall"]').click();
  await expect.poll(() => host.config.get(key)).toBe('wall');
});

test('设置页恢复提醒的保存失败就地显示，重试不再改提醒数量', async ({ page }) => {
  const key = 'defaultTheme.infoCenter.dismissed';
  const settings = await openSettings(page, { config: { [key]: { playcountMissing: '2.0.0' } } });
  settings.host.answer('config.set', hostFailure('OPERATION_FAILED'));
  const card = settings.card('已关闭的提醒');
  await card.getByRole('button', { name: '恢复 已关闭的提醒' }).click();
  await expect(card).toContainText('设置已生效，但未能保存');
  await expect(card).toContainText('没有已关闭的提醒');
  settings.host.answer('config.set', () => {
    settings.host.config.set(key, {});
    return { success: true, key };
  });
  await card.getByRole('button', { name: '重试保存' }).click();
  await expect(card.locator('[data-save-feedback]')).toContainText('已保存');
  expect(settings.host.config.get(key)).toEqual({});
});

test('存储初始化不可用时直接说明，修改仍生效但不显示无效的重试按钮', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  const settings = await openSettings(page);
  await page.locator('[data-info-center-trigger]').click();
  await expect(center(page)).toContainText('设置存储不可用');
  await expect(center(page)).toContainText('修改只在当前窗口生效');
  await page.keyboard.press('Escape');
  await settings.choose('颜色模式', '深色');
  await expect(settings.select('颜色模式')).toHaveText('深色');
  await expect(settings.card('颜色模式')).toContainText('修改只在当前窗口生效');
  await expect(settings.card('颜色模式').getByRole('button', { name: '重试保存' })).toHaveCount(0);
});

test('Last.fm 设置卡收起后仍可重试保存，汇总不显示凭据，重试只保存', async ({ page }) => {
  const key = 'defaultTheme.online.lastfmKey';
  const chosen = '0123456789abcdef0123456789abcdef';
  const settings = await openSettings(page);
  await page.getByRole('switch', { name: '在线艺人简介', exact: true }).check();
  await expect
    .poll(() => settings.host.config.get('defaultTheme.online.biography'))
    .toMatchObject({ enabled: true });
  settings.host.answer('config.set', hostFailure('OPERATION_FAILED'));
  settings.host.answer('http.get', {
    success: true,
    status: 200,
    headers: {},
    body: '{}',
    responseType: 'text',
  });
  await settings.expand('在线艺人简介');
  const row = settings.row('Last.fm API 密钥');
  const card = settings.expander('在线艺人简介');
  const input = page.getByLabel('Last.fm API 密钥', { exact: true });
  await input.fill(chosen);
  await input.press('Enter');
  await expect(row).toContainText('可用');
  await expect(card).toContainText('设置已生效，但未能保存');
  await card.locator('[data-settings-toggle]').click();
  await expect(row).toHaveCount(0);
  await expect(card.getByText('设置已生效，但未能保存。', { exact: true })).toBeVisible();
  await page.locator('[data-info-center-trigger]').click();
  await expect(summary(page)).toContainText('部分设置未能保存');
  await expect(center(page)).not.toContainText(chosen);
  await expect(center(page)).not.toContainText(key);
  await page.keyboard.press('Escape');
  const calls = settings.host.callsTo('http.get').length;
  settings.host.answer('http.get', hostFailure('OPERATION_FAILED'));
  settings.host.answer('config.set', () => {
    settings.host.config.set(key, chosen);
    return { success: true, key };
  });
  await card.getByRole('button', { name: '重试保存' }).click();
  await expect(card).toContainText('已保存');
  await expect(card).not.toContainText('未能保存');
  await expect(card.locator('[data-settings-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await settings.expand('在线艺人简介');
  await expect(row).toContainText('可用');
  expect(settings.host.config.get(key)).toBe(chosen);
  expect(settings.host.callsTo('http.get')).toHaveLength(calls);
});
