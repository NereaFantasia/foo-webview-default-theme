import { expect, test, type Locator, type Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

// 封面墙的指针与键盘：悬停键、两种作用对象的右键、双击与回车起播、打字即跳与全选。
// 专辑按名字平铺（缺省的分节依据），1280 宽时一行五块。

const tiles = (page: Page) => page.locator('[data-album-tile]');
const tile = (page: Page, name: string) => tiles(page).filter({ hasText: name });
const menu = (page: Page) => page.locator('[data-album-menu]');
const caption = (page: Page) => menu(page).locator('[data-menu-caption]');
const subtitle = (page: Page) => page.locator('[data-album-subtitle]');
const grid = (page: Page) => page.locator('[data-album-wall]');

let errors: string[] = [];

async function start(page: Page): Promise<PageHost> {
  errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(tiles(page)).toHaveCount(SAMPLE_ALBUMS.length);
  return host;
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('悬停键跟着指针挪，可见的只有悬停那一块上的一对；播放键起播这一张，更多开专辑菜单', async ({
  page,
}) => {
  const host = await start(page);
  const keys = page.locator('[data-tile-keys]:not([data-hidden])');
  const play = keys.locator('[data-tile-play]');
  await tile(page, 'Blue Train').hover();
  await expect(play).toHaveCount(1);
  const first = await tile(page, 'Blue Train').boundingBox();
  await expect.poll(async () => (await keys.boundingBox())?.x).toBeCloseTo(first?.x ?? -1, 0);

  await tile(page, 'Kind of Blue').hover();
  const second = await tile(page, 'Kind of Blue').boundingBox();
  await expect.poll(async () => (await keys.boundingBox())?.x).toBeCloseTo(second?.x ?? -1, 0);
  await expect(play).toHaveCount(1);

  await play.click();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  expect(host.callsTo('library.getAlbumTracks')).toContainEqual({
    album: 'Kind of Blue',
    albumArtist: 'Miles Davis',
  });

  await tile(page, 'Kind of Blue').hover();
  await keys.locator('[data-tile-more]').click();
  await expect(caption(page)).toContainText('Kind of Blue');
  await expect(caption(page)).toContainText('Miles Davis · 10 首');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(grid(page)).toBeFocused();
});

test('悬停键淡入淡出：离开后留在原处淡出，淡完不占位；再悬停同一块淡回', async ({ page }) => {
  await start(page);
  const keys = page.locator('[data-tile-keys]');
  const style = (name: 'opacity' | 'display') => () =>
    keys.evaluate(
      (element, property) => getComputedStyle(element).getPropertyValue(property),
      name,
    );
  await tile(page, 'Blue Train').hover();
  await expect.poll(style('opacity')).toBe('1');
  const at = await keys.boundingBox();

  await page.mouse.move(1, 1);
  await expect(keys).toHaveAttribute('data-hidden', 'true');
  await expect.poll(style('opacity')).toBe('0');
  await expect.poll(style('display')).toBe('none');

  await tile(page, 'Blue Train').hover();
  await expect(keys).not.toHaveAttribute('data-hidden');
  await expect.poll(style('display')).toBe('block');
  await expect.poll(style('opacity')).toBe('1');
  expect(await keys.boundingBox()).toEqual(at);
});

test('换块时新旧两对键交叉渐变：旧的留在原处淡出，新的在新一块上淡入', async ({ page }) => {
  await start(page);
  // 把过渡拉长，才拿得到两对键都在半路上的那一刻。
  await page.addStyleTag({ content: '[data-tile-keys] { transition-duration: 3s !important; }' });
  const keys = page.locator('[data-tile-keys]');
  const leaving = page.locator('[data-tile-keys][data-hidden]');
  const entering = page.locator('[data-tile-keys]:not([data-hidden])');
  const opacity = (pair: Locator) => () =>
    pair.evaluate((element) => Number(getComputedStyle(element).opacity));

  await tile(page, 'Blue Train').hover();
  await expect(keys).toHaveCount(1);
  const first = await tile(page, 'Blue Train').boundingBox();
  await tile(page, 'Kind of Blue').hover();
  const second = await tile(page, 'Kind of Blue').boundingBox();
  await expect(keys).toHaveCount(2);
  await expect.poll(async () => (await leaving.boundingBox())?.x).toBeCloseTo(first?.x ?? -1, 0);
  await expect.poll(async () => (await entering.boundingBox())?.x).toBeCloseTo(second?.x ?? -1, 0);
  await expect.poll(opacity(leaving)).toBeLessThan(1);
  await expect.poll(opacity(entering)).toBeGreaterThan(0);

  // 回到还在淡出的那一块：沿用原来那一对，不另起第三对。
  await tile(page, 'Blue Train').hover();
  await expect(keys).toHaveCount(2);
  await expect.poll(async () => (await leaving.boundingBox())?.x).toBeCloseTo(second?.x ?? -1, 0);
});

test('右键落在选择里作用于整个选择；落在选择外改为只选它、只作用于它', async ({ page }) => {
  const host = await start(page);
  await tile(page, 'Abbey Road').click();
  await tile(page, 'Blue Train').click({ modifiers: ['Control'] });
  await expect(subtitle(page)).toContainText('已选 2 张');

  await tile(page, 'Blue Train').click({ button: 'right' });
  await expect(caption(page)).toContainText('2 张专辑');
  await expect(caption(page)).toContainText('Abbey Road、Blue Train · 20 首');
  const enqueue = menu(page).locator('[data-action="enqueue"]');
  await expect(enqueue).not.toHaveAttribute('aria-disabled', 'true');
  await enqueue.click();
  await expect.poll(() => host.callsTo('queue.insertNext').length).toBe(1);
  expect(host.callsTo('queue.insertNext')[0]?.['paths']).toHaveLength(4);
  expect(host.callsTo('library.addToPlaylist')).toEqual([]);
  await expect(subtitle(page)).toContainText('已选 2 张');

  await tile(page, 'Revolver').click({ button: 'right' });
  await expect(caption(page)).toContainText('Revolver');
  await expect(caption(page)).toContainText('The Beatles · 10 首');
  await expect(subtitle(page)).not.toContainText('已选');
  await expect(tile(page, 'Revolver')).toHaveAttribute('aria-selected', 'true');
  await expect(tile(page, 'Abbey Road')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
});

test('双击与回车起播，页面不离开封面墙；方向键移焦点，打字即跳，Ctrl+A 全选', async ({ page }) => {
  const host = await start(page);
  await tile(page, 'Moanin').dblclick();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  expect(host.callsTo('library.getAlbumTracks')).toContainEqual({
    album: 'Moanin',
    albumArtist: 'Art Blakey',
  });
  await expect(page.locator('[data-page="albums"]')).toBeVisible();

  await tile(page, 'Abbey Road').click();
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const blue = await tile(page, 'Blue Train').getAttribute('id');
  await expect(grid(page)).toHaveAttribute('aria-activedescendant', blue ?? '');
  await page.keyboard.press('Enter');
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(2);
  expect(host.callsTo('library.getAlbumTracks')).toContainEqual({
    album: 'Blue Train',
    albumArtist: 'John Coltrane',
  });

  await page.keyboard.type('re');
  const revolver = await tile(page, 'Revolver').getAttribute('id');
  await expect(grid(page)).toHaveAttribute('aria-activedescendant', revolver ?? '');
  // 打字即跳的提示在内容区里；标题栏另有一个宿主状态的提示区。
  await expect(page.getByRole('main').getByRole('status')).toHaveText('re');

  await page.keyboard.press('Control+a');
  await expect(subtitle(page)).toContainText(`已选 ${SAMPLE_ALBUMS.length} 张`);
  await expect(tiles(page).locator('[data-tile-check]')).toHaveCount(SAMPLE_ALBUMS.length);
});

test('网格拿着焦点时 Alt+→ 照常前进：打开专辑详情、Alt+← 退回，再在网格上 Alt+→', async ({
  page,
}) => {
  await start(page);
  await tile(page, 'The Wall').click({ button: 'right' });
  await menu(page).locator('[data-action="open-detail"]').click();
  await expect(page.locator('[data-page="album"] h1')).toHaveText('The Wall');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(tiles(page)).toHaveCount(SAMPLE_ALBUMS.length);
  // 键要落在网格上才考得到「不被网格吃掉」：单击图块后焦点在网格元素自己身上。
  await tile(page, 'The Wall').click();
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('[data-page="album"] h1')).toHaveText('The Wall');
});

test('Shift+F10 在焦点图块的左下角开菜单', async ({ page }) => {
  await start(page);
  await tile(page, 'Kind of Blue').click();
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(caption(page)).toContainText('Kind of Blue');
  const box = await tile(page, 'Kind of Blue').boundingBox();
  const popover = await menu(page).boundingBox();
  // 横向贴着图块左边；纵向在图块下沿，Fluent 摆弹出层时自己挪的几像素不算。
  const bottom = box ? box.y + box.height : -1;
  expect(popover?.x).toBeCloseTo(box?.x ?? -1, 0);
  expect(Math.abs((popover?.y ?? 0) - bottom)).toBeLessThan(8);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
});

test.describe('英文界面', () => {
  const solo = albumRow('Solo', 'Sam', { genre: 'Jazz', trackCount: 1 });

  test('一张专辑、一首曲目写单数：页头副题、节头与菜单说明行', async ({ page }) => {
    errors = collectPageErrors(page);
    await installPageHost(page, {
      answers: libraryAnswers([solo]),
      config: { 'defaultTheme.locale': 'en', 'defaultTheme.browser.dimension': 'genre' },
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(tiles(page)).toHaveCount(1);
    await expect(subtitle(page)).toHaveText('1 album');
    const head = page.locator('[data-section-head]');
    await expect(head).toContainText('1 album');
    await expect(head).not.toContainText('albums');
    await tile(page, 'Solo').click({ button: 'right' });
    await expect(caption(page)).toContainText('Sam · 1 track');
    await expect(caption(page)).not.toContainText('tracks');
    await page.keyboard.press('Escape');
  });
});
