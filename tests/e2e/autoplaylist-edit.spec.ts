import { expect, test, type Page } from '@playwright/test';
import { hostFailure, stringParam } from '../fixtures/hostAnswers.ts';
import type { PageHost } from '../fixtures/pageHost.ts';
import { openPlaylist, type PlaylistPage } from '../fixtures/playlistPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';

// 播放列表页的「编辑自动播放列表」：页头的键只有自动播放列表才有；读得到规则开编辑对话框，读不到只给自带编辑器；
// 保存是先解除再套新规则，套不上就用旧规则转回去

const dialog = (page: Page) => page.locator('[data-autoplaylist-dialog]');
const queryBox = (page: Page) => dialog(page).locator('[data-query-editor="query"] textarea');
const sortBox = (page: Page) => dialog(page).locator('[data-query-editor="sort"] textarea');
const preview = (page: Page) => dialog(page).locator('[data-autoplaylist-preview]');
const save = (page: Page) => dialog(page).locator('[data-autoplaylist-create]');

const OLD = { query: 'genre IS Jazz', sort: '%title%', keepSorted: false };

/** 宿主按 `rules` 答 Smart 这张列表的规则；`library.query` 只认不含 `((` 的查询 */
function answerSmart(
  host: PageHost,
  guid: string,
  rules: { query: string | null; sort: string | null },
): void {
  host.answer('playlist.getAutoplaylistQuery', {
    success: true,
    isAutoplaylist: true,
    playlist: 2,
    playlistGuid: guid,
    query: rules.query,
    sort: rules.sort,
    keepSorted: false,
    source: 'sdk',
  });
  host.answer('library.query', (params) =>
    stringParam(params, 'query').includes('((')
      ? hostFailure('INVALID_PARAMS')
      : { success: true, tracks: [], total: 4 },
  );
  host.answer('playlist.convertToAutoplaylist', {
    success: true,
    playlist: 2,
    playlistGuid: guid,
  });
  host.answer('playlist.showAutoplaylistUI', {
    success: true,
    accepted: true,
    operationId: 'op',
    playlistGuid: guid,
  });
}

/** 打开 Smart 这张自动播放列表的页，宿主按 `rules` 答规则 */
async function openSmart(
  page: Page,
  rules: { query: string | null; sort: string | null } = OLD,
): Promise<PlaylistPage> {
  const env = await openPlaylist(page, 'Smart');
  answerSmart(env.host, env.guid, rules);
  return env;
}

const conversions = (env: PlaylistPage) =>
  env.host.callsTo('playlist.convertToAutoplaylist').map((call) => ({
    query: call['query'],
    sort: call['sort'] ?? '',
    keepSorted: call['keepSorted'] ?? false,
  }));

test('页头的编辑键只有自动播放列表才有', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix');
  await expect(env.view.locator('[data-playlist-edit-auto]')).toHaveCount(0);
  await env.entry('Smart').click();
  await expect(env.view.locator('[data-playlist-edit-auto]')).toBeVisible();
});

