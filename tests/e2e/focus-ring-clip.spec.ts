import { expect, test } from '@playwright/test';
import { menuClips, tabClips } from '../fixtures/focusRingClip.ts';
import { openFolders } from '../fixtures/foldersPage.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { openRightCardPage } from '../fixtures/rightCardPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';
import { openSongs } from '../fixtures/songsPage.ts';

test.use({ screenshot: 'off' });

// 断言键盘焦点环不被裁切型祖先（滚动区、截断行、列头）截断：Fluent 缺省把焦点环画在控件外 2px，
// 控件贴近裁切线时会被截去一部分。断言对象是焦点环与裁切线的几何关系，几何本身是被测行为

test('歌曲页：各菜单逐项移动时焦点环完整；按 Tab 依次经过列头与工具栏时同样完整', async ({
  page,
}) => {
  const { view, errors } = await openSongs(page);
  expect(await menuClips(page, view)).toEqual([]);
  expect(await tabClips(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('文件夹页：排序菜单与路径行的焦点环完整', async ({ page }) => {
  const { view } = await openFolders(page);
  expect(await menuClips(page, view)).toEqual([]);
  expect(await tabClips(page)).toEqual([]);
});

test('设置页：滚动区边缘处的键盘焦点环完整', async ({ page }) => {
  await openSidebar(page);
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  expect(await tabClips(page)).toEqual([]);
});

for (const card of ['queue', 'lyrics', 'info'] as const) {
  test(`右侧卡 ${card} 页：焦点环完整`, async ({ page }) => {
    await openPlayer(page);
    await openRightCardPage(page, card);
    expect(await tabClips(page)).toEqual([]);
  });
}

test('自动播放列表对话框：表单里开关的焦点环完整', async ({ page }) => {
  const { view } = await openSongs(page);
  await view.locator('[data-songs-more]').click();
  await page.locator('[data-action="autoplaylist"]').click();
  await expect(page.locator('[data-autoplaylist-dialog]')).toBeVisible();
  expect(await tabClips(page, 20)).toEqual([]);
});
