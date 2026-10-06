import { expect, test, type Page } from '@playwright/test';
import type { AlbumInfo } from 'foo-webview-sdk';
import {
  albumsAnswer,
  libraryAnswers,
  manyAlbums,
  SAMPLE_ALBUMS,
} from '../fixtures/albumLibrary.ts';
import { RESTORE_WINDOW_MS } from '../../src/kit/scrollRestore.ts';
import type { ConfigValue } from '../fixtures/hostAnswers.ts';
import { albumTrackRow } from '../fixtures/libraryRows.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

// 专辑页的状态：形态切走再切回来、离开再从历史回来、重新载入之后，各自该留下的都还在。

const tiles = (page: Page) => page.locator('[data-album-tile]');
const tile = (page: Page, name: string) => tiles(page).filter({ hasText: name });
const grid = (page: Page) => page.locator('[data-album-wall]');
const filter = (page: Page) => page.locator('input[data-album-filter]');
const scrollTop = (page: Page) => grid(page).evaluate((element) => element.scrollTop);
const detailTitle = (page: Page) => page.locator('[data-page="album"] h1');
const COLLAPSED = 'defaultTheme.browser.collapsed';

let errors: string[] = [];

async function start(
  page: Page,
  albums: readonly AlbumInfo[] = manyAlbums(300),
  config: Record<string, ConfigValue> = {},
): Promise<PageHost> {
  errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: libraryAnswers(albums), config });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();
  return host;
}

/** 等滚动停下（连着两次隔一帧读到同一个值），答停下的位置。 */
async function settledScrollTop(page: Page): Promise<number> {
  await expect
    .poll(() =>
      grid(page).evaluate(
        (element) =>
          new Promise<boolean>((resolve) => {
            const before = element.scrollTop;
            setTimeout(() => resolve(element.scrollTop === before), 100);
          }),
      ),
    )
    .toBe(true);
  return scrollTop(page);
}

/** 滚到 `top`，等虚拟滚动把那一段的图块画出来。 */
async function scrollTo(page: Page, top: number): Promise<void> {
  await grid(page).evaluate((element, value) => element.scrollTo({ top: value }), top);
  await expect.poll(() => scrollTop(page)).toBe(top);
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('切到列表形态再切回来：滚动、焦点、筛选词都还在，形态记进 config', async ({ page }) => {
  const host = await start(page);
  await filter(page).fill('001');
  await expect(tiles(page).first()).toContainText('Album 00001');
  await scrollTo(page, 1200);
  const focused = tiles(page).nth(8);
  const name = (await focused.locator('span').first().textContent()) ?? '';
  // 点中的那块若不在视口里，点击会先把它滚进来；单击还会展开它的下拉，放不下时视口跟着展开滚。
  // 以滚完之后的位置为准。
  await focused.click();
  const top = await settledScrollTop(page);
  expect(top).toBeGreaterThan(0);

  await page.locator('[data-album-form="list"]').click();
  await expect(page.locator('[data-album-list]')).toBeVisible();
  await expect.poll(() => host.config.get('defaultTheme.browser.form')).toBe('list');
  await page.locator('[data-album-form="wall"]').click();

  await expect.poll(() => scrollTop(page)).toBe(top);
  await expect(filter(page)).toHaveValue('001');
  const active = await grid(page).getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).toContainText(name);
  await expect(page.locator('[data-album-dropdown]')).toContainText(name);
  expect(host.config.get('defaultTheme.browser.form')).toBe('wall');
});

/**
 * 在封面墙滚到最低处，切到列表形态，其间库里少了大半专辑，再切回来：记下的位置落不下了，
 * 交还后停在能滚到的最低处，挂着等条目流再变。答宿主替身与那时的最低处。
 */
async function returnBeyondContent(page: Page): Promise<{ host: PageHost; bottom: number }> {
  const host = await start(page);
  const lowest = () =>
    grid(page).evaluate((element) => element.scrollHeight - element.clientHeight);
  await scrollTo(page, await lowest());
  await page.locator('[data-album-form="list"]').click();
  await expect(page.locator('[data-album-list]')).toBeVisible();
  // 离开封面墙期间库里少了大半专辑，记下的位置落不下了。
  host.answer('library.getAlbums', albumsAnswer(manyAlbums(60)));
  await host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
  await expect(page.locator('[data-album-subtitle]')).toContainText('60 张');
  await page.locator('[data-album-form="wall"]').click();
  await expect(tiles(page).first()).toBeVisible();
  await expect.poll(async () => (await scrollTop(page)) === (await lowest())).toBe(true);
  return { host, bottom: await scrollTop(page) };
}

