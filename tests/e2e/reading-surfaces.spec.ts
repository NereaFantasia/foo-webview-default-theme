import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPlayer } from '../fixtures/playerPage.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { openGenres } from '../fixtures/genresPage.ts';
import { openFolders } from '../fixtures/foldersPage.ts';

test.use({ screenshot: 'off' });

async function prepare(page: Page, scheme: 'light' | 'dark', content: number) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.addInitScript((amount) => {
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({ source: 'palette', light: { content: amount }, dark: { content: amount } }),
    );
    localStorage.setItem(
      'default-theme.background-appearance.v1',
      JSON.stringify({ light: { tint: 0 }, dark: { tint: 0 } }),
    );
  }, content);
}

async function rgba(element: Locator) {
  return element.evaluate((node) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取表面颜色');
    context.fillStyle = getComputedStyle(node).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
}

async function expectOpaque(panel: Locator, scheme: 'light' | 'dark') {
  await expect(panel).toBeVisible();
  await expect
    .poll(() => rgba(panel))
    .toEqual(scheme === 'dark' ? [20, 20, 20, 255] : [255, 255, 255, 255]);
  await expect(panel).toHaveCSS('backdrop-filter', 'none');
  await expect(panel.locator('[data-reading-edge]')).toHaveCount(0);
  await expect(panel).not.toHaveCSS('box-shadow', 'none');
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} 主视图阅读面可调，停靠右侧透明且共用一个色场`, async ({ page }) => {
    await prepare(page, scheme, 100);
    const player = await openPlayer(page);
    const pane = page.locator('main [data-reading-fill]').first();
    await expect
      .poll(() => rgba(pane))
      .toEqual(scheme === 'dark' ? [10, 10, 10, 255] : [250, 250, 250, 255]);
    await page.locator('[data-right-card-key="queue"]').click();
    const right = page.locator('[data-form="docked"]');
    await expect(right).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(right).toHaveCSS('backdrop-filter', 'none');
    await expect(right).toHaveCSS('box-shadow', 'none');
    await expect(right.locator('[data-reading-surface]')).toHaveCount(0);
    await expect(page.locator('[data-reading-surface]')).toHaveCount(1);
    await expect(page.locator('canvas[data-palette-field]')).toHaveCount(1);
    for (const surface of await page.locator('[data-reading-surface]').all()) {
      await expect(surface).toHaveCSS('pointer-events', 'none');
      await expect(surface.locator('canvas')).toHaveCount(0);
      const edge = surface.locator('[data-reading-edge]');
      await expect(edge).toHaveCSS('mask-composite', 'exclude, exclude');
      await expect(edge).toHaveCSS(
        'backdrop-filter',
        scheme === 'dark' ? 'blur(6px) saturate(1.25) brightness(1.35)' : 'blur(6px)',
      );
      expect(
        await edge.evaluate((node) => {
          const parent = node.parentElement;
          return parent && getComputedStyle(parent).backdropFilter;
        }),
      ).toBe('none');
    }
    await enterSettings(page);
    const toggle = page
      .locator('[data-settings-expander]')
      .filter({ has: page.getByRole('combobox', { name: '窗口背景', exact: true }) })
      .locator('[data-settings-toggle]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const opacity = page.getByRole('slider', { name: '内容区域不透明度', exact: true });
    await opacity.focus();
    await opacity.press('Home');
    await expect.poll(async () => (await rgba(pane))[3]).toBe(0);
    await expect.poll(async () => (await rgba(right))[3]).toBe(0);
    await expect(page.locator('canvas[data-palette-field]')).toHaveCount(1);
    expect(player.errors).toEqual([]);
  });

  test(`${scheme} 窄窗左右临时面板保持实色，点外部和 Esc 收起`, async ({ page }) => {
    await prepare(page, scheme, 0);
    const player = await openPlayer(page);
    for (const width of [900, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const queueKey = page.locator('[data-right-card-key="queue"]');
      await queueKey.click();
      const right = page.locator('[data-form="overlay"]');
      await expectOpaque(right, scheme);
      const rightBox = await right.boundingBox();
      const hostBox = await right.evaluate((node) => {
        const host = node instanceof HTMLElement ? node.offsetParent : null;
        const rect = host?.getBoundingClientRect();
        return rect ? { x: rect.x, right: rect.right } : null;
      });
      expect(rightBox && rightBox.x >= 0 && rightBox.x + rightBox.width <= width).toBe(true);
      await page.mouse.click(2, 160);
      await expect(right).toHaveCount(0);
      await queueKey.click();
      await page.keyboard.press('Escape');
      await expect(right).toHaveCount(0);
      await expect(queueKey).toBeFocused();

      const sidebarKey = page.locator('[data-sidebar-key]');
      await sidebarKey.click();
      const sidebar = page.locator('[data-sidebar-overlay]');
      await expectOpaque(sidebar, scheme);
      const box = await sidebar.boundingBox();
      if (!box || !rightBox || !hostBox) throw new Error('无法读取左右浮层的位置');
      expect(box.y).toBeCloseTo(rightBox.y, 0);
      expect(box.height).toBeCloseTo(rightBox.height, 0);
      expect(box.x - hostBox.x).toBeCloseTo(hostBox.right - rightBox.x - rightBox.width, 0);
      if (width <= 640) expect(box.width).toBeCloseTo(rightBox.width, 0);
      await page.mouse.click(width - 4, 160);
      await expect(sidebar).toHaveCount(0);
      await sidebarKey.click();
      await page.keyboard.press('Escape');
      await expect(sidebar).toHaveCount(0);
      await expect(sidebarKey).toBeFocused();
    }
    expect(player.errors).toEqual([]);
  });

  for (const area of ['artists', 'genres', 'folders'] as const) {
    test(`${scheme} ${area} 的窄窗抽屉保留外部点击区，关闭后恢复焦点`, async ({ page }) => {
      await prepare(page, scheme, 0);
      await page.setViewportSize({ width: 1280, height: 800 });
      const env =
        area === 'artists'
          ? await openArtists(page)
          : area === 'genres'
            ? await openGenres(page)
            : await openFolders(page);
      await page.setViewportSize({ width: 320, height: 800 });
      const label = area === 'artists' ? '艺人列表' : area === 'genres' ? '流派列表' : '目录';
      const trigger = env.view.getByRole('button', { name: label, exact: true });
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: label, exact: true });
      await expectOpaque(drawer, scheme);
      const box = await drawer.boundingBox();
      const host = await drawer.evaluate((node) => {
        const rect =
          node instanceof HTMLElement ? node.offsetParent?.getBoundingClientRect() : null;
        return rect ? { x: rect.x, right: rect.right } : null;
      });
      if (!box || !host) throw new Error('缺少抽屉定位容器');
      expect(box.x - host.x).toBeCloseTo(host.right - box.x - box.width, 1);
      expect(box.x).toBeGreaterThan(0);
      expect(box.x + box.width).toBeLessThan(320);
      await page.mouse.click(316, 200);
      await expect(drawer).not.toBeVisible();
      await trigger.click();
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(env.errors).toEqual([]);
    });
  }
}
