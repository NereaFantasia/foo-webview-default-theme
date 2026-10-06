import { expect, test, type Locator } from '@playwright/test';
import { openSongs } from '../fixtures/songsPage.ts';
import { openFolders } from '../fixtures/foldersPage.ts';

async function expectPlaceholderFits(input: Locator) {
  const size = await input.evaluate((element: HTMLInputElement) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('无法测量提示文字');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      text: context.measureText(element.placeholder).width,
      available:
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  });
  expect(size.text, JSON.stringify(size)).toBeLessThanOrEqual(size.available);
}

test('模式保留两份草稿，清词不清预设，Esc 先关菜单再清词', async ({ page }) => {
  const songs = await openSongs(page);
  const toggle = songs.view.locator('[data-query-mode-toggle]');
  await songs.box.fill('massive');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(songs.box).toHaveValue('');
  await songs.box.fill('genre IS "Trip-Hop"');
  await songs.box.press('Enter');
  await expect(songs.subtitle).toHaveText(/^4 首/);
  await toggle.click();
  await expect(songs.box).toHaveValue('massive');
  await songs.view.locator('[data-query-funnel]').click();
  const menu = page.locator('[data-query-menu]');
  await menu.locator('[data-query-option="lossless"]').click();
  await songs.box.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(songs.box).toHaveValue('massive');
  await songs.box.press('Escape');
  await expect(songs.box).toHaveValue('');
  await expect(songs.view.locator('[data-songs-condition="preset:lossless"]')).toBeVisible();
  await toggle.click();
  await expect(songs.box).toHaveValue('genre IS "Trip-Hop"');
  expect(songs.errors).toEqual([]);
});

test('普通输入不猜测语法，写入预设保留文字草稿并选中高级参数', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('? 100%');
  await expect(songs.view.locator('[data-query-mode-toggle]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('[data-query-menu]')).toHaveCount(0);
  await songs.view.locator('[data-query-funnel]').click();
  await page.locator('[data-query-option="format"]').click();
  await expect(songs.box).toHaveValue('%codec% IS flac');
  expect(
    await songs.box.evaluate((input: HTMLInputElement) =>
      input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
    ),
  ).toBe('flac');
  await songs.view.locator('[data-query-mode-toggle]').click();
  await expect(songs.box).toHaveValue('? 100%');
  expect(songs.errors).toEqual([]);
});

test('组词期间不请求、不执行回车或 Esc，结束组词才发布最终文字', async ({ page }) => {
  const songs = await openSongs(page);
  const before = songs.host.callsTo('library.query').length;
  await songs.box.focus();
  await songs.box.dispatchEvent('compositionstart', { data: '' });
  await songs.box.fill('mass');
  await songs.box.press('Enter');
  await songs.box.press('Escape');
  await expect(songs.box).toHaveValue('mass');
  await expect(songs.view.locator('[data-query-mode-toggle]')).toBeDisabled();
  // 超过查询去抖窗口仍不能发送组词中间态。
  await page.waitForTimeout(400);
  expect(songs.host.callsTo('library.query')).toHaveLength(before);
  await songs.box.fill('massive');
  await songs.box.dispatchEvent('compositionend', { data: 'massive' });
  await songs.box.press('Enter');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  expect(songs.host.callsTo('library.query').at(-1)?.query).toContain('HAS "massive"');
  expect(songs.errors).toEqual([]);
});

test('离开歌曲页再后退恢复模式和两份草稿', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('massive');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await songs.view.locator('[data-query-mode-toggle]').click();
  await songs.box.fill('genre IS "Trip-Hop"');
  await songs.box.press('Enter');
  await expect(songs.subtitle).toHaveText(/^4 首/);
  await songs.row('Teardrop').getByRole('button', { name: 'Mezzanine' }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(songs.box).toHaveValue('genre IS "Trip-Hop"');
  await expect(songs.view.locator('[data-query-mode-toggle]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await songs.view.locator('[data-query-mode-toggle]').click();
  await expect(songs.box).toHaveValue('massive');
  expect(songs.errors).toEqual([]);
});

test('文件夹使用同一模式切换与独立草稿，目录定位不受影响', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  const box = env.view.locator('input[data-query-input]');
  const toggle = env.view.locator('[data-query-mode-toggle]');
  await box.fill('Amber');
  await box.press('Enter');
  await expect
    .poll(() => env.host.callsTo('library.search').at(-1)?.query)
    .toContain('HAS "amber"');
  await toggle.click();
  await expect(box).toHaveValue('');
  await box.fill('title IS "Zebra"');
  await box.press('Enter');
  await expect
    .poll(() => env.host.callsTo('library.search').at(-1)?.query)
    .toBe('title IS "Zebra"');
  await toggle.click();
  await expect(box).toHaveValue('Amber');
  await env.locate();
  await expect(env.box).toHaveValue('');
  expect(env.errors).toEqual([]);
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme} 下查询控件高度固定，清空与条件计数不移动模式按钮`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const songs = await openSongs(page);
    await expectPlaceholderFits(songs.box);
    const toggle = songs.view.locator('[data-query-mode-toggle]');
    const before = await toggle.boundingBox();
    expect(before?.height).toBe(32);
    expect(before?.width).toBe(32);
    await songs.box.fill('massive');
    const typed = await toggle.boundingBox();
    expect(typed).toEqual(before);
    await songs.view.locator('[data-query-funnel]').click();
    await page.locator('[data-query-option="lossless"]').click();
    await songs.box.press('Escape');
    expect(await toggle.boundingBox()).toEqual(before);
    await songs.view.locator('[data-query-clear]').click();
    expect(await toggle.boundingBox()).toEqual(before);
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(toggle).toBeVisible();
    const narrow = await toggle.boundingBox();
    expect(narrow && narrow.x >= 0 && narrow.x + narrow.width <= 390).toBeTruthy();
    await expectPlaceholderFits(songs.box);
    await toggle.click();
    await expectPlaceholderFits(songs.box);
    expect(songs.errors).toEqual([]);
  });
}

test('文件夹默认占位提示在宽中窄窗口内完整显示', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  const input = env.view.locator('input[data-query-input]');
  await expect(input).toHaveAttribute('placeholder', '筛选曲目');
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expectPlaceholderFits(input);
  }
  expect(env.errors).toEqual([]);
});
