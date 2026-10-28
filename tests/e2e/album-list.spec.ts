import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import type { ConfigValue } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';
import { DEFAULT_WIDTHS, DEFAULT_ORDER } from '../../src/table/columns/columns.ts';

// 专辑页的列表形态：两层开合与落盘、批量入口（页头键、节头右键、修饰键、键盘）、排序切换、进详情页、
// 单击分组头选中整张、三种右键菜单与起播。替身里每张专辑两首，流派分 Jazz 与 Rock 两节。

const COLLAPSED = 'defaultTheme.browser.collapsed';
const LIST = { 'defaultTheme.browser.form': 'list', 'defaultTheme.browser.dimension': 'genre' };

const table = (page: Page) => page.getByRole('treegrid', { name: '专辑列表' });
const section = (page: Page, name: string) =>
  table(page).locator(`[role="row"]:has([data-list-section="${name}"])`);
const album = (page: Page, name: string) =>
  table(page).locator(`[role="row"]:has([data-list-album="${name}"])`);
const track = (page: Page, title: string) =>
  table(page).getByRole('row', { name: new RegExp(`^${title}\\b|\\b${title}\\b`) });
const tool = (page: Page, name: string) => page.locator(`[data-album-tool="${name}"]`);
const menuItem = (page: Page, action: string) =>
  page.locator(`[role="menu"] [data-action="${action}"]`);
const albumOrder = (page: Page) =>
  table(page)
    .locator('[data-list-album]')
    .evaluateAll((heads) => heads.map((head) => head.getAttribute('data-list-album') ?? ''));

let errors: string[] = [];

