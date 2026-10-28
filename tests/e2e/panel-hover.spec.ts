import { expect, test, type Page } from '@playwright/test';
import { SEARCH_HISTORY_KEY } from '../../src/library/search/searchHistory.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

test.use({ screenshot: 'off' });

async function openShell(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript((width) => {
    localStorage.setItem('default-theme.sidebar.v1', JSON.stringify({ hidden: true }));
    localStorage.setItem('default-theme.right-card.v1', JSON.stringify({ open: false }));
    if (width === 600) localStorage.setItem('default-theme.player-bar.v1', 'titlebar');
  }, width);
  const errors = collectPageErrors(page);
  await installPageHost(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  return errors;
}

test('完全收起的侧栏悬停预览不占宽、不抢焦点；移入后保持，离开后关闭', async ({ page }) => {
  const errors = await openShell(page);
  const key = page.locator('[data-sidebar-key]');
  const panel = page.locator('[data-sidebar-overlay]');
  await key.focus();
  await key.hover();
  await expect(panel).toBeVisible();
  await expect(key).toBeFocused();
  await expect(page.locator('[data-sidebar]')).toHaveAttribute('data-sidebar', 'none');
  await panel.hover();
  await page.waitForTimeout(650);
  await expect(panel).toBeVisible();
  await page.mouse.move(640, 790);
  await expect(panel).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('default-theme.sidebar.v1') ?? '{}')),
    )
    .toMatchObject({ hidden: true });
  expect(errors).toEqual([]);
});

test('侧栏预览可用Esc关闭，点击入口恢复停靠', async ({ page }) => {
  await openShell(page);
  const key = page.locator('[data-sidebar-key]');
  const panel = page.locator('[data-sidebar-overlay]');
  await key.hover();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.mouse.move(640, 790);
  await key.hover();
  await expect(panel).toBeVisible();
  await key.click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-sidebar]')).toHaveAttribute('data-sidebar', 'expanded');
});

test('极窄侧栏点击保留悬停浮窗，中窄图标栏不误触预览', async ({ page }) => {
  await openShell(page, 600);
  const key = page.locator('[data-sidebar-key]');
  const panel = page.locator('[data-sidebar-overlay]');
  await key.hover();
  await expect(panel).toBeVisible();
  await key.click();
  await page.mouse.move(300, 790);
  await page.waitForTimeout(650);
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 800 });
  await key.hover();
  await page.waitForTimeout(450);
  await expect(panel).toHaveCount(0);
});

test('侧栏预览里打开搜索下拉，点下拉里的范围页签不收侧栏、下拉不位移', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('default-theme.sidebar.v1', JSON.stringify({ hidden: true }));
    localStorage.setItem('default-theme.right-card.v1', JSON.stringify({ open: false }));
  });
  const errors = collectPageErrors(page);
  await installPageHost(page, { config: { [SEARCH_HISTORY_KEY]: ['Nujabes', 'Feather'] } });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  const panel = page.locator('[data-sidebar-overlay]');
  await page.locator('[data-sidebar-key]').hover();
  await expect(panel).toBeVisible();
  await panel.locator('[data-search-input="sidebar"]').click();
  const flyout = page.locator('[data-search-flyout]');
  await expect(flyout).not.toHaveAttribute('inert');
  const position = () => flyout.evaluate((node) => [node.style.left, node.style.top]);
  const before = await position();
  // 下拉挂在侧栏之外：点它不算点在侧栏外，指针与焦点移过去也不让悬停预览收起
  await flyout.getByRole('tab', { name: '在线音乐' }).click();
  await expect(flyout.getByRole('tab', { name: '在线音乐' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.waitForTimeout(800);
  await expect(panel).toBeVisible();
  expect(await position()).toEqual(before);
  expect(errors).toEqual([]);
});

for (const width of [1280, 600]) {
  test(`${width}px右侧队列与歌词悬停预览，点击后保留，外部点击关闭浮窗`, async ({ page }) => {
    const errors = await openShell(page, width);
    const key = page.locator('[data-right-card-key="queue"]');
    const lyrics = page.locator('[data-right-card-key="lyrics"]');
    const panel = page.locator('[data-form="overlay"]');
    await key.focus();
    await key.hover();
    await expect(panel).toBeVisible();
    await expect(key).toBeFocused();
    await expect(page.locator('[data-form="docked"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.mouse.move(width / 2, 790);
    await key.hover();
    await expect(panel).toBeVisible();
    await panel.hover();
    await page.waitForTimeout(650);
    await expect(panel).toBeVisible();
    await lyrics.hover();
    await expect(panel.locator('[data-lyrics-preview]')).toBeVisible();
    await page.mouse.click(width / 2, 790);
    await expect(panel).toHaveCount(0);
    await key.hover();
    await expect(panel).toBeVisible();
    await key.click();
    await page.mouse.move(width / 2, 790);
    await page.waitForTimeout(650);
    await expect(
      page.locator(`[data-form="${width === 1280 ? 'docked' : 'overlay'}"]`),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('掠过或触摸入口不打开；右侧预览中的键盘焦点阻止离开关闭', async ({ page }) => {
  await openShell(page);
  const key = page.locator('[data-right-card-key="queue"]');
  const panel = page.locator('[data-form="overlay"]');
  await key.hover();
  await page.mouse.move(640, 790);
  await page.waitForTimeout(450);
  await expect(panel).toHaveCount(0);
  await key.dispatchEvent('pointerover', { pointerType: 'touch', buttons: 0 });
  await page.waitForTimeout(450);
  await expect(panel).toHaveCount(0);
  await key.hover();
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: '队列', exact: true }).focus();
  await page.mouse.move(640, 790);
  await page.waitForTimeout(650);
  await expect(panel).toBeVisible();
  await key.focus();
  await expect(panel).toHaveCount(0);
});
