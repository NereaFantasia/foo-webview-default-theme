import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { installPageHost } from '../fixtures/pageHost.ts';
import { openSettings } from '../fixtures/settingsPage.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

test.use({ screenshot: 'off' });

async function generation(page: Page, key: string): Promise<number> {
  return page.evaluate(async (key) => {
    const { createBrowserDataStorage }: typeof import('../../src/kit/browserDataStorage.ts') =
      await import(`${location.origin}/src/kit/browserDataStorage.ts`);
    const storage = createBrowserDataStorage({ database: indexedDB, legacy: null });
    try {
      return Number(await storage.getItem(`default-theme.data-gen.v1.config:${key}`));
    } finally {
      storage.dispose();
    }
  }, key);
}

async function openPrefs(page: Page) {
  await page.route('**/config-prefs-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><title>偏好持久化验证</title></html>',
    }),
  );
  await page.goto('/config-prefs-probe');
  return page.evaluateHandle(async () => {
    const { createConfigPrefsProbe }: typeof import('../fixtures/configPrefs.ts') = await import(
      `${location.origin}/tests/fixtures/configPrefs.ts`
    );
    return createConfigPrefsProbe();
  });
}

test('专辑页通过应用装配记录形态偏好的写入代数', async ({ page }) => {
  const host = await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  await page.goto('/');
  await expect(page.locator('[data-album-tile]').first()).toBeVisible();
  await page.locator('[data-album-form="list"]').click();
  await expect.poll(() => host.config.get('defaultTheme.browser.form')).toBe('list');
  await expect.poll(() => generation(page, 'defaultTheme.browser.form')).toBeGreaterThan(0);
  const first = await generation(page, 'defaultTheme.browser.form');
  await page.locator('[data-album-form="wall"]').click();
  await expect.poll(() => host.config.get('defaultTheme.browser.form')).toBe('wall');
  await expect.poll(() => generation(page, 'defaultTheme.browser.form')).toBeGreaterThan(first);
});

test('信息中心恢复提醒通过同一持久化入口记代数', async ({ page }) => {
  const key = 'defaultTheme.infoCenter.dismissed';
  const settings = await openSettings(page, { config: { [key]: { playcountMissing: '2.0.0' } } });
  await expect(settings.card('已关闭的提醒')).toContainText('已关闭 1 条');
  await page.getByRole('button', { name: '恢复 已关闭的提醒' }).click();
  await expect.poll(() => settings.host.config.get(key)).toEqual({});
  await expect.poll(() => generation(page, key)).toBeGreaterThan(0);
});

test('两个窗口的配置偏好共用写锁，后写者得到更大的代数', async ({ page, context }) => {
  const key = 'defaultTheme.test.preference';
  const host = await installPageHost(page);
  const popup = await context.newPage();
  const other = await installPageHost(popup);
  other.answer('config.set', (params) => {
    const value = params['value'];
    if (typeof value !== 'string') throw new Error('配置值应为字符串');
    host.config.set(key, value);
    return { success: true, key };
  });
  const first = await openPrefs(page);
  const second = await openPrefs(popup);
  const held = host.hold('config.set');
  const writing = first.evaluate((prefs) => prefs.set('first'));
  await expect.poll(() => held.pending.length).toBe(1);
  const queued = second.evaluate((prefs) => prefs.set('second'));
  await expect
    .poll(() => popup.evaluate(async () => (await navigator.locks.query()).pending?.length))
    .toBe(1);
  expect(await second.evaluate((prefs) => prefs.state())).toEqual({ status: 'pending' });
  held.release();
  expect(await writing).toBe(true);
  const firstState = await first.evaluate((prefs) => prefs.state());
  expect(await queued).toBe(true);
  const secondState = await second.evaluate((prefs) => prefs.state());
  expect(firstState?.status).toBe('saved');
  expect(secondState?.status).toBe('saved');
  if (firstState?.status !== 'saved' || secondState?.status !== 'saved')
    throw new Error('写入未完成');
  expect(secondState.generation).toBeGreaterThan(firstState.generation);
  expect(host.config.get(key)).toBe('second');
  expect(await generation(page, key)).toBe(secondState.generation);
  await first.evaluate((prefs) => prefs.dispose());
  await second.evaluate((prefs) => prefs.dispose());
});

test('配置失败状态保留当前值，显式重试成功后清除', async ({ page }) => {
  const key = 'defaultTheme.test.preference';
  const host = await installPageHost(page);
  host.answer('config.set', hostFailure('OPERATION_FAILED'));
  const prefs = await openPrefs(page);
  expect(await prefs.evaluate((prefs) => prefs.set('chosen'))).toBe(false);
  expect(await prefs.evaluate((prefs) => prefs.value())).toBe('chosen');
  expect(await prefs.evaluate((prefs) => prefs.state())).toEqual({
    status: 'failed',
    reason: 'write-failed',
  });
  expect(await generation(page, key)).toBe(0);
  host.answer('config.set', () => {
    host.config.set(key, 'chosen');
    return { success: true, key };
  });
  expect(await prefs.evaluate((prefs) => prefs.retry())).toBe(true);
  expect((await prefs.evaluate((prefs) => prefs.state()))?.status).toBe('saved');
  expect(host.config.get(key)).toBe('chosen');
  expect(await generation(page, key)).toBeGreaterThan(0);
  await prefs.evaluate((prefs) => prefs.dispose());
});
