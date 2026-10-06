import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import '/src/styles/global.css';
        import { startupOverlay } from '/src/app/startupOverlay.ts';
        import '/tests/fixtures/contextMenuEntry.ts';
        startupOverlay.dismiss();`,
    }),
  );
});

test('宽窗级联、限高滚动、键盘翻页与关闭返回焦点', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('[data-open-menu]').click({ button: 'right' });
  const root = page.locator('[data-context-menu-owner]').first();
  await expect(root).toBeVisible();
  await expect.poll(async () => (await root.boundingBox())?.height).toBeLessThanOrEqual(600);
  await page.getByRole('menuitem', { name: '发送到播放列表', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: '新建播放列表', exact: true })).toBeVisible();
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(2);
  await page.getByRole('menuitem', { name: '新建播放列表', exact: true }).focus();
  await page.keyboard.press('PageDown');
  await expect
    .poll(() =>
      page
        .locator('[data-context-commands]')
        .last()
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(0);
  await expect(page.locator('[data-open-menu]')).toBeFocused();
});

test('窄窗同层进入和返回，保留父层滚动与触发项焦点', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await page.goto('/?light');
  await page.locator('[data-open-menu]').click();
  await page.getByRole('menuitem', { name: '发送到播放列表', exact: true }).click();
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(1);
  await expect(page.locator('[data-context-back]')).toBeVisible();
  await page.getByRole('menuitem', { name: '新建播放列表', exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByRole('menuitem', { name: '更多目标', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '深层目标', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: '更多目标', exact: true })).toBeFocused();
  await expect
    .poll(() => page.locator('[data-context-commands]').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.locator('[data-context-back]').click();
  await expect(page.getByRole('menuitem', { name: '发送到播放列表', exact: true })).toBeFocused();
  const box = await page.locator('[data-context-menu-owner]').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(366);
  expect(box!.height).toBeLessThanOrEqual(336);
});

test('短窗口中央打开高菜单，上下都放不下时仍保持在视口内', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await page.goto('/');
  await page.locator('[data-open-menu]').dispatchEvent('contextmenu', {
    button: 2,
    clientX: 195,
    clientY: 180,
  });
  const root = page.locator('[data-context-menu-owner]').first();
  await expect(root).toBeVisible();
  await expect
    .poll(() => root.evaluate((node) => node.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => root.evaluate((node) => node.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(360);
  await page.keyboard.press('End');
  await expect
    .poll(() => root.locator('[data-context-commands]').evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
});

test('评分勾选、点击外部不抢焦点、不可用项不执行', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page.locator('[data-open-menu]').click();
  await expect(page.getByRole('menuitem', { name: '从播放列表移除', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('menuitem', { name: '评分', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: '3 星', exact: true })).toBeChecked();
  await page.getByRole('menuitemradio', { name: '5 星', exact: true }).click();
  await expect(page.locator('output')).toHaveText('five');
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(0);
  await page.locator('[data-open-menu]').click();
  await page.getByRole('textbox', { name: '其他输入' }).click();
  await expect(page.getByRole('textbox', { name: '其他输入' })).toBeFocused();
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(0);
});

test('重试保留菜单，绑定对象变化时立即关闭', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-open-menu]').click();
  await page.getByRole('menuitem', { name: '重新读取', exact: true }).click();
  await expect(page.locator('output')).toHaveText('retried');
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(1);
  await page.getByRole('menuitem', { name: '更新对象', exact: true }).click();
  await expect(page.locator('[data-context-menu-owner]')).toHaveCount(0);
  await expect(page.locator('[data-closed-by]')).toHaveText('invalidated');
});
