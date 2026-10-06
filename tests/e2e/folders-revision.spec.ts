import { expect, test } from '@playwright/test';
import { openFolders } from '../fixtures/foldersPage.ts';
import { FOLDER_TRACKS, foldersBrowseAnswer } from '../fixtures/foldersLibrary.ts';

test('目录定位不改变右侧集合，范围筛选与折叠后的主播放作用完整结果', async ({ page }) => {
  const env = await openFolders(page);
  await expect(env.box).toHaveCount(0);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.locate();
  await env.box.fill('Blue');
  await env.box.press('Enter');
  await expect(env.view.getByText('找到 1 个目录')).toBeVisible();
  await expect(env.view.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.box.press('Escape');
  await env.box.press('Escape');
  await expect(env.box).toHaveCount(0);
  const disc = env.grid
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Disc', exact: true }) });
  await disc.getByRole('button', { name: '折叠目录', exact: true }).click();
  await expect(env.grid.getByText('Amber', { exact: true })).toHaveCount(0);
  await env.view.getByRole('button', { name: '播放', exact: true }).click();
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual(FOLDER_TRACKS.slice(0, 2).map((track) => track.path));
  env.host.answer('library.search', {
    success: true,
    tracks: [FOLDER_TRACKS[1]],
    total: 1,
    offset: 0,
    limit: 1000,
    hasMore: false,
  });
  const query = env.view.getByRole('combobox', { name: '筛选此目录中的曲目' });
  await query.fill('Amber');
  await query.press('Enter');
  await expect(env.view.getByText('匹配 1 / 2 首').first()).toBeVisible();
  await env.view.getByRole('button', { name: '播放结果', exact: true }).click();
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual([FOLDER_TRACKS[1]!.path]);
  expect(env.errors).toEqual([]);
});
test('封面、仅本层、密度和固定目录正常切换，叶目录不显示空封面墙', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await env.view.getByRole('button', { name: '固定目录', exact: true }).click();
  await expect(env.view.getByText('常用位置', { exact: true })).toBeVisible();
  await env.view.getByRole('button', { name: '封面', exact: true }).click();
  await expect(env.view.getByRole('button', { name: '进入目录 Disc', exact: true })).toBeVisible();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await env.view.getByRole('button', { name: '进入目录 Disc', exact: true }).click();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.view.getByRole('button', { name: '列表', exact: true }).click();
  await env.view.getByRole('combobox', { name: '密度', exact: true }).click();
  await expect(page.getByRole('option', { name: '标准', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('option', { name: '紧凑', exact: true }).click();
  const row = env.grid.getByRole('row').filter({ hasText: 'Amber' });
  await expect.poll(async () => (await row.boundingBox())?.height).toBe(32);
  await env.folder('Alpha').click();
  await env.view.getByRole('button', { name: '仅此目录', exact: true }).click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await expect(env.grid.getByText('Amber', { exact: true })).toHaveCount(0);
  await env.view.getByRole('button', { name: '含子目录', exact: true }).click();
  await env.folder('Music').click();
  await env.view.getByRole('button', { name: '封面', exact: true }).click();
  await expect(env.view.getByRole('button', { name: '进入目录 Alpha', exact: true })).toBeVisible();
  await expect(env.grid).toHaveCount(0);
  expect(env.errors).toEqual([]);
});
test('长目录名不压缩图标，390 窗口正文不产生横向溢出', async ({ page }) => {
  const long = '很长的目录名称用于验证图标不会随文字被挤压'.repeat(5);
  const env = await openFolders(page, (host) => {
    host.answer('library.browseTree', (params) => {
      const result = foldersBrowseAnswer(String(params.pathId ?? ''), params.includeFiles === true);
      return {
        ...result,
        directories: result.directories.map((node) =>
          node.pathId === 'Beta' ? { ...node, displayName: long } : node,
        ),
      };
    });
  });
  const node = env.folder(long);
  const icon = node.locator(':scope > svg');
  await expect.poll(async () => (await icon.boundingBox())?.width).toBe(20);
  await env.folder('Alpha').click();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(env.view.getByRole('separator')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await env.view.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('tree')).toBeVisible();
  expect(env.errors).toEqual([]);
});
test('列表显示封面、工具栏占满内容宽度，曲目选中不显示附加按钮条', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.preview-columns.tree.v1',
      JSON.stringify({ widths: [0, 24, 52, 2, 1, 88, 60], hidden: ['status', 'cover'] }),
    );
    localStorage.setItem('default-theme.folders.v1', JSON.stringify({ density: 'compact' }));
  });
  const env = await openFolders(page, (host) => {
    host.answer('artwork.getFb2kUrlByPath', {
      success: true,
      available: true,
      type: 'front',
      path: 'file://E:\\Music\\first.flac',
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=',
    });
  });
  await env.folder('Alpha').click();
  await expect(env.grid.locator('img')).toHaveCount(2);
  await expect
    .poll(() =>
      env.grid
        .locator('img')
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  const toolbar = env.view.getByRole('navigation', { name: '目录路径' });
  const left = await toolbar.boundingBox();
  const tree = await env.tree.boundingBox();
  expect(left!.x).toBeLessThan(tree!.x + 50);
  expect(left!.y).toBeLessThan(tree!.y);
  await env.grid.getByText('Zebra', { exact: true }).click();
  await expect(env.view.getByText(/^已选 \d+ 首$/)).toHaveCount(0);
  await expect(env.view.getByRole('button', { name: '播放所选' })).toHaveCount(0);
  await env.grid.getByText('Zebra', { exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '播放', exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});
