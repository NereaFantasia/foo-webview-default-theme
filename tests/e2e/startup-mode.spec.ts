import { expect, test, type Page } from '@playwright/test';
import { installPageHost } from '../fixtures/pageHost.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

test.use({ screenshot: 'off' });

async function databases(page: Page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name));
}

for (const scheme of ['light', 'dark'] as const) {
  for (const mode of ['dui', 'cui'] as const) {
    test(`${mode} 面板只显示说明，业务与偏好存储不启动（${scheme}）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 300 });
      const host = await installPageHost(page, {
        answers: {
          window: {
            getMode: { success: true, mode, panelMode: true, windowId: 'panel-1' },
          },
        },
      });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '本主题只支持独立窗口模式' })).toBeVisible();
      await expect(page.locator('.startup-overlay')).toBeHidden();
      await expect(page.getByRole('navigation', { name: '侧边栏' })).toHaveCount(0);
      await expect(page.locator('#root > .fui-FluentProvider')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      expect(await databases(page)).not.toContain('default-theme.data.v1');
      expect(host.calls.map(({ method }) => method)).toEqual(['window.getMode']);
    });
  }
}

test('模式应答前不启动业务，确认独立窗口后加载正常界面 @smoke', async ({ page }) => {
  const host = await installPageHost(page);
  const held = host.hold('window.getMode');
  await page.goto('/');
  await expect(page.getByText('正在确认窗口模式…')).toBeVisible();
  await expect.poll(() => held.pending.length).toBe(1);
  expect(await databases(page)).not.toContain('default-theme.data.v1');
  expect(host.calls.map(({ method }) => method)).toEqual(['window.getMode']);
  held.release();
  await expect(page.getByRole('heading', { name: '专辑', level: 1 })).toBeVisible();
  expect(await databases(page)).toContain('default-theme.data.v1');
});

test('启动等待层先于脚本盖住页面，深色底显示当前步骤，界面挂上后收起', async ({ page }) => {
  const host = await installPageHost(page);
  const held = host.hold('window.getMode');
  await page.goto('/');
  const overlay = page.locator('#server-loading');
  await expect(overlay).toHaveText('正在确认窗口模式…');
  await expect(overlay).toHaveCSS('background-color', 'rgb(41, 41, 41)');
  await expect(page.locator('[data-startup-state]')).toHaveCount(0);
  await expect.poll(() => held.pending.length).toBe(1);
  held.release();
  await expect(page.getByRole('heading', { name: '专辑', level: 1 })).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.startup-overlay')).toBeHidden();
});

test('模式读取失败保留重试入口，不把失败当成独立窗口', async ({ page }) => {
  const host = await installPageHost(page);
  host.answer('window.getMode', hostFailure('OPERATION_FAILED'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '无法确认窗口模式' })).toBeVisible();
  await expect(page.locator('.startup-overlay')).toBeHidden();
  expect(await databases(page)).not.toContain('default-theme.data.v1');
  host.answer('window.getMode', {
    success: true,
    mode: 'standalone',
    panelMode: false,
    windowId: 'main',
  });
  await page.getByRole('button', { name: '重新检查' }).click();
  await expect(page.getByRole('heading', { name: '专辑', level: 1 })).toBeVisible();
});

test('主题启动失败时记下异常，复制排在重新加载前面，文本里有异常的名称与消息', async ({ page }) => {
  const host = await installPageHost(page);
  host.answer('clipboard.write', { success: true });
  await page.route(/\/src\/app\/appServices\.ts/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '主题启动失败' })).toBeVisible();
  const buttons = page.locator('[data-startup-state="startFailed"] button');
  await expect(buttons).toHaveText(['复制运行日志', '重新加载']);
  await buttons.first().click();
  await expect(buttons.first()).toHaveText('已复制');
  const text = String(host.callsTo('clipboard.write').at(-1)?.['text']);
  expect(text).toMatch(/^foo-webview-default-theme \d+\.\d+\.\d+\nuser agent: /);
  expect(text).toContain('start name=TypeError');
  expect(text).toContain('Failed to fetch dynamically imported module');
});

test('超时的旧应答不会启动业务，用户重试后以新模式为准', async ({ page }) => {
  const host = await installPageHost(page);
  const held = host.hold('window.getMode');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '无法确认窗口模式' })).toBeVisible({
    timeout: 10_000,
  });
  held.release();
  await expect(page.getByRole('heading', { name: '无法确认窗口模式' })).toBeVisible();
  expect(await databases(page)).not.toContain('default-theme.data.v1');
  host.answer('window.getMode', {
    success: true,
    mode: 'cui',
    panelMode: true,
    windowId: 'panel-1',
  });
  await page.getByRole('button', { name: '重新检查' }).click();
  await expect(page.getByRole('heading', { name: '本主题只支持独立窗口模式' })).toBeVisible();
});

test('没有宿主的开发服务器仍可预览主题', async ({ page }) => {
  await page.goto('/');
  // 没有宿主替身预存的启动落点，停在缺省的首页
  await expect(page.getByRole('heading', { name: '首页', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-startup-state]')).toHaveCount(0);
  await expect(page.locator('.startup-overlay')).toBeHidden();
});
