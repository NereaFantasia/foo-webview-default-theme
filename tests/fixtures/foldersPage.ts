import { expect, type Page } from '@playwright/test';
import { foldersAnswers } from './foldersLibrary.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

export async function openFolders(page: Page, configure?: (host: PageHost) => void) {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: foldersAnswers() });
  configure?.(host);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '文件夹', exact: true })
    .click();
  const view = page.locator('[data-page="folders"]:not([inert] *)');
  const tree = view.getByRole('tree', { name: '媒体库目录' });
  await expect(tree).toHaveAttribute('aria-busy', 'false');
  const root = tree.getByRole('treeitem').filter({ hasText: 'Music' });
  await root.getByRole('button', { name: '展开目录' }).click();
  await expect(tree.getByRole('treeitem').filter({ hasText: 'Alpha' })).toBeVisible();
  return {
    errors,
    host,
    view,
    tree,
    locate: () => view.getByRole('button', { name: '查找音乐所在目录' }).click(),
    box: view.getByRole('textbox', { name: '查找音乐所在目录' }),
    folder: (name: string) => tree.getByRole('treeitem').filter({ hasText: name }),
    grid: view.getByRole('treegrid', { name: '目录曲目' }),
  };
}
