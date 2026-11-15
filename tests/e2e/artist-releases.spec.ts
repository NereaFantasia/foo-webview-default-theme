import { expect, test, type Page } from '@playwright/test';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';
import { collectPageErrors } from '../fixtures/pageHost.ts';

// 在线艺人页的专辑在在线结果试验页里跑：一位艺人 30 张专辑，各种类与版本类别都有，每页 20 张
// `albums=bare` 上游不给种类与曲数，`albums=empty` 没有专辑，`albums=fail`、`albums=failmore` 首页与第二页第一次答限流
// 艺人页是单栏：专辑、热门歌曲、单曲与 EP、合集、参与依次排下去，每节只露前几行，超出的进那一节的专用页（专辑墙页），
// 查找、排序与筛选只在专用页里

// 视口收窄到一行放不下 7 列，正文那 15 张一定超出两行，合集与参与的不会
test.use({ screenshot: 'off', viewport: { width: 1000, height: 800 } });

const listPage = (page: Page) => page.locator('[data-page="onlineList"]');
const section = (page: Page, key: string) =>
  listPage(page).locator(`[data-artist-section="${key}"]`);
const tiles = (page: Page, key: string) => section(page, key).locator('[data-online-tile]');
const requests = async (page: Page) =>
  (await onlineLog(page)).flatMap((entry) =>
    typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === 'artist-albums'
      ? [Reflect.get(entry, 'cursor')]
      : [],
  );
const wallPage = (page: Page) => page.locator('[data-page="onlineAlbums"]');
const wallTiles = (page: Page) => wallPage(page).locator('[data-online-tile]');
const open = async (page: Page, query: Readonly<Record<string, string>> = {}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'artist:3000', ...query });
  await expect(listPage(page).getByRole('heading', { name: 'Nujabes' })).toBeVisible();
};
/** 点概览里那一节的节头，进它的专用页；节头只有超出预览行数时才是按钮 */
const openWall = async (page: Page, key: string, title: string) => {
  await section(page, key)
    .getByRole('button', { name: `查看全部${title}` })
    .click();
  await expect(wallPage(page)).toBeVisible();
};
const back = (page: Page) =>
  page.evaluate(() => {
    const go: unknown = Reflect.get(window, '__onlineBack');
    if (typeof go === 'function') go();
  });

test('单栏骨架：没有页签，各节按专辑、热门歌曲、单曲与 EP、合集、参与排下去；超出两行的节头是进专用页的按钮', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await open(page);
  await expect(listPage(page).getByRole('tab')).toHaveCount(0);
  await expect(section(page, 'albums').getByRole('button', { name: '查看全部专辑' })).toBeVisible();
  const order = await listPage(page)
    .locator('[data-artist-section], [data-online-artist-songs]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-artist-section') ?? 'songs'),
    );
  expect(order).toEqual(['albums', 'songs', 'singles', 'compilations', 'featured']);
  // 正文超出两行；合集与参与的专辑放得下，节头只是标题
  expect(await tiles(page, 'albums').count()).toBeLessThan(15);
  await expect(tiles(page, 'compilations')).toHaveCount(2);
  await expect(tiles(page, 'featured')).toHaveCount(3);
  await expect(section(page, 'compilations').getByRole('heading', { name: '合集' })).toBeVisible();
  await expect(
    section(page, 'featured').getByRole('heading', { name: '参与的专辑' }),
  ).toBeVisible();
  await expect(section(page, 'compilations').locator('[data-artist-releases-open]')).toHaveCount(0);
  await expect(section(page, 'featured').locator('[data-artist-releases-open]')).toHaveCount(0);
  // 概览里没有查找、排序与筛选：它们在专用页里
  await expect(listPage(page).locator('[data-detail-tools]')).toHaveCount(0);
  // 按发行时间新到旧：最近的是 2024 年的 Album 01；图块第二行写年份，参与的写第一署名
  await expect(tiles(page, 'albums').first()).toContainText('Album 01');
  await expect(tiles(page, 'albums').first()).toContainText('2024');
  await expect(tiles(page, 'featured').first()).toContainText('Shing02');
  await expect(tiles(page, 'featured').first()).toContainText('2019');
  expect(await requests(page)).toEqual([null, '20']);
  expect(errors).toEqual([]);
});

