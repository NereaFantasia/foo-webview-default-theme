import { expect, test, type Page } from '@playwright/test';
import { HOST_VERSION, hostFailure } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 宿主版本的核对只在出问题时露面：读不到版本、版本低于要求时，标题栏中间出一行提示；版本满足、
// 普通浏览器里没有宿主时，界面上找不到任何与它相关的内容，侧边栏里也没有。提示区常在，核对还没有
// 结果时标 aria-busy，用例等它撤掉再断言。

const hint = (page: Page) => page.getByRole('banner').getByRole('status');
const settled = (page: Page) =>
  page.getByRole('banner').locator('[role="status"]:not([aria-busy])');

test('没有宿主时标题栏不提示：等宿主超时之后提示区仍是空的', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(hint(page)).toBeAttached({ timeout: 10_000 });
  await expect(settled(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(hint(page)).toHaveText('');
  expect(errors).toEqual([]);
});

test('版本满足时界面上没有任何版本相关的内容', async ({ page }) => {
  const errors = collectPageErrors(page);
  await installPageHost(page);
  await page.goto('/');
  await expect(settled(page)).toHaveCount(1);
  await expect(hint(page)).toHaveText('');
  await expect(page.getByText(HOST_VERSION)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('版本低于要求时标题栏提示当前版本与要求的版本', async ({ page }) => {
  const errors = collectPageErrors(page);
  await installPageHost(page, {
    answers: {
      config: {
        getVersionInfo: {
          success: true,
          version: 'foobar2000 v2.25',
          foobar2000: 'foobar2000 v2.25',
          versionFull: 'foobar2000 v2.25 x64',
          is64bit: true,
          isPortable: true,
          profilePath: 'E:/FB2K/foobar2000/profile',
          plugin: { name: 'foo_ui_webview2', version: '1.13.2' },
        },
      },
    },
  });
  await page.goto('/');
  await expect(hint(page)).toHaveText(
    /^需要 foo_ui_webview2 \d+\.\d+\.\d+ 或更高版本，当前为 1\.13\.2$/,
  );
  await expect(page.getByRole('navigation', { name: '侧边栏' }).getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('读不到版本时标题栏报读取失败', async ({ page }) => {
  const errors = collectPageErrors(page);
  await installPageHost(page, {
    answers: { config: { getVersionInfo: hostFailure('INTERNAL_ERROR') } },
  });
  await page.goto('/');
  await expect(hint(page)).toHaveText('组件版本读取失败');
  expect(errors).toEqual([]);
});
