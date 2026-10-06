import { expect, test, type Page } from '@playwright/test';
import { ONBOARDING_KEY } from '../../src/settings/onboarding/onboarding.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

// 新人引导：第一次启动打开、四步走完写记录、Esc 跳过、点压暗层不关、已有记录时不打开。
// 页面替身缺省带「已完成」记录，这里先删掉它。

interface Library {
  enabled: boolean;
  count: number;
}

async function open(page: Page, initial: Partial<Library> = {}, withRecord = false) {
  const errors = collectPageErrors(page);
  const library: Library = { enabled: false, count: 0, ...initial };
  const host = await installPageHost(page);
  if (!withRecord) host.config.delete(ONBOARDING_KEY);
  host.answerAll({
    config: {
      showLibraryPreferences: { success: true },
      getLibraryStatus: () => ({
        success: true,
        enabled: library.enabled,
        itemCount: library.count,
        initialized: true,
      }),
    },
    library: {
      getStatus: () => ({
        success: true,
        enabled: library.enabled,
        initialized: library.enabled,
        scanning: false,
        itemCount: library.count,
        count: library.count,
      }),
    },
    window: { setBackdropPolicy: hostFailure('OPERATION_FAILED') },
  });
  await page.goto('/');
  return { host, errors, library, dialog: page.getByRole('dialog') };
}

async function recordOf(host: PageHost): Promise<unknown> {
  await expect.poll(() => host.config.get(ONBOARDING_KEY)).toBeDefined();
  return host.config.get(ONBOARDING_KEY);
}

test('第一次启动打开引导，停在第 1 步；添加文件夹之后「下一步」换成主按钮', async ({ page }) => {
  const { host, errors, library, dialog } = await open(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('heading', { name: '媒体库' })).toBeFocused();
  await expect(dialog).toContainText('尚未添加文件夹');
  await dialog.getByRole('button', { name: /添加文件夹/ }).click();
  expect(host.callsTo('config.showLibraryPreferences')).toHaveLength(1);

  library.enabled = true;
  library.count = 3698;
  await host.emit('library:itemsAdded', { count: 3698, timestamp: 1 });
  await expect(dialog).toContainText('共 3,698 首');
  await expect(dialog.getByRole('button', { name: /管理文件夹/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('四步走完写下「已完成」，关掉后不再出现', async ({ page }) => {
  const { host, errors, dialog } = await open(page, { enabled: true, count: 10 });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect(dialog.getByRole('heading', { name: '外观' })).toBeFocused();
  await dialog.getByRole('radio', { name: '标题栏' }).check();
  await expect(dialog.getByRole('radio', { name: '标题栏' })).toBeChecked();
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect(dialog.getByRole('heading', { name: '托盘' })).toBeVisible();
  await dialog.getByRole('button', { name: '上一步' }).click();
  await expect(dialog.getByRole('heading', { name: '外观' })).toBeVisible();
  await dialog.getByRole('button', { name: '下一步' }).click();
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect(dialog.getByRole('heading', { name: '更新与联网' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '跳过引导' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '完成' }).click();
  await expect(dialog).toBeHidden();
  expect(await recordOf(host)).toEqual({ version: 1, outcome: 'completed' });
  expect(errors).toEqual([]);
});

test('Esc 等同跳过；点压暗层不关', async ({ page }) => {
  const { host, errors, dialog } = await open(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.mouse.click(4, 400);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await recordOf(host)).toEqual({ version: 1, outcome: 'skipped' });
  expect(errors).toEqual([]);
});

test('打开期间 Alt+← 不让背后的外壳后退', async ({ page }) => {
  const { dialog } = await open(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const before = page.url();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(before);
});

test('已经有记录时不打开', async ({ page }) => {
  const { errors, dialog } = await open(page, {}, true);
  await expect(page.getByRole('navigation', { name: '侧边栏' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('窄窗时界面语言挪进正文', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { dialog } = await open(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.locator('[data-settings-card]').filter({ hasText: '界面语言' }),
  ).toBeVisible();
});

test('换步时正文横移进来，底板与页脚跟着新高度走', async ({ page }) => {
  const { dialog } = await open(page, { enabled: true, count: 10 });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await dialog.getByRole('button', { name: '下一步' }).click();
  const running = await page.evaluate(() =>
    document.getAnimations().flatMap((animation) => {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || !effect.target) return [];
      return effect.getKeyframes().flatMap((frame) => Object.keys(frame));
    }),
  );
  expect(running).toEqual(expect.arrayContaining(['transform', 'opacity', 'clipPath']));
});

test('关掉引导之后，媒体库是空的地点空态带「添加文件夹」', async ({ page }) => {
  const { host, errors, dialog } = await open(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const add = page.getByRole('main').getByRole('button', { name: '添加文件夹' });
  await expect(add).toBeVisible();
  await add.click();
  await expect.poll(() => host.callsTo('config.showLibraryPreferences').length).toBe(1);
  expect(errors).toEqual([]);
});