test('单曲与 EP 专页：图块右端写种类；版本筛选勾了出角标与条件片，清除后回到全部', async ({
  page,
}) => {
  // 窄一些，十张单曲两行放不下，节头才是进专用页的按钮
  await page.setViewportSize({ width: 760, height: 800 });
  await open(page);
  await openWall(page, 'singles', '单曲与 EP');
  await expect(wallPage(page).getByRole('heading', { name: '单曲与 EP' })).toBeVisible();
  await expect(wallTiles(page)).toHaveCount(10);
  await expect(wallTiles(page).first()).toContainText(/单曲|EP/);
  await expect(wallPage(page).locator('[data-facet-conditions]')).toHaveCount(0);

  await wallPage(page).locator('[data-filter-toggle]').click();
  const menu = page.locator('[data-scroll-menu]');
  await expect(menu).toBeVisible();
  // 筛选是下拉菜单：类型两项（单曲、EP）加版本四项（录音室、Remix、伴奏、DEMO），选项旁写张数
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(6);
  await menu.getByRole('menuitemcheckbox', { name: /Remix/ }).click();
  await expect(wallTiles(page)).toHaveCount(1);
  await expect(wallPage(page).locator('[data-filter-toggle]')).toContainText('1');
  // 勾选后菜单不关，可以接着勾；Esc 关掉再看条件行
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(wallPage(page).locator('[data-facet-conditions]')).toContainText('Remix');

  await wallPage(page)
    .locator('[data-facet-conditions]')
    .getByRole('button', { name: '清除筛选' })
    .click();
  await expect(wallTiles(page)).toHaveCount(10);
  await expect(wallPage(page).locator('[data-facet-conditions]')).toHaveCount(0);
});