async function start(page: Page, config: Record<string, ConfigValue> = {}): Promise<PageHost> {
  errors = collectPageErrors(page);
  const host = await installPageHost(page, {
    answers: libraryAnswers(SAMPLE_ALBUMS),
    config: { ...LIST, ...config },
  });
  // 列表是虚拟滚动，视口外的专辑不画。视口要放得下替身里全部专辑展开后的高度，用例按名字找行时才不必先滚过去。
  await page.setViewportSize({ width: 1280, height: 2000 });
  await page.goto('/');
  await expect(track(page, 'Blue Train 1')).toBeVisible();
  return host;
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('节、专辑分组头与曲目行；节头写张数与首数，分组头写首数与年份，展开的专辑挂封面', async ({
  page,
}) => {
  await start(page);
  await expect(section(page, 'Jazz')).toContainText('4 张');
  await expect(section(page, 'Jazz')).toContainText('8 首');
  await expect(album(page, 'Blue Train')).toContainText('John Coltrane');
  await expect(album(page, 'Blue Train')).toContainText('2 首');
  await expect(album(page, 'Blue Train')).toContainText('1957');
  await expect(album(page, 'Blue Train').locator('[data-list-cover]')).toBeVisible();
  await expect(page.locator('[data-album-subtitle]')).toContainText('8 张');
  await expect(page.locator('[data-album-subtitle]')).toContainText('16 首');
});

test('单击节头折叠这一节并落盘，重新载入后还折着；专辑的开合键只开合这一张', async ({ page }) => {
  const host = await start(page);
  await section(page, 'Rock').click();
  await expect(section(page, 'Rock')).toHaveAttribute('aria-expanded', 'false');
  await expect(album(page, 'Abbey Road')).toHaveCount(0);
  await album(page, 'Blue Train').getByRole('button', { name: '折叠' }).click();
  await expect(album(page, 'Blue Train')).toHaveAttribute('aria-expanded', 'false');
  await expect(track(page, 'Blue Train 1')).toHaveCount(0);
  await expect(track(page, 'Kind of Blue 1')).toBeVisible();
  await expect
    .poll(() => host.config.get(COLLAPSED))
    .toMatchObject({
      list: { genre: ['Rock'] },
      listAlbums: { collapsedByDefault: false, except: ['Blue Train\0John Coltrane'] },
    });

  await page.reload();
  await expect(section(page, 'Rock')).toHaveAttribute('aria-expanded', 'false');
  await expect(album(page, 'Blue Train')).toHaveAttribute('aria-expanded', 'false');
  await expect(track(page, 'Kind of Blue 1')).toBeVisible();
});

test('批量入口：视图面板、节头右键菜单、Alt 与 Ctrl 单击节头、键盘', async ({ page }) => {
  await start(page);
  await tool(page, 'view').click();
  await page.locator('[data-action="collapse-albums"]').click();
  await page.keyboard.press('Escape');
  await expect(track(page, 'Blue Train 1')).toHaveCount(0);
  await expect(album(page, 'The Wall')).toHaveAttribute('aria-expanded', 'false');
  await tool(page, 'view').click();
  await page.locator('[data-action="expand-all"]').click();
  await page.keyboard.press('Escape');
  await expect(track(page, 'The Wall 1')).toBeVisible();

  await section(page, 'Jazz').click({ button: 'right' });
  await menuItem(page, 'only-section').click();
  await expect(section(page, 'Rock')).toHaveAttribute('aria-expanded', 'false');
  await expect(section(page, 'Jazz')).toHaveAttribute('aria-expanded', 'true');

  await section(page, 'Jazz').click({ modifiers: ['Alt'] });
  await expect(section(page, 'Jazz')).toHaveAttribute('aria-expanded', 'false');
  await section(page, 'Jazz').click({ modifiers: ['Alt'] });
  await expect(album(page, 'Moanin')).toHaveAttribute('aria-expanded', 'true');
  await section(page, 'Jazz').click({ modifiers: ['Control'] });
  await expect(section(page, 'Rock')).toHaveAttribute('aria-expanded', 'false');
  await expect(section(page, 'Jazz')).toHaveAttribute('aria-expanded', 'false');

  await section(page, 'Jazz').click();
  await album(page, 'Blue Train').click({ position: { x: 600, y: 10 } });
  await page.keyboard.press('ArrowLeft');
  await expect(album(page, 'Blue Train')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(album(page, 'Blue Train')).toHaveAttribute('aria-expanded', 'true');
  await album(page, 'Moanin').getByRole('button', { name: '折叠' }).click();
  await page.keyboard.press('*');
  await expect(album(page, 'Moanin')).toHaveAttribute('aria-expanded', 'true');
});

test('排序：换字段与方向即时重排并落盘；随机每点一次换种子；没装 foo_playcount 时播放统计置灰', async ({
  page,
}) => {
  const host = await start(page);
  expect(await albumOrder(page)).toEqual([
    'Moanin',
    'Somethin Else',
    'Blue Train',
    'Kind of Blue',
    'Led Zeppelin IV',
    'The Wall',
    'Abbey Road',
    'Revolver',
  ]);
  await tool(page, 'sort').click();
  await page.locator('[data-sort-field="name"]').click();
  await tool(page, 'sort').click();
  await page.getByRole('menuitemradio', { name: '降序' }).click();
  await expect
    .poll(() => albumOrder(page))
    .toEqual([
      'Somethin Else',
      'Moanin',
      'Kind of Blue',
      'Blue Train',
      'The Wall',
      'Revolver',
      'Led Zeppelin IV',
      'Abbey Road',
    ]);
  await expect(tool(page, 'sort')).toHaveText('排序');
  await expect
    .poll(() => host.config.get('defaultTheme.browser.listSort'))
    .toEqual({ field: 'name', descending: true });

  await tool(page, 'sort').click();
  await expect(page.locator('[data-sort-field="playCount"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('menu')).toContainText('需要 foo_playcount');
  await page.locator('[data-sort-field="random"]').click();
  await expect.poll(() => host.config.get('defaultTheme.browser.listShuffleSeed')).toBeDefined();
  const seed = host.config.get('defaultTheme.browser.listShuffleSeed');
  await tool(page, 'sort').click();
  await page.locator('[data-sort-field="random"]').click();
  await expect.poll(() => host.config.get('defaultTheme.browser.listShuffleSeed')).not.toBe(seed);
});

test('单击封面或专辑名进详情页，后退回到列表形态', async ({ page }) => {
  await start(page);
  await album(page, 'Kind of Blue').locator('[data-list-cover]').click();
  await expect(page.locator('[data-page="albums"]')).toHaveCount(0);
  await expect(page.getByText('Kind of Blue', { exact: false }).first()).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(track(page, 'Blue Train 1')).toBeVisible();
  await album(page, 'Moanin').locator('[data-list-album-name]').click();
  await expect(page.locator('[data-page="albums"]')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme}：列头排序保留专辑分组，播放与落盘跟随组内次序`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const host = await start(page);
    const before = await albumOrder(page);
    const header = table(page).getByRole('columnheader', { name: '标题', exact: true });
    const titles = () =>
      table(page)
        .locator('[role="row"][aria-selected]')
        .evaluateAll((rows) => rows.map((row) => row.textContent ?? ''));
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(await albumOrder(page)).toEqual(before);
    const ordered = await titles();
    expect(ordered.findIndex((text) => text.includes('Blue Train 2'))).toBeLessThan(
      ordered.findIndex((text) => text.includes('Blue Train 1')),
    );
    await track(page, 'Blue Train 1').dblclick();
    await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
    expect(host.callsTo('playlist.playTrack')[0]).toMatchObject({ index: 1 });
    const added = host.callsTo('library.addToPlaylist').at(-1)?.['paths'];
    expect(added).toEqual([
      expect.stringContaining('Blue Train 2'),
      expect.stringContaining('Blue Train 1'),
    ]);
    await expect
      .poll(() => host.config.get('defaultTheme.browser.listTrackSort'))
      .toEqual({
        column: 'title',
        descending: true,
      });
    await page.reload();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await header.getByRole('button', { name: '标题', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
  });
}

test('统计批次含受限路径时成功行仍能排序，提示部分失败并能重试', async ({ page }) => {
  const host = await start(page, {
    'defaultTheme.browser.listTrackSort': { column: 'playCount', descending: false },
  });
  host.answer('config.getComponents', {
    success: true,
    count: 1,
    components: [{ name: 'Playback Statistics', filename: 'foo_playcount', version: '3.1.5' }],
  });
  let denied = true;
  host.answer('titleformat.evalBatch', (params) => {
    const paths: unknown = params['paths'];
    const list = Array.isArray(paths) ? paths.map(String) : [];
    if (denied && list.some((path) => path.includes('The Wall 1')))
      return hostFailure('PERMISSION_DENIED');
    const results = list.map((path) => ({
      path,
      success: true,
      infoAvailable: true,
      result: `|||${path.includes('Blue Train 1') ? 10 : 2}`,
    }));
    return {
      success: true,
      pattern: String(params['pattern']),
      total: results.length,
      successCount: results.length,
      errorCount: 0,
      results,
    };
  });
  await page.reload();
  const notice = page.locator('[data-album-notice="stats"]');
  await expect(notice).toContainText('部分曲目的播放统计未能读取');
  await track(page, 'Blue Train 1').dblclick();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  expect(host.callsTo('playlist.playTrack')[0]).toMatchObject({ index: 1 });
  denied = false;
  await notice.getByRole('button', { name: '重试', exact: true }).click();
  await expect(notice).toHaveCount(0);
});

test('hook 刷新只重取变化曲目的统计，不整库重拉；非 hook 的修改照拉', async ({ page }) => {
  const host = await start(page, {
    'defaultTheme.browser.listTrackSort': { column: 'playCount', descending: false },
  });
  host.answer('config.getComponents', {
    success: true,
    count: 1,
    components: [{ name: 'Playback Statistics', filename: 'foo_playcount', version: '3.1.5' }],
  });
  // 升序下 Blue Train 2(2) 排在 Blue Train 1(10) 前；hook 把 Blue Train 2 抬成 99 后次序翻过来。
  let boosted = false;
  host.answer('titleformat.evalBatch', (params) => {
    const paths: unknown = params['paths'];
    const list = Array.isArray(paths) ? paths.map(String) : [];
    const results = list.map((path) => ({
      path,
      success: true,
      infoAvailable: true,
      result: `|||${
        path.includes('Blue Train 2') && boosted ? 99 : path.includes('Blue Train 1') ? 10 : 2
      }`,
    }));
    return {
      success: true,
      pattern: String(params['pattern']),
      total: results.length,
      successCount: results.length,
      errorCount: 0,
      results,
    };
  });
  await page.reload();
  const orderOf = async (first: string, second: string) => {
    const texts = await table(page)
      .locator('[role="row"][aria-selected]')
      .evaluateAll((rows) => rows.map((row) => row.textContent ?? ''));
    return [
      texts.findIndex((text) => text.includes(first)),
      texts.findIndex((text) => text.includes(second)),
    ] as const;
  };
  await expect
    .poll(async () => {
      const [one, two] = await orderOf('Blue Train 1', 'Blue Train 2');
      return one >= 0 && two >= 0 && two < one;
    })
    .toBe(true);
  const beforeLibrary = host.callsTo('library.getAll').length;
  const beforeEval = host.callsTo('titleformat.evalBatch').length;
  boosted = true;
  await host.emit('library:itemsModified', {
    count: 1,
    handles: ['E:\\Music\\Blue Train\\Blue Train 2.flac'],
    truncated: false,
    fromHook: true,
    timestamp: 1,
  });
  await expect
    .poll(async () => {
      const [one, two] = await orderOf('Blue Train 1', 'Blue Train 2');
      return one < two;
    })
    .toBe(true);
  expect(host.callsTo('library.getAll')).toHaveLength(beforeLibrary);
  const evalCalls = host.callsTo('titleformat.evalBatch');
  expect(evalCalls).toHaveLength(beforeEval + 1);
  expect(evalCalls.at(-1)?.['paths']).toEqual(['E:\\Music\\Blue Train\\Blue Train 2.flac']);
  await host.emit('library:itemsModified', {
    count: 1,
    handles: ['E:\\Music\\Blue Train\\Blue Train 1.flac'],
    truncated: false,
    fromHook: false,
    timestamp: 2,
  });
  await expect.poll(() => host.callsTo('library.getAll').length).toBe(beforeLibrary + 1);
});

test('单击分组头空白选中整张；双击分组头从头播，双击曲目从那一首播；右键分三种菜单', async ({
  page,
}) => {
  const host = await start(page);
  await album(page, 'Blue Train').click({ position: { x: 600, y: 10 } });
  await expect(track(page, 'Blue Train 1')).toHaveAttribute('aria-selected', 'true');
  await expect(track(page, 'Blue Train 2')).toHaveAttribute('aria-selected', 'true');
  await expect(track(page, 'Kind of Blue 1')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('[data-selection-count]')).toHaveText('已选 2 首');

  await album(page, 'Kind of Blue').dblclick({ position: { x: 600, y: 10 } });
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  expect(host.callsTo('playlist.playTrack')[0]).toMatchObject({ index: 0 });
  await track(page, 'Moanin 2').dblclick();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(2);
  expect(host.callsTo('playlist.playTrack')[1]).toMatchObject({ index: 1 });

  await track(page, 'Blue Train 1').click({ button: 'right' });
  await expect(page.locator('[data-track-menu]')).toContainText('Blue Train 1');
  await page.keyboard.press('Escape');
  await album(page, 'The Wall').locator('[data-list-cover]').click({ button: 'right' });
  await expect(page.locator('[data-album-menu]')).toContainText('打开专辑详情');
  await page.keyboard.press('Escape');
  await section(page, 'Rock').click({ button: 'right' });
  await expect(page.locator('[data-list-section-menu]')).toContainText('只展开本节');
  await page.keyboard.press('Escape');
});

test('写评分失败时右下角出轻提示，关掉后提示清掉', async ({ page }) => {
  const host = await start(page);
  host.answer('rating.set', { success: false, error: 'failed', code: 'OPERATION_FAILED' });
  await track(page, 'Blue Train 1').getByRole('radio', { name: '4' }).click();
  const toast = page.locator('[data-app-toast="rating"]');
  await expect(toast).toContainText('评分保存失败');
  await toast.getByText('关闭').click();
  await expect(toast).toHaveCount(0);
});

test('横向滚动离开页面后从历史返回，恢复原来的水平位置', async ({ page }) => {
  await page.addInitScript(
    ({ widths, order }) => {
      localStorage.setItem(
        'default-theme.album-list-columns.v2',
        JSON.stringify({
          unit: 'px',
          widths,
          order,
          hidden: ['status'],
        }),
      );
    },
    { widths: DEFAULT_WIDTHS.map((width, at) => (at === 3 ? 1600 : width)), order: DEFAULT_ORDER },
  );
  await start(page);
  const bar = table(page).locator('[data-table-horizontal]');
  await bar.evaluate((element) => {
    element.scrollLeft = 350;
  });
  await expect.poll(() => bar.evaluate((element) => element.scrollLeft)).toBe(350);
  await enterSettings(page);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(table(page)).toBeVisible();
  await expect.poll(() => bar.evaluate((element) => element.scrollLeft)).toBe(350);
});