/**
 * 挂着的交还最迟在 RESTORE_WINDOW_MS 之后作罢：在这整段时间里逐帧看滚动位置，答见过的最高与最低。
 */
function watchScroll(page: Page): Promise<{ readonly low: number; readonly high: number }> {
  return grid(page).evaluate(
    (element, ms) =>
      new Promise<{ low: number; high: number }>((resolve) => {
        let low = element.scrollTop;
        let high = element.scrollTop;
        const end = performance.now() + ms;
        const frame = () => {
          low = Math.min(low, element.scrollTop);
          high = Math.max(high, element.scrollTop);
          if (performance.now() < end) requestAnimationFrame(frame);
          else resolve({ low, high });
        };
        requestAnimationFrame(frame);
      }),
    RESTORE_WINDOW_MS + 300,
  );
}

test('切回来时记下的滚动位置已超出内容：停在最低处，之后自己往上滚不被拉回', async ({ page }) => {
  await returnBeyondContent(page);
  await grid(page).evaluate((element) => element.scrollTo({ top: 0 }));
  await expect.poll(() => scrollTop(page)).toBe(0);
  // 其间悬停换图块，让封面墙重渲染几次。
  const watched = watchScroll(page);
  await tiles(page).first().hover();
  await tiles(page).nth(1).hover();
  expect((await watched).high).toBe(0);
});

test('切回来时位置超出内容，不滚而是按 Shift + 滚轮放大封面换了列：视口锚在顶上那一行，不被拉回旧位置', async ({
  page,
}) => {
  const { bottom } = await returnBeyondContent(page);
  const width = () =>
    tiles(page)
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);
  const before = await width();
  // 挂起只挂 RESTORE_WINDOW_MS：在页面里当场连转几格，赶在期限之内。
  const watched = watchScroll(page);
  await grid(page).evaluate((element) => {
    for (let notch = 0; notch < 6; notch += 1) {
      element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }),
      );
    }
  });
  await expect.poll(width).toBeGreaterThan(before);
  // 放大后一行少几块、内容变高，记下的位置（大库的最低处）远在新的最低处之下：挂着的交还要是又设了一次，
  // 视图就停在新的最低处。换列时视口锚在顶上那一行，停在新的最低处之上。
  const lowest = await grid(page).evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  );
  expect(lowest).toBeGreaterThan(bottom);
  expect((await watched).high).toBeLessThan(lowest - 1);
});

test('折叠一节写进 config，重新载入后还折着', async ({ page }) => {
  const host = await start(page, SAMPLE_ALBUMS, { 'defaultTheme.browser.dimension': 'genre' });
  const rock = page.locator('[data-section-head]').filter({ hasText: 'Rock' });
  await expect(rock).toHaveAttribute('aria-expanded', 'true');
  // 网格的行里只放单元格：节头按钮包在一格里，这一格横跨整行（1280 宽时一行五块）。
  const cell = rock.locator('xpath=..');
  await expect(cell).toHaveAttribute('role', 'gridcell');
  await expect(cell).toHaveAttribute('aria-colspan', '5');
  await expect(cell.locator('xpath=..')).toHaveAttribute('role', 'row');
  await rock.click();
  await expect(rock).toHaveAttribute('aria-expanded', 'false');
  await expect(tile(page, 'Abbey Road')).toHaveCount(0);
  await expect.poll(() => host.config.get(COLLAPSED)).toEqual({ wall: { genre: ['Rock'] } });

  await page.reload();
  await expect(tile(page, 'Blue Train')).toBeVisible();
  await expect(rock).toHaveAttribute('aria-expanded', 'false');
  await expect(tile(page, 'Abbey Road')).toHaveCount(0);
});

test('离开专辑页再从历史回来：筛选词、滚动与焦点交还', async ({ page }) => {
  await start(page);
  await filter(page).fill('002');
  await expect(tiles(page).first()).toContainText('Album 00002');
  await scrollTo(page, 800);
  const focused = tiles(page).nth(8);
  const name = (await focused.locator('span').first().textContent()) ?? '';
  await focused.click({ button: 'right' });
  const top = await scrollTop(page);
  expect(top).toBeGreaterThan(0);
  await page.locator('[data-album-menu] [data-action="open-detail"]').click();
  await expect(detailTitle(page)).toHaveText(name);
  await page.keyboard.press('Alt+ArrowLeft');

  await expect(filter(page)).toHaveValue('002');
  await expect.poll(() => scrollTop(page)).toBe(top);
  const active = await grid(page).getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).toContainText(name);
});

