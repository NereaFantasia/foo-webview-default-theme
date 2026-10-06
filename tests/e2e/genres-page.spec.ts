import { expect, test } from '@playwright/test';
import { GENRES_SORT } from '../../src/library/genres/genresGroups.ts';
import { openGenres } from '../fixtures/genresPage.ts';

test('多值分别归类，逗号单值保持完整；筛选、排序与整理提示可用', async ({ page }) => {
  const env = await openGenres(page);
  await expect(env.genre('Hip-Hop')).toContainText('4 首');
  await expect(env.genre('Trip-Hop')).toContainText('3 首');
  await expect(env.genre('Rock, Soul')).toContainText('1 首');
  await expect(env.genre('未填写流派')).toBeVisible();
  const sort = env.view.getByRole('combobox', { name: '流派排序' });
  await sort.click();
  await page.getByRole('option', { name: '曲目数', exact: true }).click();
  await expect(sort).toHaveText('曲目数');
  await expect(env.list.getByRole('row').nth(2)).toContainText('Hip-Hop');
  await sort.click();
  await page.getByRole('option', { name: '名称', exact: true }).click();
  await env.view.getByRole('button', { name: '降序' }).click();
  await expect(env.list.getByRole('row').last()).toContainText('未填写流派');
  await env.view.getByRole('textbox', { name: '筛选流派' }).fill('trip');
  await expect(env.list.getByRole('row')).toHaveCount(1);
  await env.view.getByRole('textbox', { name: '筛选流派' }).fill('');
  await env.view.getByRole('tab', { name: '需要整理' }).click();
  await expect(env.list.getByRole('row')).toHaveCount(1);
  await expect(env.genre('Rock, Soul')).toContainText('单个标签值包含多个流派');
  expect(env.errors).toEqual([]);
});

test('两层分组折叠以后按原查询行号起播，封面右键是专辑菜单', async ({ page }) => {
  const env = await openGenres(page);
  await env.view.getByRole('combobox', { name: '分组依据' }).click();
  await page.getByRole('option', { name: '专辑与碟号', exact: true }).click();
  await expect(env.grid.locator('[data-genre-group="第 1 碟"]')).toBeVisible();
  await env.grid.locator('[data-genre-group="第 1 碟"]').getByRole('button').click();
  await expect(
    env.grid.locator('[data-column-id="title"]').filter({ hasText: /^Workinonit$/ }),
  ).toHaveCount(0);
  await env.grid
    .locator('[data-column-id="title"]')
    .filter({ hasText: /^Feather$/ })
    .dblclick();
  await expect
    .poll(() => env.host.callsTo('playlist.playTrack'))
    .toEqual([expect.objectContaining({ index: 3 })]);
  expect(
    env.host
      .callsTo('library.query')
      .filter((call) => Array.isArray(call['fields']) && call['fields'].includes('path'))[0],
  ).toMatchObject({ query: 'genre IS "Hip-Hop"', sort: GENRES_SORT.albumDisc });
  expect(env.host.callsTo('library.addToPlaylist')).toHaveLength(1);
  expect(env.host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  await env.grid.getByRole('button', { name: '打开专辑：Donuts' }).click({ button: 'right' });
  await expect(page.locator('[data-album-menu]')).toBeVisible();
  await expect(page.locator('[data-menu-caption]')).toContainText('Donuts');
  expect(env.errors).toEqual([]);
});

test('右键多选只发送可见选择，随后右键未选项只作用于自己', async ({ page }) => {
  const env = await openGenres(page);
  await env.genre('Hip-Hop').click();
  await env.genre('Trip-Hop').click({ modifiers: ['Control'] });
  await env.genre('Trip-Hop').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '创建自动播放列表', exact: true }).click();
  await expect
    .poll(() => env.host.callsTo('playlist.createAutoplaylist'))
    .toEqual([expect.objectContaining({ query: '(genre IS "Hip-Hop") OR (genre IS "Trip-Hop")' })]);
  await env.genre('Rock, Soul').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '创建自动播放列表', exact: true }).click();
  await expect
    .poll(() => env.host.callsTo('playlist.createAutoplaylist').at(-1)?.['query'])
    .toBe('genre IS "Rock, Soul"');
  expect(env.errors).toEqual([]);
});