test('单曲与 EP 专页的「类型」栏：勾了 EP 只留 EP，版本栏只数 EP 里的，没有 EP 的版本不列', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 800 });
  await open(page);
  await openWall(page, 'singles', '单曲与 EP');
  await wallPage(page).locator('[data-filter-toggle]').click();
  const menu = page.locator('[data-scroll-menu]');
  await expect(menu.locator('[data-facet-option="kind:single"]')).toContainText('单曲');
  await expect(menu.locator('[data-facet-option="kind:ep"]')).toContainText('EP');
  await menu.locator('[data-facet-option="kind:ep"]').click();
  await expect(wallTiles(page)).toHaveCount(4);
  await expect(menu.getByRole('menuitemcheckbox', { name: /Remix/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitemcheckbox', { name: /录音室/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(wallPage(page).locator('[data-facet-conditions]')).toContainText('EP');
  await expect(wallTiles(page).first()).toContainText('EP');
  await expect(wallPage(page).locator('[data-filter-toggle]')).toContainText('1');
  await wallPage(page)
    .locator('[data-facet-conditions]')
    .getByRole('button', { name: '清除筛选' })
    .click();
  await expect(wallTiles(page)).toHaveCount(10);
});

test('专辑专页的查找与排序：查找「live」留下两张现场，名称排序后可翻转方向；后退回概览', async ({
  page,
}) => {
  await open(page);
  await openWall(page, 'albums', '专辑');
  // 专用页只有这一节：合集与参与的专辑不在里面
  await expect(wallPage(page).getByRole('heading', { name: '专辑' })).toBeVisible();
  await wallPage(page).locator('[data-detail-find-toggle]').click();
  await wallPage(page).locator('[data-detail-find]').fill('live');
  await expect(wallTiles(page)).toHaveCount(2);
  await wallPage(page).locator('[data-detail-find]').fill('不存在');
  await expect(wallPage(page).locator('[data-artist-releases-empty]')).toHaveText('没有匹配的专辑');
  await wallPage(page).locator('[data-detail-find]').fill('');

  await wallPage(page).locator('[data-detail-sort-toggle]').click();
  await wallPage(page).locator('[data-detail-sort-field]').click();
  await page.getByRole('menuitemradio', { name: '名称' }).click();
  await expect(wallTiles(page).first()).toContainText('Album 01');
  await wallPage(page).locator('[data-detail-sort-direction]').click();
  await expect(wallTiles(page).first()).toContainText('Live 2');

  await back(page);
  await expect(section(page, 'albums')).toBeVisible();
});

test('上游没给种类与曲数时只有「专辑」一节，平铺成一个按日期排的列表，专用页里没有版本筛选', async ({
  page,
}) => {
  await open(page, { albums: 'bare' });
  await expect(listPage(page).locator('[data-artist-section]')).toHaveCount(1);
  await expect(tiles(page, 'albums').first()).toContainText('2024');
  // 概览只露两行，整张墙在专辑墙页里
  expect(await tiles(page, 'albums').count()).toBeLessThan(30);
  await openWall(page, 'albums', '专辑');
  await expect(wallTiles(page)).toHaveCount(30);
  await expect(wallTiles(page).first()).toContainText('2024');
  await expect(wallPage(page).locator('[data-filter-toggle]')).toHaveCount(0);
});

test('没有专辑的艺人只剩热门歌曲：不出专辑各节', async ({ page }) => {
  await open(page, { albums: 'empty' });
  await expect(listPage(page).locator('[data-online-artist-songs]')).toBeVisible();
  await expect(listPage(page).locator('[data-artist-section]')).toHaveCount(0);
});

test('首页没取到时在专辑的位置写原因，重试再取', async ({ page }) => {
  await open(page, { albums: 'fail' });
  await expect(listPage(page).getByText('无法读取艺人专辑')).toBeVisible();
  await expect(listPage(page).getByText('网易云提示请求过于频繁')).toBeVisible();
  // 热门歌曲不受影响
  await expect(listPage(page).locator('[data-online-artist-songs]')).toBeVisible();
  await listPage(page).getByRole('button', { name: '重试' }).click();
  // 概览只露两行：取回了，也不会铺满正文那 15 张
  await expect(tiles(page, 'albums').first()).toBeVisible();
  expect(await tiles(page, 'albums').count()).toBeLessThan(15);
});

test('后面的页失败时专辑专页保留已取到的，重试接着取', async ({ page }) => {
  // 第一页里正文只有 10 张：窗口收窄，两行放不下，节头才是进专用页的按钮
  await page.setViewportSize({ width: 760, height: 800 });
  await open(page, { albums: 'failmore' });
  await expect(tiles(page, 'albums').first()).toBeVisible();
  await openWall(page, 'albums', '专辑');
  const more = wallPage(page).locator('[data-artist-releases-more]');
  await expect(more.first()).toHaveAttribute('data-artist-releases-more', 'retry');
  const shown = await wallTiles(page).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(20);
  await more.first().click();
  await expect(more).toHaveCount(0);
  await expect(wallTiles(page)).toHaveCount(15);
  expect(await requests(page)).toEqual([null, '20', '20']);
});

test('单击专辑图块进那张专辑的列表页，后退回来仍在艺人页', async ({ page }) => {
  await open(page);
  await tiles(page, 'albums').first().click();
  await expect(listPage(page).getByRole('heading', { name: 'Modal Soul' })).toBeVisible();
  await back(page);
  await expect(listPage(page).getByRole('heading', { name: 'Nujabes' })).toBeVisible();
  await expect(tiles(page, 'albums').first()).toBeVisible();
});

const albumSearches = async (page: Page) =>
  (await onlineLog(page)).flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    Reflect.get(entry, 'kind') === 'artist-album-search'
      ? [Reflect.get(entry, 'query')]
      : [],
  );