test('离开时过滤无匹配，回来清掉过滤词：停在顶上，不跳回更早记下的位置', async ({ page }) => {
  await start(page);
  await scrollTo(page, 1200);
  await tiles(page).nth(8).click({ button: 'right' });
  const top = await scrollTop(page);
  expect(top).toBeGreaterThan(0);
  await page.locator('[data-album-menu] [data-action="open-detail"]').click();
  await expect(detailTitle(page)).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => scrollTop(page)).toBe(top);

  await filter(page).fill('zzz');
  await expect(page.getByText('没有匹配的专辑')).toBeVisible();
  await grid(page).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(detailTitle(page)).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(filter(page)).toHaveValue('zzz');

  await filter(page).fill('');
  await expect(tiles(page).first()).toBeVisible();
  expect((await watchScroll(page)).high).toBe(0);
});

test('回来时过滤词与眼下不同、曲目级命中晚到：等命中并上再交还滚动与焦点', async ({ page }) => {
  const host = await start(page);
  // 过滤词按专辑字段只命中十张，曲目级命中再带出一百张：交还的位置只在并上之后的清单里够得着。
  const hits = manyAlbums(300)
    .slice(100, 200)
    .map((album) => albumTrackRow(album.name, album.albumArtist, 'Hit'));
  host.answer('library.search', {
    success: true,
    tracks: hits,
    total: hits.length,
    offset: 0,
    limit: 5000,
    hasMore: false,
  });
  await filter(page).fill('0000');
  await expect(tiles(page).nth(10)).toContainText('Album 00100');
  await scrollTo(page, 1500);
  const focused = tiles(page).nth(8);
  const name = (await focused.locator('span').first().textContent()) ?? '';
  await focused.click({ button: 'right' });
  const top = await scrollTop(page);
  expect(top).toBeGreaterThan(1000);
  await page.locator('[data-album-menu] [data-action="open-detail"]').click();
  await expect(detailTitle(page)).toHaveText(name);

  // 从侧边栏再进一次专辑页（历史里另一条），换一个过滤词，再退回最早那一条。
  const nav = page.getByRole('navigation', { name: '侧边栏' });
  await nav.getByRole('button', { name: '专辑', exact: true }).click();
  await filter(page).fill('002');
  await expect(tiles(page).first()).toBeVisible();
  const held = host.hold('library.search');
  await grid(page).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(detailTitle(page)).toHaveText(name);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(filter(page)).toHaveValue('0000');
  await expect.poll(() => held.pending.length).toBe(1);
  // 命中晚于交还的挂起期限才到（大库冷启动时常见）：先落在只筛专辑字段的清单上的话，这时已经作罢。
  await page.waitForTimeout(RESTORE_WINDOW_MS + 200);
  held.release();

  await expect.poll(() => scrollTop(page)).toBe(top);
  const active = await grid(page).getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).toContainText(name);
});

test('Esc 在筛选框里清空筛选词；框是空的时不认领', async ({ page }) => {
  await start(page, SAMPLE_ALBUMS);
  // 在命令登记处之后再挂一个监听：同一目标同一阶段按挂的先后调，这里看到的是登记处处理之后的结果。
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape')
        document.body.dataset['escapeClaimed'] = `${event.defaultPrevented}`;
    });
  });
  const claimed = () => page.locator('body').getAttribute('data-escape-claimed');
  await filter(page).fill('blue');
  await expect(tiles(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(filter(page)).toHaveValue('');
  await expect(tiles(page)).toHaveCount(SAMPLE_ALBUMS.length);
  expect(await claimed()).toBe('true');

  await page.keyboard.press('Escape');
  await expect(filter(page)).toBeFocused();
  expect(await claimed()).toBe('false');
});

test('筛选条：按流派勾选，数字是张数；勾中的值列成标签，去掉后恢复', async ({ page }) => {
  await start(page, SAMPLE_ALBUMS);
  await page.locator('[data-album-tool="page-menu"]').click();
  await page.locator('[data-album-tool="facets"]').click();
  await page.locator('[data-facet="genre"]').click();
  const jazz = page.getByRole('menuitemcheckbox', { name: /Jazz/ });
  await expect(jazz).toContainText('4');
  await jazz.click();
  await page.keyboard.press('Escape');
  await expect(tiles(page)).toHaveCount(4);
  await page.getByRole('button', { name: '去掉 Jazz' }).click();
  await expect(tiles(page)).toHaveCount(SAMPLE_ALBUMS.length);
});
