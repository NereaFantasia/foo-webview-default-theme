import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import type { ConfigValue } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

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
  await expect(section(page, 'Jazz')).toContainText('4 张 · 8 首');
  await expect(album(page, 'Blue Train')).toContainText('John Coltrane');
  await expect(album(page, 'Blue Train')).toContainText('2 首');
  await expect(album(page, 'Blue Train')).toContainText('1957');
  await expect(album(page, 'Blue Train').locator('[data-list-cover]')).toBeVisible();
  await expect(page.locator('[data-album-subtitle]')).toContainText('8 张 · 16 首');
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

test('批量入口：页头键、节头右键菜单、Alt 与 Ctrl 单击节头、键盘', async ({ page }) => {
  await start(page);
  await tool(page, 'expand').click();
  await menuItem(page, 'collapse-albums').click();
  await expect(track(page, 'Blue Train 1')).toHaveCount(0);
  await expect(album(page, 'The Wall')).toHaveAttribute('aria-expanded', 'false');
  await tool(page, 'expand').click();
  await menuItem(page, 'expand-all').click();
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
  await expect(tool(page, 'sort')).toContainText('专辑名');
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

test('单击分组头空白选中整张；双击分组头从头播，双击曲目从那一首播；右键分三种菜单', async ({
  page,
}) => {
  const host = await start(page);
  await album(page, 'Blue Train').click({ position: { x: 600, y: 10 } });
  await expect(track(page, 'Blue Train 1')).toHaveAttribute('aria-selected', 'true');
  await expect(track(page, 'Blue Train 2')).toHaveAttribute('aria-selected', 'true');
  await expect(track(page, 'Kind of Blue 1')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('[data-album-subtitle]')).toContainText('已选 2 首');

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