test('侧边栏的右键菜单在别的页面上也能开编辑对话框，只有自动播放列表有这一项', async ({ page }) => {
  const env = await openSidebar(page);
  answerSmart(env.host, env.lists.guid('Smart'), OLD);
  await expect(env.albumsPage).toBeVisible();
  const menu = page.getByRole('menu', { name: '播放列表菜单' });
  const edit = menu.getByRole('menuitem', { name: '编辑自动播放列表' });

  await env.entry('Chill').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: '清空' })).toBeVisible();
  await expect(edit).toHaveCount(0);
  await page.keyboard.press('Escape');

  await env.entry('Smart').click({ button: 'right' });
  await edit.click();
  await expect(queryBox(page)).toHaveValue(OLD.query);
  await dialog(page).getByRole('button', { name: '取消' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(env.entry('Smart')).toBeFocused();
  await expect(env.albumsPage).toBeVisible();
  await expect(env.playlistPage('Smart')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('编辑：预填读到的规则，改了查询、宿主数出命中数后保存；先解除再套新规则，保存途中列表暂时是普通列表也不关对话框', async ({
  page,
}) => {
  const env = await openSmart(page);
  await env.view.locator('[data-playlist-edit-auto]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-autoplaylist-name]')).toHaveCount(0);
  await expect(queryBox(page)).toHaveValue(OLD.query);
  await expect(sortBox(page)).toHaveValue(OLD.sort);
  await expect(preview(page)).toHaveText('命中 4 首');
  await expect(save(page)).toBeDisabled();

  await queryBox(page).fill('genre IS Rock SORT DESCENDING BY %date%');
  await sortBox(page).fill('');
  await expect(preview(page)).toHaveText('命中 4 首');
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(dialog(page)).toHaveCount(0);
  // 读规则的次数不定（打开时读一次、保存前现读一次），解除一定在最后一次现读之后、转换之前
  const methods = env.host.calls
    .map((call) => call.method)
    .filter((method) => /utoplaylist/.test(method));
  expect(methods.slice(-3)).toEqual([
    'playlist.getAutoplaylistQuery',
    'playlist.removeAutoplaylist',
    'playlist.convertToAutoplaylist',
  ]);
  expect(methods.filter((method) => method !== 'playlist.getAutoplaylistQuery')).toEqual([
    'playlist.removeAutoplaylist',
    'playlist.convertToAutoplaylist',
  ]);
  expect(conversions(env)).toEqual([
    { query: 'genre IS Rock SORT DESCENDING BY %date%', sort: '', keepSorted: false },
  ]);
  expect(env.errors).toEqual([]);
});

test('新查询宿主认不出：预览写查询有误、保存键不可用，列表一点没动', async ({ page }) => {
  const env = await openSmart(page);
  await env.view.locator('[data-playlist-edit-auto]').click();
  await queryBox(page).fill('((');
  await expect(preview(page)).not.toHaveAttribute('data-autoplaylist-preview', 'count');
  await expect(save(page)).toBeDisabled();
  expect(env.host.callsTo('playlist.removeAutoplaylist')).toEqual([]);
});

test('套新规则失败：用旧规则转回去，对话框留着并写明规则未改动', async ({ page }) => {
  const env = await openSmart(page);
  const answers = [
    hostFailure('OPERATION_FAILED'),
    { success: true as const, playlist: 2, playlistGuid: env.guid },
  ];
  env.host.answer(
    'playlist.convertToAutoplaylist',
    () => answers.shift() ?? hostFailure('OPERATION_FAILED'),
  );
  await env.view.locator('[data-playlist-edit-auto]').click();
  await queryBox(page).fill('genre IS Rock');
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(dialog(page).locator('[data-autoplaylist-failure="failed"]')).toHaveText(
    '未能保存，规则未改动',
  );
  await expect(dialog(page)).toBeVisible();
  expect(conversions(env)).toEqual([
    { query: 'genre IS Rock', sort: OLD.sort, keepSorted: false },
    OLD,
  ]);
});

test('旧规则也转不回去：写明这张列表现在是普通播放列表', async ({ page }) => {
  const env = await openSmart(page);
  env.host.answer('playlist.convertToAutoplaylist', hostFailure('OPERATION_FAILED'));
  await env.view.locator('[data-playlist-edit-auto]').click();
  await queryBox(page).fill('genre IS Rock');
  await save(page).click();
  await expect(dialog(page).locator('[data-autoplaylist-failure="lost"]')).toHaveText(
    '未能保存，这张列表现在是普通播放列表',
  );
});

test('对话框里的「打开原生智能列表属性」关掉自绘对话框并请宿主打开原生编辑器', async ({ page }) => {
  const env = await openSmart(page);
  await env.view.locator('[data-playlist-edit-auto]').click();
  await dialog(page).locator('[data-autoplaylist-native]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(() => env.host.callsTo('playlist.showAutoplaylistUI'))
    .toEqual([{ playlistGuid: env.guid }]);
});

test('读不到规则的列表（第三方提供者等）：不开编辑，只给自带编辑器，不碰列表', async ({ page }) => {
  const env = await openSmart(page, { query: null, sort: null });
  await env.view.locator('[data-playlist-edit-auto]').click();
  const unreadable = page.locator('[data-autoplaylist-unreadable]');
  await expect(unreadable).toContainText('无法读取这张列表的规则');
  await expect(dialog(page)).toHaveCount(0);
  await unreadable.locator('[data-autoplaylist-native]').click();
  await expect
    .poll(() => env.host.callsTo('playlist.showAutoplaylistUI'))
    .toEqual([{ playlistGuid: env.guid }]);
  expect(env.host.callsTo('playlist.removeAutoplaylist')).toEqual([]);
});
