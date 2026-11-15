import { expect, test, type Page } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openSongs, type SongsPage } from '../fixtures/songsPage.ts';

// 歌曲页「按当前条件创建自动播放列表」的对话框：预填、命中数预览、能不能创建、右侧参考栏与补全、窄窗收成一个键

const dialog = (page: Page) => page.locator('[data-autoplaylist-dialog]');
const queryBox = (page: Page) => dialog(page).locator('[data-query-editor="query"] textarea');
const sortBox = (page: Page) => dialog(page).locator('[data-query-editor="sort"] textarea');
const preview = (page: Page) => dialog(page).locator('[data-autoplaylist-preview]');
const create = (page: Page) => dialog(page).locator('[data-autoplaylist-create]');

const CREATED = {
  success: true as const,
  index: 2,
  playlist: 2,
  guid: '{00000000-0000-0000-0000-000000000002}',
  name: '歌曲',
  query: 'ALL',
};

async function openDialog(page: Page): Promise<SongsPage> {
  const songs = await openSongs(page, {
    configure: (host) => {
      host.answer('playlist.createAutoplaylist', CREATED);
      host.answer('playlist.setActive', { success: true });
      host.answer('clipboard.write', { success: true });
    },
  });
  await songs.view.locator('[data-songs-more]').click();
  await page.locator('[data-action="autoplaylist"]').click();
  await expect(dialog(page)).toBeVisible();
  return songs;
}

test('预填此刻的查询与排序；数出命中数后才能创建，创建照框里的值，建成后对话框关闭', async ({
  page,
}) => {
  const songs = await openDialog(page);
  await expect(dialog(page).locator('[data-autoplaylist-name]')).toHaveValue('歌曲');
  await expect(queryBox(page)).toHaveValue('ALL');
  await expect(sortBox(page)).toHaveValue(/^%artist%/);
  await expect(preview(page)).toHaveText('命中 8 首');
  await expect(create(page)).toBeEnabled();

  await queryBox(page).fill('genre IS "Trip-Hop"');
  await expect(preview(page)).toHaveText('命中 4 首');
  await sortBox(page).fill('%title%');
  await dialog(page).locator('[data-autoplaylist-keep-sorted]').click();
  await create(page).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(songs.host.callsTo('playlist.createAutoplaylist')).toEqual([
    { name: '歌曲', query: 'genre IS "Trip-Hop"', sort: '%title%', keepSorted: true },
  ]);
  await expect.poll(() => songs.host.callsTo('playlist.setActive')).toHaveLength(1);
  expect(songs.errors).toEqual([]);
});

