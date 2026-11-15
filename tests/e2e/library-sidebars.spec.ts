import { expect, test, type Locator, type Page } from '@playwright/test';
import { openGenres } from '../fixtures/genresPage.ts';
import { openFolders } from '../fixtures/foldersPage.ts';

async function drag(page: Page, separator: Locator, delta: number) {
  const box = await separator.boundingBox();
  if (!box) throw new Error('分隔条未显示');
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + 30, { steps: 5 });
}

test('文件夹沿用原宽度存档，取消指针后还原且保留旧高度字段', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.folders-split.v1',
      JSON.stringify({ width: 350, height: 187 }),
    );
  });
  const env = await openFolders(page);
  const separator = env.view.getByRole('separator', { name: '调整目录树与曲目预览大小' });
  await expect(separator).toHaveAttribute('aria-valuenow', '350');
  await drag(page, separator, -80);
  await separator.dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '350');
  expect(await page.evaluate(() => localStorage.getItem('default-theme.folders-split.v1'))).toBe(
    JSON.stringify({ width: 350, height: 187 }),
  );
  expect(env.errors).toEqual([]);
});

// 艺人页改成封面墙后没有左栏，这两条只剩流派
{
  const title = '流派';
  const selected = '[data-genre-name]';
  test(`${title}：拖宽、键盘、取消与折叠恢复不会覆盖偏好宽度`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const env = await openGenres(page);
    const separator = env.view.getByRole('separator', { name: `${title}列表宽度` });
    await expect(separator).toHaveAttribute('aria-valuenow', '280');
    await drag(page, separator, 64);
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '344');
    await separator.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(separator).toHaveAttribute('aria-valuenow', '328');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '328');
    await drag(page, separator, -70);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '328');
    await drag(page, separator, 40);
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(separator).toHaveCount(0);
    await page.mouse.up();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(separator).toHaveAttribute('aria-valuenow', '328');
    await page.reload();
    await page
      .getByRole('navigation', { name: '侧边栏' })
      .getByRole('button', { name: title, exact: true })
      .click();
    await expect(separator).toHaveAttribute('aria-valuenow', '328');
    const otherArea = 'artists';
    expect(
      await page.evaluate(
        (name) => localStorage.getItem(`default-theme.${name}-split.v1`),
        otherArea,
      ),
    ).toBeNull();
    expect(env.errors).toEqual([]);
  });

  test(`${title}：窗口不变时按页面可用宽度折叠，多选与筛选跨抽屉保留`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const env = await openGenres(page);
    const separator = env.view.getByRole('separator', { name: `${title}列表宽度` });
    await expect(separator).toBeVisible();
    const rows = env.view.locator(selected);
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await expect(env.view.locator(`${selected}[aria-selected="true"]`)).toHaveCount(2);
    await env.view.evaluate((node) => {
      node.style.width = '800px';
    });
    await expect(separator).toHaveCount(0);
    expect(page.viewportSize()?.width).toBe(1280);
    const trigger = env.view.getByRole('button', { name: `${title}列表`, exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: `${title}列表` });
    await expect(drawer.locator(`${selected}[aria-selected="true"]`)).toHaveCount(2);
    await drawer.getByRole('textbox', { name: `筛选${title}` }).fill('hop');
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(drawer.getByRole('textbox', { name: `筛选${title}` })).toHaveValue('hop');
    await env.view.evaluate((node) => {
      node.style.removeProperty('width');
    });
    await expect(drawer).not.toBeVisible();
    await expect(separator).toBeVisible();
    await expect(env.view.getByRole('textbox', { name: `筛选${title}` })).toHaveValue('hop');
    await page.setViewportSize({ width: 390, height: 800 });
    await trigger.click();
    await expect(drawer).toBeVisible();
    await drawer.locator(selected).first().click();
    await expect(drawer).not.toBeVisible();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(env.view).toHaveCount(0);
    expect(env.errors).toEqual([]);
  });
}
