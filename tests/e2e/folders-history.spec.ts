import { expect, test } from '@playwright/test';
import { openFolders } from '../fixtures/foldersPage.ts';
import { FOLDER_TRACKS, folderDirectory, foldersBrowseAnswer } from '../fixtures/foldersLibrary.ts';
import { trackRow } from '../fixtures/libraryRows.ts';

test('离开再后退恢复目录、展开、过滤与表格排序', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').getByRole('button', { name: '展开目录' }).click();
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await env.grid.getByRole('columnheader', { name: '标题', exact: true }).click();
  await env.locate();
  await env.box.fill('Amber');
  await env.box.press('Enter');
  await expect(env.folder('Disc')).toBeVisible();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true })
    .click();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.box).toHaveValue('Amber');
  await expect(env.grid.locator('[data-column-id="title"][role="gridcell"]')).toHaveText([
    'Zebra',
    'Amber',
  ]);
  await expect(env.folder('Disc')).toBeVisible();
  await env.box.press('Escape');
  await expect(env.folder('Beta')).toBeVisible();
  expect(env.errors).toEqual([]);
});
test('折叠移走隐藏焦点并保留预览，键入定位只移动焦点', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').getByRole('button', { name: '展开目录' }).click();
  await env.folder('Disc').click();
  await expect(env.view.getByRole('heading', { name: 'Disc', exact: true })).toBeVisible();
  await env.folder('Alpha').getByRole('button', { name: '折叠目录' }).click();
  await expect(env.folder('Disc')).toHaveCount(0);
  await expect(env.folder('Alpha')).toHaveAttribute('data-focused', 'true');
  await expect(env.view.getByRole('heading', { name: 'Disc', exact: true })).toBeVisible();
  await env.tree.press('b');
  await expect(env.folder('Beta')).toHaveAttribute('data-focused', 'true');
  await expect(env.view.getByRole('heading', { name: 'Disc', exact: true })).toBeVisible();
  await env.tree.press('Enter');
  await expect.poll(() => env.host.callsTo('playlist.playTrack').length).toBe(1);
  expect(env.host.callsTo('library.addToPlaylist').at(-1)?.paths).toEqual([
    'file://E:\\Music\\Beta\\Blue.flac',
  ]);
  expect(env.errors).toEqual([]);
});

test('历史目录已删除时，后续选择能覆盖旧快照', async ({ page }) => {
  const env = await openFolders(page);
  const albums = page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true });
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await albums.click();
  await expect(env.view).toHaveCount(0);
  env.host.answer('library.browseTree', (params) => {
    const answer = foldersBrowseAnswer(String(params.pathId ?? ''), params.includeFiles === true);
    return { ...answer, directories: answer.directories.filter((node) => node.pathId !== 'Alpha') };
  });
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.folder('Beta')).toBeVisible();
  await env.folder('Beta').click();
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await albums.click();
  await expect(env.view).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.view.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});
test('后退恢复多目录主体、当前范围筛选与组折叠', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await env.folder('Beta').click({ modifiers: ['Control'] });
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  const alpha = env.grid
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Alpha', exact: true }) });
  await alpha.getByRole('button', { name: '折叠目录', exact: true }).click();
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
  await expect(env.view.getByText('匹配 1 / 3 首', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true })
    .click();
  await expect(env.view).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(query).toHaveValue('Amber');
  await expect(env.view.getByRole('heading', { name: '已选 2 个目录' })).toBeVisible();
  await expect(alpha).toHaveAttribute('aria-expanded', 'false');
  await alpha.getByRole('button', { name: '展开目录', exact: true }).click();
  // 展开动画期间副本里也有一份文字；副本不带角色，按行定位只认真实条目。
  await expect(env.grid.getByRole('row').filter({ hasText: 'Amber' })).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('纯目录封面墙离开再后退恢复滚动位置', async ({ page }) => {
  const names = Array.from({ length: 40 }, (_, index) => `Album ${index + 1}`);
  const env = await openFolders(page, (host) => {
    host.answer('library.browseTree', (params) => {
      const pathId = String(params.pathId ?? '');
      const includeFiles = params.includeFiles === true;
      const answer = foldersBrowseAnswer(pathId, includeFiles);
      if (pathId) return answer;
      return {
        ...answer,
        directories: [...answer.directories, ...names.map((name) => folderDirectory(name))],
        files: includeFiles
          ? [...answer.files, ...names.map((name) => trackRow(name, 'Song'))]
          : [],
      };
    });
  });
  await env.folder('Music').click();
  await env.view.getByRole('button', { name: '封面', exact: true }).click();
  const card = env.view.getByRole('button', { name: '进入目录 Album 1', exact: true });
  await expect(card).toBeVisible();
  await expect(env.grid).toHaveCount(0);
  const scroller = card.locator('../../..');
  await scroller.evaluate((element) => {
    element.scrollTop = 700;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(700);
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true })
    .click();
  await expect(env.view).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(card).toBeAttached();
  await expect(env.grid).toHaveCount(0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(700);
  expect(env.errors).toEqual([]);
});
