import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

async function openSplitters(page: Page, width = 1440, rightWidth = 320) {
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript((panelWidth) => {
    localStorage.setItem('default-theme.sidebar.v1', JSON.stringify({ rail: false, width: 260 }));
    localStorage.setItem(
      'default-theme.right-card.v1',
      JSON.stringify({ open: true, page: 'info', width: panelWidth }),
    );
  }, rightWidth);
  const errors = collectPageErrors(page);
  await installPageHost(page);
  await page.goto('/');
  const left = page.getByRole('separator', { name: '调整侧边栏宽度' });
  const right = page.getByRole('separator', { name: '调整面板宽度' });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const card = page.locator('main [data-reading-surface]').locator('..');
  return { left, right, card, errors };
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme}：手柄骑缝、上下齐平，悬停与聚焦显示实色竖条且不改变布局`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const shell = await openSplitters(page);
    const card = await shell.card.boundingBox();
    if (!card) throw new Error('主视图没有显示');
    for (const [handle, edge] of [
      [shell.left, card.x],
      [shell.right, card.x + card.width],
    ] as const) {
      const bounds = await handle.boundingBox();
      if (!bounds) throw new Error('手柄没有显示');
      expect(bounds.x + bounds.width / 2).toBeCloseTo(edge);
      expect(bounds.y).toBeCloseTo(card.y);
      expect(bounds.height).toBeCloseTo(card.height);
      const grip = handle.locator('span');
      await expect(grip).toHaveCSS('opacity', '0');
      await handle.hover();
      await expect(grip).toHaveCSS('opacity', '1');
      await expect(grip).toHaveCSS('transition-duration', '0.25s, 0.083s');
      await expect(grip).toHaveCSS('transition-delay', '0.333s, 0s');
      const surface = await grip.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.backgroundColor,
          radius: parseFloat(style.borderTopLeftRadius),
          height: element.getBoundingClientRect().height,
        };
      });
      expect(surface.color).toMatch(/^rgb\(/);
      expect(surface.radius).toBeGreaterThanOrEqual(bounds.width / 2);
      expect(surface.height).toBeCloseTo(card.height);
      expect(await shell.card.boundingBox()).toEqual(card);
      await page.mouse.move(0, 0);
      await expect(grip).toHaveCSS('opacity', '0');
      await page.keyboard.press('Tab');
      await handle.focus();
      await expect(grip).toHaveCSS('opacity', '1');
      await handle.evaluate((element) => element.blur());
      await expect(grip).toHaveCSS('opacity', '0');
    }
    expect(shell.errors).toEqual([]);
  });
}

test('从手柄边缘起拖不跳宽，移出主视图仍跟手，Esc 恢复两侧原宽度', async ({ page }) => {
  const shell = await openSplitters(page);
  for (const [handle, initial, direction] of [
    [shell.left, 260, 1],
    [shell.right, 320, -1],
  ] as const) {
    const bounds = await handle.boundingBox();
    if (!bounds) throw new Error('手柄没有显示');
    const x = bounds.x + 1;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 1);
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial));
    await page.mouse.move(x + direction * 17, bounds.y + bounds.height + 8);
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 17));
    await expect(handle).toHaveAttribute('data-dragging', 'true');
    await expect(handle.locator('span')).toHaveCSS('opacity', '1');
    await expect(handle.locator('span')).toHaveCSS('transition-delay', '0s');
    await page.keyboard.press('Escape');
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial));
    await expect(handle).not.toHaveAttribute('data-dragging');
    await page.mouse.up();
  }
  expect(shell.errors).toEqual([]);
});

test('右侧受窗口宽度限制时从实际宽度起拖，取消后保留原偏好', async ({ page }) => {
  const shell = await openSplitters(page, 1100, 480);
  const panel = page.locator('[data-form="docked"]');
  const before = await panel.boundingBox();
  const handle = await shell.right.boundingBox();
  if (!before || !handle) throw new Error('右侧面板没有显示');
  expect(before.width).toBeLessThan(480);
  const x = handle.x + handle.width - 1;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y);
  await expect(shell.right).toHaveAttribute('aria-valuenow', String(before.width - 1));
  expect((await panel.boundingBox())?.width).toBe(before.width - 1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(shell.right).toHaveAttribute('aria-valuenow', '480');
  expect((await panel.boundingBox())?.width).toBe(before.width);
  expect(shell.errors).toEqual([]);
});

test('减弱动效时两侧手柄直接显现', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shell = await openSplitters(page);
  for (const handle of [shell.left, shell.right]) {
    await handle.hover();
    await expect(handle.locator('span')).toHaveCSS('opacity', '1');
    await expect(handle.locator('span')).toHaveCSS('transition-duration', '0.001s, 0.001s');
  }
  expect(shell.errors).toEqual([]);
});