test('查询有误时预览条指出问题、创建键不可用，改对后恢复；创建失败时对话框留着并写明没创建成', async ({
  page,
}) => {
  const songs = await openDialog(page);
  await expect(preview(page)).toHaveText('命中 8 首');
  await queryBox(page).fill('%rating GREATER 3');
  await expect(preview(page)).toHaveAttribute('data-autoplaylist-preview', 'issue');
  await expect(create(page)).toBeDisabled();

  songs.host.answer('playlist.createAutoplaylist', hostFailure('OPERATION_FAILED'));
  await queryBox(page).fill('ALL');
  await expect(preview(page)).toHaveText('命中 8 首');
  await create(page).click();
  await expect(dialog(page).locator('[data-autoplaylist-failure]')).toHaveText('未能创建');
  await expect(dialog(page)).toBeVisible();

  songs.host.answer('playlist.createAutoplaylist', CREATED);
  await create(page).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

test('名称空白时不能创建；Ctrl+Enter 在编辑框里等于创建；Esc 先收补全再关对话框', async ({
  page,
}) => {
  const songs = await openDialog(page);
  await expect(create(page)).toBeEnabled();
  await dialog(page).locator('[data-autoplaylist-name]').fill('  ');
  await expect(create(page)).toBeDisabled();
  await dialog(page).locator('[data-autoplaylist-name]').fill('我的列表');
  await expect(create(page)).toBeEnabled();

  await queryBox(page).fill('');
  await queryBox(page).pressSequentially('%ra');
  await expect(page.locator('[data-syntax-completion]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-syntax-completion]')).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();

  await queryBox(page).fill('ALL');
  await expect(preview(page)).toHaveText('命中 8 首');
  await queryBox(page).press('Control+Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(songs.host.callsTo('playlist.createAutoplaylist')).toHaveLength(1);
  const [call] = songs.host.callsTo('playlist.createAutoplaylist');
  expect(call?.['name']).toBe('我的列表');
});

test('参考栏：点一行插到查询框光标处；焦点在排序框时只列字段与函数，补全在对话框里可用', async ({
  page,
}) => {
  await openDialog(page);
  const column = dialog(page).locator('[data-autoplaylist-reference]');
  await queryBox(page).fill('genre');
  await column.locator('[data-syntax-row="HAS"] > button').first().click();
  await expect(queryBox(page)).toHaveValue('genre HAS ""');
  await expect(queryBox(page)).toBeFocused();

  await sortBox(page).fill('');
  await expect(column.locator('[data-syntax-group="field"]')).toBeVisible();
  await expect(column.locator('[data-syntax-group="function"]')).toBeVisible();
  await expect(column.locator('[data-syntax-group="condition"]')).toHaveCount(0);
  await expect(column.locator('[data-syntax-group="sort"]')).toHaveCount(0);
  await column.locator('[data-syntax-row="%artist%"] > button').first().click();
  await expect(sortBox(page)).toHaveValue('%artist%');

  // 补全的浮层挂在对话框之外：模态框里它也要能看见、能用键盘接受
  await sortBox(page).fill('');
  await sortBox(page).pressSequentially('%ar');
  await expect(page.locator('[data-syntax-option="artist"]')).toBeVisible();
  await sortBox(page).press('Tab');
  await expect(sortBox(page)).toHaveValue('%artist%');
});

test('撤销与重做：接受补全与参考栏插入之后，Ctrl+Z 退回、Ctrl+Y 重做都接得上', async ({ page }) => {
  await openDialog(page);
  const column = dialog(page).locator('[data-autoplaylist-reference]');
  await sortBox(page).fill('');
  await sortBox(page).pressSequentially('%ar');
  await sortBox(page).press('Tab');
  await expect(sortBox(page)).toHaveValue('%artist%');
  await sortBox(page).press('Control+z');
  await expect(sortBox(page)).toHaveValue('%ar');
  await sortBox(page).press('Control+y');
  await expect(sortBox(page)).toHaveValue('%artist%');

  // 参考栏插入：焦点在排序框里点一行，落在光标处，撤销只退回这一下
  await column.locator('[data-syntax-row="%title%"] > button').first().click();
  await expect(sortBox(page)).toHaveValue('%artist%%title%');
  await sortBox(page).press('Control+z');
  await expect(sortBox(page)).toHaveValue('%artist%');
  await sortBox(page).press('Control+y');
  await expect(sortBox(page)).toHaveValue('%artist%%title%');

  await queryBox(page).fill('genre');
  await queryBox(page).press('End');
  await column.locator('[data-syntax-row="HAS"] > button').first().click();
  await expect(queryBox(page)).toHaveValue('genre HAS ""');
  await queryBox(page).press('Control+z');
  await expect(queryBox(page)).toHaveValue('genre');
});

test('复制键在各自标题的右边：查询与排序各复制各的文字，框空时置灰', async ({ page }) => {
  const songs = await openDialog(page);
  const copyQuery = dialog(page).locator('[data-autoplaylist-field="query"] [data-query-copy]');
  const copySort = dialog(page).locator('[data-autoplaylist-field="sort"] [data-query-copy]');
  await sortBox(page).fill('');
  await expect(copySort).toBeDisabled();
  await copyQuery.click();
  await expect.poll(() => songs.host.callsTo('clipboard.write').at(-1)).toEqual({ text: 'ALL' });
  await sortBox(page).fill('%title%');
  await expect(copySort).toBeEnabled();
  await copySort.click();
  await expect
    .poll(() => songs.host.callsTo('clipboard.write').at(-1))
    .toEqual({ text: '%title%' });
});

test('高度随内容长：查询折行，超过六行在框里滚，不撑开对话框', async ({ page }) => {
  await openDialog(page);
  const frame = dialog(page).locator('[data-query-editor="query"]');
  const height = () => frame.evaluate((element) => element.getBoundingClientRect().height);
  const lines = (count: number) =>
    Array.from({ length: count }, (_, at) => `title HAS "word${at}"`).join('\n');
  const short = await height();
  await queryBox(page).fill(lines(4));
  const four = await height();
  expect(four).toBeGreaterThan(short);
  await queryBox(page).fill(lines(12));
  const twelve = await height();
  // 六行加上下内边距与描边：再多的内容在框里滚，高度不再长
  const cap = await queryBox(page).evaluate((element) => {
    const style = getComputedStyle(element);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return 6 * parseFloat(style.lineHeight) + padding + 2;
  });
  expect(twelve).toBeGreaterThan(four);
  expect(twelve).toBeLessThanOrEqual(cap + 1);
  expect(twelve).toBeGreaterThan(cap - 4);
});

test('降序：查询里带 SORT DESCENDING BY 时只把条件部分交宿主数命中数，独立的排序留空才能创建', async ({
  page,
}) => {
  const songs = await openDialog(page);
  await sortBox(page).fill('');
  await queryBox(page).fill('ALL SORT DESCENDING BY %title%');
  await expect(preview(page)).toHaveText('命中 8 首');
  await expect(create(page)).toBeEnabled();
  expect(songs.host.callsTo('library.query').at(-1)).toMatchObject({ query: 'ALL' });

  // 排序框又写了内容：宿主以排序框为准，查询里的降序会被悄悄忽略，所以不放行
  await sortBox(page).fill('%artist%');
  await expect(preview(page)).toHaveAttribute('data-autoplaylist-preview', 'sortConflict');
  await expect(create(page)).toBeDisabled();
  await sortBox(page).fill('');
  await expect(create(page)).toBeEnabled();
  await create(page).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(songs.host.callsTo('playlist.createAutoplaylist')).toEqual([
    { name: '歌曲', query: 'ALL SORT DESCENDING BY %title%', sort: '', keepSorted: false },
  ]);
});

test('窄窗：参考栏收成查询标题右端的一个键，点开成弹出面板并能插入', async ({ page }) => {
  await openDialog(page);
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(dialog(page).locator('[data-autoplaylist-reference]')).toBeHidden();
  const button = dialog(page).locator('[data-autoplaylist-reference-button]');
  await expect(button).toBeVisible();
  await queryBox(page).fill('genre');
  await button.click();
  const panel = page.locator('[data-syntax-reference]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-syntax-row="HAS"] > button').first().click();
  await expect(queryBox(page)).toHaveValue('genre HAS ""');
});

test('筛选浮层页脚的「复制查询语句」把此刻的条件拼成的查询放进剪贴板', async ({ page }) => {
  const songs = await openSongs(page, {
    configure: (host) => host.answer('clipboard.write', { success: true }),
  });
  await songs.view.locator('[data-filter-toggle]').click();
  const copy = page.locator('[data-filter-copy-query]');
  await copy.click();
  await expect.poll(() => songs.host.callsTo('clipboard.write').at(-1)).toEqual({ text: 'ALL' });
  await page.locator('[data-preset-chips] [data-preset="lossless"]').click();
  await copy.click();
  await expect
    .poll(() => songs.host.callsTo('clipboard.write').at(-1))
    .toEqual({ text: expect.stringContaining('lossless') });
  expect(songs.errors).toEqual([]);
});
