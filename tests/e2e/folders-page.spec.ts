import { expect, test } from '@playwright/test';
import { openFolders } from '../fixtures/foldersPage.ts';
import { FOLDER_TRACKS } from '../fixtures/foldersLibrary.ts';

test('Ctrl 逐项取消目录后可以保留空选择', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await env.folder('Beta').click({ modifiers: ['Control'] });
  await expect(env.tree.locator('[aria-selected="true"]')).toHaveCount(2);
  await env.folder('Alpha').click({ modifiers: ['Control'] });
  await expect(env.tree.locator('[aria-selected="true"]')).toHaveCount(1);
  await env.folder('Beta').click({ modifiers: ['Control'] });
  await expect(env.tree.locator('[aria-selected="true"]')).toHaveCount(0);
});
test('Ctrl 加选保留当前焦点与 Shift 锚，回车播放当前目录', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await env.folder('Beta').click({ modifiers: ['Control'] });
  await expect(env.tree.locator('[aria-selected="true"]')).toHaveCount(2);
  await expect(env.folder('Beta')).toHaveAttribute('data-focused', 'true');
  await env.tree.press('Enter');
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual([FOLDER_TRACKS[2]!.path]);
  await env.folder('Huge').click({ modifiers: ['Shift'] });
  await expect(env.folder('Alpha')).toHaveAttribute('aria-selected', 'false');
  await expect(env.folder('Beta')).toHaveAttribute('aria-selected', 'true');
  await expect(env.folder('Huge')).toHaveAttribute('aria-selected', 'true');
  expect(env.errors).toEqual([]);
});

test('浏览、列排序与起播使用当前顺序，节点切换进入历史', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.grid.getByRole('columnheader', { name: '标题', exact: true }).click();
  const titles = env.grid.locator('[role="gridcell"][data-column-id="title"]');
  await expect(titles).toHaveText(['Zebra', 'Amber']);
  await env.grid.getByText('Zebra', { exact: true }).dblclick();
  await expect.poll(() => env.host.callsTo('playlist.playTrack').at(-1)?.index).toBe(0);
  expect(env.host.callsTo('library.addToPlaylist').at(-1)?.paths).toEqual([
    FOLDER_TRACKS[0]!.path,
    FOLDER_TRACKS[1]!.path,
  ]);
  await env.folder('Beta').click();
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});
test('多选、右键对象、键盘展开与过滤恢复', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await env.folder('Beta').click({ modifiers: ['Control'] });
  await expect(env.tree.locator('[aria-selected="true"]')).toHaveCount(2);
  await env.folder('Alpha').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '已选 2 个目录', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '播放', exact: true }).click();
  await expect.poll(() => env.host.callsTo('playlist.playTrack').length).toBe(1);
  expect(env.host.callsTo('library.addToPlaylist').at(-1)?.paths).toHaveLength(3);
  await env.folder('Alpha').click();
  await env.tree.press('ArrowRight');
  await expect(env.folder('Disc')).toBeVisible();
  await env.locate();
  await env.box.fill('Blue');
  await env.box.press('Enter');
  await expect(env.folder('Beta')).toBeVisible();
  await expect(env.folder('Alpha')).toHaveCount(0);
  await env.box.press('Escape');
  await expect(env.folder('Disc')).toBeVisible();
  expect(env.errors).toEqual([]);
});
test('宽窄分栏与拖动，超限节点不伪装为空表', async ({ page }) => {
  const env = await openFolders(page);
  const splitter = env.view.getByRole('separator', { name: '调整目录树与曲目预览大小' });
  await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
  const before = await splitter.getAttribute('aria-valuenow');
  const box = await splitter.boundingBox();
  if (!box) throw new Error('分隔条未显示');
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + 40);
  await page.mouse.up();
  await expect(splitter).not.toHaveAttribute('aria-valuenow', before ?? '');
  await env.folder('Huge').click();
  await expect(env.view.getByText('所选内容超过 10000 首', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(splitter).toHaveCount(0);
  await env.view.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('tree', { name: '媒体库目录' })).toBeVisible();
  expect(
    env.host
      .callsTo('library.browseTree')
      .filter((call) => call.pathId === 'Huge' && call.includeFiles === true),
  ).toEqual([]);
  expect(env.errors).toEqual([]);
});