test('专辑取不完时，专页里查找停手后联网搜没取到的专辑，署名里没有这位艺人的同名专辑不进来', async ({
  page,
}) => {
  // 第一页里正文只有 10 张：窗口收窄，两行放不下，节头才是进专用页的按钮
  await page.setViewportSize({ width: 760, height: 800 });
  await open(page, { albums: 'hang' });
  await openWall(page, 'albums', '专辑');
  await expect(wallTiles(page).first()).toBeVisible();
  await wallPage(page).locator('[data-detail-find-toggle]').click();
  await wallPage(page).locator('[data-detail-find]').fill('album 12');
  await expect(wallTiles(page)).toHaveCount(1);
  await expect(wallTiles(page).first()).toContainText('Album 12');
  await expect(wallPage(page).locator('[data-artist-releases-empty]')).toHaveCount(0);
  expect(await albumSearches(page)).toEqual(['Nujabes album 12']);
});

test('专辑取完的艺人，专页里查找只在本地筛，不联网', async ({ page }) => {
  await open(page);
  await openWall(page, 'albums', '专辑');
  await wallPage(page).locator('[data-detail-find-toggle]').click();
  await wallPage(page).locator('[data-detail-find]').fill('album 12');
  await expect(wallTiles(page)).toHaveCount(1);
  // 防抖 400 毫秒：等它过去，确认没有联网搜索发出
  await page.waitForTimeout(800);
  expect(await albumSearches(page)).toEqual([]);
});

test('专辑很多时概览只露两行；进专辑墙页只画视口里的图块，滚动到底一页一页续取，到底后写总数', async ({
  page,
}) => {
  await open(page, { albums: 'many' });
  const entry = section(page, 'albums').locator('[data-artist-releases-open]');
  await expect(entry).toBeVisible();
  expect(await tiles(page, 'albums').count()).toBeLessThanOrEqual(10);
  // 概览不续取，自动取到 1000 张就停下
  await expect.poll(() => requests(page)).toEqual([null, '200', '400', '600', '800']);

  await entry.click();
  await expect(wallPage(page)).toBeVisible();
  await expect(wallPage(page).getByRole('heading', { name: '专辑' })).toBeVisible();
  const items = wallPage(page).getByRole('listitem');
  await expect(items.first()).toHaveAttribute('aria-setsize', '1000');
  expect(await items.count()).toBeLessThan(150);
  await expect(wallPage(page).locator('[data-album-wall-count]')).toHaveText('已加载 1000 张');
  const scroller = wallPage(page).locator('[data-detail-scroller]');
  await expect
    .poll(async () => {
      await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      return items.first().getAttribute('aria-setsize');
    })
    .toBe('1500');
  expect(await items.count()).toBeLessThan(150);
  expect(await requests(page)).toEqual([null, '200', '400', '600', '800', '1000', '1200', '1400']);
  await expect(wallPage(page).locator('[data-album-wall-count]')).toHaveText('共 1500 张');

  // 后退回到概览
  await back(page);
  await expect(entry).toBeVisible();
});

test('专辑墙页有查找时不自动续取，末尾留「加载更多」', async ({ page }) => {
  await open(page, { albums: 'many' });
  await expect.poll(() => requests(page)).toEqual([null, '200', '400', '600', '800']);
  await openWall(page, 'albums', '专辑');
  await wallPage(page).locator('[data-detail-find-toggle]').click();
  await wallPage(page).locator('[data-detail-find]').fill('Many 00');
  await expect(wallTiles(page).first()).toContainText('Many 0001');
  const more = wallPage(page).locator('[data-artist-releases-more="more"]');
  await expect(more).toHaveText('加载更多');
  // 不会自动续取：等一会儿，请求没有增加
  await page.waitForTimeout(500);
  expect(await requests(page)).toEqual([null, '200', '400', '600', '800']);
  await more.click();
  await expect.poll(() => requests(page)).toEqual([null, '200', '400', '600', '800', '1000']);
});

test('取的过程中末尾只有一个转圈的按钮，不写字', async ({ page }) => {
  // 第一页里正文只有 10 张：窗口再收窄一些，两行放不下，节头才是进专辑墙页的按钮
  await page.setViewportSize({ width: 760, height: 800 });
  await open(page, { albums: 'hang' });
  await openWall(page, 'albums', '专辑');
  const loading = wallPage(page).locator('[data-artist-releases-more="loading"]');
  await expect(loading).toBeVisible();
  await expect(loading).toHaveText('');
  await expect(loading).toHaveAttribute('aria-label', '加载中');
});
