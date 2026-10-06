import { expect, test, type Locator, type Page } from '@playwright/test';
import { libraryAnswers, manyAlbums, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

// 封面墙的下拉：单击开合、同一行换一张、换行、自动滚动、减弱动效、键盘与收起的几种情形。
// 专辑按名字平铺，1280 宽时一行五块；替身每张答两首。

const tiles = (page: Page) => page.locator('[data-album-tile]');
const tile = (page: Page, name: string) => tiles(page).filter({ hasText: name });
const grid = (page: Page) => page.locator('[data-album-wall]');
const slots = (page: Page) => page.locator('[data-fold-slot]');
const panel = (page: Page) => page.locator('[data-album-dropdown]');
const tracks = (page: Page) => page.locator('[data-dropdown-track]');

let errors: string[] = [];

async function start(
  page: Page,
  albums = SAMPLE_ALBUMS,
  options: { reducedMotion?: 'reduce' } = {},
): Promise<PageHost> {
  errors = collectPageErrors(page);
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: options.reducedMotion });
  const host = await installPageHost(page, { answers: libraryAnswers(albums) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();
  return host;
}

/** 面板此刻露出多高：开合的时钟逐帧写进 --fold-visible。 */
function visibleOf(slot: Locator): Promise<number> {
  return slot.evaluate((element) =>
    parseFloat(getComputedStyle(element).getPropertyValue('--fold-visible')),
  );
}

/** 面板高：条目流里给它留的高，第 0 帧就到终值。 */
function panelOf(slot: Locator): Promise<number> {
  return slot.evaluate((element) =>
    parseFloat(getComputedStyle(element).getPropertyValue('--panel-height')),
  );
}

/**
 * 在页面里逐帧记一个值，直到连续几帧不变（动画停了）或超时，答每一帧的值。
 * `read` 在页面里跑，读的是第一个匹配 `selector` 的元素。
 */
function sample(
  page: Page,
  selector: string,
  read: 'visible' | 'top' | 'scroll',
): Promise<number[]> {
  return page.evaluate(
    ({ selector, read }) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const end = performance.now() + 2000;
        const frame = () => {
          const element = document.querySelector<HTMLElement>(selector);
          const wall = document.querySelector<HTMLElement>('[data-album-wall]');
          let value = Number.NaN;
          if (read === 'visible' && element)
            value = parseFloat(getComputedStyle(element).getPropertyValue('--fold-visible'));
          if (read === 'top' && element) value = element.getBoundingClientRect().top;
          if (read === 'scroll' && wall) value = wall.scrollTop;
          values.push(value);
          const still =
            values.length > 8 && values.slice(-8).every((seen) => seen === values.at(-1));
          if (still || performance.now() > end) resolve(values);
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { selector, read },
  );
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('单击封面在这一行下面展开下拉：先露出一截，逐帧长到面板高；下面的行跟着让位', async ({
  page,
}) => {
  await start(page);
  const below = tile(page, 'Revolver');
  const before = (await below.boundingBox())?.y ?? 0;
  await tile(page, 'Blue Train').click();
  await expect(slots(page)).toHaveCount(1);
  const opening = sample(page, '[data-fold-slot]', 'visible');
  const values = await opening;
  const height = await panelOf(slots(page));
  expect(values.at(-1)).toBe(height);
  // 中间至少有一帧在半路上：不是一步到位。
  expect(values.some((value) => value > 0 && value < height)).toBe(true);
  await expect(panel(page)).toContainText('Blue Train');
  await expect(panel(page)).toContainText('John Coltrane');
  await expect(tracks(page)).toHaveCount(2);
  await expect(panel(page)).toContainText('1957 · Jazz');
  const after = (await below.boundingBox())?.y ?? 0;
  expect(after - before).toBeCloseTo(height + 12, 0);
});

test('再点同一张收起；双击的第二下不算，下拉开着、这张照样起播', async ({ page }) => {
  const host = await start(page);
  await tile(page, 'Blue Train').click();
  await expect(tracks(page)).toHaveCount(2);
  await tile(page, 'Blue Train').click();
  await expect(slots(page)).toHaveCount(0);

  await tile(page, 'Kind of Blue').dblclick();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  await expect(slots(page)).toHaveCount(1);
  await expect(panel(page)).toContainText('Kind of Blue');
});

test('同一行换一张：不收起，同一条下拉换成新的内容，箭头挪到新封面下', async ({ page }) => {
  await start(page);
  await tile(page, 'Abbey Road').click();
  await expect(tracks(page)).toHaveCount(2);
  const id = await slots(page).getAttribute('data-fold-slot');
  const caret = () =>
    slots(page).evaluate((element) => getComputedStyle(element).getPropertyValue('--caret-x'));
  const first = await caret();
  await tile(page, 'Kind of Blue').click();
  await expect(panel(page)).toHaveAttribute('data-album-dropdown', /^Kind of Blue/);
  await expect(slots(page)).toHaveCount(1);
  expect(await slots(page).getAttribute('data-fold-slot')).toBe(id);
  expect(await caret()).not.toBe(first);
  await expect(
    panel(page).locator('[aria-hidden="true"]').filter({ hasText: 'Abbey' }),
  ).toHaveCount(0);
});

test('换到别的行：旧的收起、新的展开同时走，最后只剩新的一条', async ({ page }) => {
  await start(page);
  await tile(page, 'Abbey Road').click();
  await expect(tracks(page)).toHaveCount(2);
  await tile(page, 'Revolver').click();
  await expect(slots(page)).toHaveCount(2);
  await expect(slots(page)).toHaveCount(1);
  await expect(panel(page)).toHaveAttribute('data-album-dropdown', /^Revolver/);
});

test('下拉放不下：展开的同时逐帧滚到下拉底边贴视口底边；用户一滚就停', async ({ page }) => {
  await start(page, manyAlbums(60));
  const target = tiles(page).filter({ hasText: 'Album 00015' });
  await target.click();
  const scrolled = await sample(page, '[data-album-wall]', 'scroll');
  expect(scrolled.at(-1)).toBeGreaterThan(0);
  expect(scrolled.some((value) => value > 0 && value < (scrolled.at(-1) ?? 0))).toBe(true);
  const bottom = await slots(page).evaluate((element) => element.getBoundingClientRect().bottom);
  const viewport = await grid(page).evaluate((element) => element.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThanOrEqual(viewport);

  await tiles(page).filter({ hasText: 'Album 00015' }).click();
  await expect(slots(page)).toHaveCount(0);
  await grid(page).evaluate((element) => element.scrollTo({ top: 0 }));
  await tiles(page).filter({ hasText: 'Album 00015' }).click();
  await page.mouse.wheel(0, -1);
  const stopped = await sample(page, '[data-album-wall]', 'scroll');
  expect(stopped.at(-1)).toBeLessThan(scrolled.at(-1) ?? 0);
});

test('减弱动效：展开直接到位，没有半路上的帧', async ({ page }) => {
  await start(page, SAMPLE_ALBUMS, { reducedMotion: 'reduce' });
  await tile(page, 'Blue Train').click();
  await expect(slots(page)).toHaveCount(1);
  const values = await sample(page, '[data-fold-slot]', 'visible');
  const height = await panelOf(slots(page));
  expect(values.every((value) => value === height)).toBe(true);
});

test('空格开合焦点那张；Tab 进下拉的曲目，上下键选曲、回车从这一首起播，Esc 收起', async ({
  page,
}) => {
  const host = await start(page);
  await grid(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  await expect(slots(page)).toHaveCount(1);
  await expect(tracks(page)).toHaveCount(2);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-dropdown-tracks]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(tracks(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => host.callsTo('playlist.playTrack'))
    .toEqual([expect.objectContaining({ index: 1 })]);
  await page.keyboard.press('Escape');
  await expect(slots(page)).toHaveCount(0);
  await expect(grid(page)).toBeFocused();

  await page.keyboard.press(' ');
  await expect(slots(page)).toHaveCount(1);
  await page.keyboard.press(' ');
  await expect(slots(page)).toHaveCount(0);
});

test('✕ 收起；右键一首曲目出只作用于它的菜单', async ({ page }) => {
  await start(page);
  await tile(page, 'Moanin').click();
  await expect(tracks(page)).toHaveCount(2);
  await tracks(page).nth(1).click({ button: 'right' });
  const menu = page.locator('[data-album-menu]');
  await expect(menu.locator('[data-menu-caption]')).toContainText('Moanin 2');
  await expect(menu.locator('[data-action="open-detail"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-dropdown-close]').click();
  await expect(slots(page)).toHaveCount(0);
});

test('这张被过滤掉、换了排序就收起；切到列表形态再切回来还开着、直接到位', async ({ page }) => {
  const host = await start(page);
  const filter = page.locator('input[data-album-filter]');
  await tile(page, 'Moanin').click();
  await expect(slots(page)).toHaveCount(1);
  // 过滤词的曲目级命中回来、条目流排定之后才算被过滤掉。
  await filter.fill('blue');
  await expect.poll(() => host.callsTo('library.search').length).toBe(1);
  await expect(tiles(page)).toHaveCount(2);
  await filter.fill('');
  await expect(tiles(page)).toHaveCount(SAMPLE_ALBUMS.length);
  await expect(slots(page)).toHaveCount(0);

  await tile(page, 'Moanin').click();
  await expect(slots(page)).toHaveCount(1);
  await page.locator('[data-album-tool="sort"]').click();
  await page.getByRole('menuitemradio', { name: '年份降序' }).click();
  await expect(slots(page)).toHaveCount(0);

  await tile(page, 'Moanin').click();
  await expect(tracks(page)).toHaveCount(2);
  await page.locator('[data-album-form="list"]').click();
  await expect(page.getByRole('treegrid', { name: '专辑列表' })).toBeVisible();
  await page.locator('[data-album-form="wall"]').click();
  await expect(panel(page)).toHaveAttribute('data-album-dropdown', /^Moanin/);
  expect(await visibleOf(slots(page))).toBe(await panelOf(slots(page)));
});

test('离开专辑页再从历史回来：下拉开着的那张直接到位，不播动画', async ({ page }) => {
  await start(page);
  await tile(page, 'The Wall').click();
  await expect(tracks(page)).toHaveCount(2);
  await tile(page, 'The Wall').click({ button: 'right' });
  await page.locator('[data-album-menu] [data-action="open-detail"]').click();
  await expect(page.locator('[data-page="album"] h1')).toHaveText('The Wall');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(panel(page)).toHaveAttribute('data-album-dropdown', /^The Wall/);
  const values = await sample(page, '[data-fold-slot]', 'visible');
  const height = await panelOf(slots(page));
  expect(values.every((value) => value === height)).toBe(true);
});