test('在歌曲页打开清掉旧筛选，后退恢复流派主体与分组折叠', async ({ page }) => {
  const env = await openGenres(page);
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '歌曲', exact: true })
    .click();
  const songs = page.locator('[data-page="songs"]');
  await songs.locator('input[data-query-input]').fill('old words');
  await expect(songs.locator('[data-songs-subtitle]')).toContainText('0 首');
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '流派', exact: true })
    .click();
  await env.genre('Trip-Hop').click();
  await expect(env.view.getByRole('heading', { level: 2 })).toHaveText('Trip-Hop');
  await env.view.getByRole('button', { name: '全部折叠' }).click();
  await env.view.getByRole('button', { name: '在歌曲页打开', exact: true }).click();
  await expect(songs.locator('input[data-query-input]')).toHaveValue('');
  await expect(songs.locator('[data-songs-condition="genre:Trip-Hop"]')).toBeVisible();
  await expect(songs.locator('[data-songs-subtitle]')).toContainText('3 首');
  await expect(page.locator('[data-page="genres"]')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.view.getByRole('heading', { level: 2 })).toHaveText('Trip-Hop');
  await expect(env.grid.locator('[data-column-id="title"][role="gridcell"]')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('未填写流派进入歌曲页是缺值查询，不能变成全库', async ({ page }) => {
  const env = await openGenres(page);
  await env.genre('未填写流派').click();
  await env.view.getByRole('button', { name: '在歌曲页打开', exact: true }).click();
  await expect(page.locator('[data-songs-subtitle]')).toContainText('1 首');
  expect(env.host.callsTo('library.query').at(-1)?.['query']).toBe('NOT genre PRESENT');
  expect(env.errors).toEqual([]);
});

test('筛掉左栏焦点后键盘菜单不能操作已隐藏的流派', async ({ page }) => {
  const env = await openGenres(page);
  await env.genre('Hip-Hop').click();
  await env.view.getByRole('textbox', { name: '筛选流派' }).fill('rock');
  await expect(env.list.getByRole('row')).toHaveCount(1);
  await env.list.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '创建自动播放列表', exact: true })).toHaveCount(
    0,
  );
  expect(env.errors).toEqual([]);
});

test('窄窗抽屉键盘选择后关闭，重开保留筛选和左栏焦点', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const env = await openGenres(page);
  await env.view.getByRole('button', { name: '流派列表', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '流派列表' });
  await drawer.getByRole('textbox', { name: '筛选流派' }).fill('hop');
  await drawer.getByRole('grid', { name: '流派' }).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(env.view.getByRole('heading', { level: 2 })).toHaveText('Trip-Hop');
  await expect(drawer).not.toBeVisible();
  await env.view.getByRole('button', { name: '流派列表', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: '筛选流派' })).toHaveValue('hop');
  await expect(drawer.locator('[data-genre-name="Trip-Hop"]')).toHaveAttribute(
    'data-focused',
    'true',
  );
  expect(env.errors).toEqual([]);
});

test('窄窗保留详情，拉宽再缩到 390 后往返仍能操作', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const env = await openGenres(page);
  await expect(env.grid).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(env.view.getByRole('heading', { level: 2 })).toHaveText('Hip-Hop');
  await env.genre('Trip-Hop').click();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(env.view.getByRole('heading', { level: 2 })).toHaveText('Trip-Hop');
  await env.view.getByRole('button', { name: '在歌曲页打开', exact: true }).click();
  await expect(page.locator('[data-songs-subtitle]')).toContainText('3 首');
  await expect(page.locator('[data-page="genres"]')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.view.getByRole('heading', { level: 2 })).toHaveText('Trip-Hop');
  expect(env.errors).toEqual([]);
});
