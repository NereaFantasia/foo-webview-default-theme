import { expect, test, type Page } from '@playwright/test';
import { SONGS_SORT } from '../../src/library/songs/songsSort.ts';
import { openSongs, SONG_TRACKS } from '../fixtures/songsPage.ts';

// 歌曲页：从侧边栏进、按宿主排好的顺序画整库，过滤框按词与按查询筛、查询菜单的预设、分面、列头排序、双击按查询
// 填表起播、专辑格进详情页。

const queries = (calls: readonly Record<string, unknown>[]) => calls.map((call) => call['query']);
const header = (page: Page, name: string) =>
  page.locator('[data-page="songs"]').getByRole('columnheader', { name });

test('侧边栏的歌曲能点，进来按艺术家排整库；页头写首数与总长，列头是缺省的七列', async ({
  page,
}) => {
  const songs = await openSongs(page);
  await expect(songs.subtitle).toHaveText(/^8 首 · \d+ 分钟$/);
  expect(await songs.titles()).toEqual([
    'Workinonit',
    'Time: The Donut of the Heart',
    'Angel',
    'Teardrop',
    'Feather',
    'Luv (sic) Part 3',
    'Sour Times',
    'Glory Box',
  ]);
  for (const name of ['标题', '艺人', '专辑', '年份', '流派', '评分', '时长']) {
    await expect(header(page, name)).toBeVisible();
  }
  expect(songs.host.callsTo('library.query')).toEqual([
    { query: 'ALL', sort: SONGS_SORT.artist, limit: 1_000_000, fields: ['handle'] },
  ]);
  expect(songs.errors).toEqual([]);
});

test('按词过滤：宿主按词查，副题接全库首数；Esc 清空回到整库', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('massive');
  await expect(songs.subtitle).toContainText('2 首');
  await expect(songs.subtitle).toContainText('全库 8 首');
  expect(await songs.titles()).toEqual(['Angel', 'Teardrop']);
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toContain('title HAS "massive"');
  await songs.box.press('Escape');
  await expect(songs.box).toHaveValue('');
  await expect(songs.subtitle).toHaveText(/^8 首/);
  expect(songs.errors).toEqual([]);
});

test('框里写查询：报错时保留上次结果，说明提供预设与写法入口', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-query-mode-toggle]').click();
  await songs.box.fill('%bitrate GREATER 900 AND');
  await expect(songs.view.locator('[data-query-mode="invalid"]')).toBeVisible();
  await expect(songs.box).toHaveAttribute('aria-invalid', 'true');
  const hint = songs.view.locator('[data-songs-invalid]');
  await expect(hint).toContainText('显示上次的 8 首结果');
  expect(await songs.titles()).toHaveLength(8);
  await hint.getByRole('button', { name: '查询预设与语法' }).click();
  await expect(page.locator('[data-query-menu]')).toBeVisible();
  await expect(songs.box).toBeFocused();
  await songs.box.press('Escape');
  await songs.view.locator('[data-query-mode-toggle]').click();
  await songs.box.fill('massive');
  await expect(songs.box).not.toHaveAttribute('aria-invalid', 'true');
  await expect(songs.subtitle).toContainText('2 首');
  expect(songs.errors).toEqual([]);
});

test('查询菜单：勾「无损」叠加为条件、条件行出现，✕ 去掉；Esc 先关菜单', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-query-funnel]').click();
  const menu = page.locator('[data-query-menu]');
  await menu.locator('[data-query-option="lossless"]').click();
  await expect(songs.subtitle).toContainText('7 首');
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toBe('%__encoding% IS lossless');
  await expect(menu.locator('[data-query-option="lossless"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await songs.box.press('Escape');
  await expect(menu).toHaveCount(0);
  const chip = songs.view.locator('[data-songs-condition="preset:lossless"]');
  await expect(chip).toBeVisible();
  await songs.view.getByRole('button', { name: '去掉「无损」' }).click();
  await expect(chip).toHaveCount(0);
  await expect(songs.subtitle).toHaveText(/^8 首/);
  expect(songs.errors).toEqual([]);
});

test('问号不打开查询菜单，Alt+下箭头打开后可用键盘勾预设', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.focus();
  await page.keyboard.type('?');
  const menu = page.locator('[data-query-menu]');
  await expect(menu).toHaveCount(0);
  await songs.box.press('Alt+ArrowDown');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu.locator('[data-query-option="highRated"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(songs.box).toBeFocused();
  expect(songs.errors).toEqual([]);
});

test('点列头按标题排、再点换成降序；降序不再问宿主', async ({ page }) => {
  const songs = await openSongs(page);
  await header(page, '标题').click();
  await expect
    .poll(() => songs.titles())
    .toEqual([...SONG_TRACKS].map((track) => track.title).sort((a, b) => a.localeCompare(b)));
  const asked = songs.host.callsTo('library.query').length;
  expect(songs.host.callsTo('library.query').at(-1)).toMatchObject({ sort: SONGS_SORT.title });
  await header(page, '标题').click();
  await expect.poll(async () => (await songs.titles())[0]).toBe('Workinonit');
  expect(songs.host.callsTo('library.query')).toHaveLength(asked);
  expect(songs.errors).toEqual([]);
});

test('双击一行：按同一串查询与排序向宿主要路径，整份换进专用列表，核对那一行再起播', async ({
  page,
}) => {
  const songs = await openSongs(page);
  await songs.box.fill('nujabes');
  // 去抖期间表格还是整库，双击按显示的那一份起播；等宿主按词答回来再点。
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await songs.row('Luv (sic) Part 3').dblclick();
  await expect.poll(() => songs.host.callsTo('playlist.playTrack').length).toBe(1);
  const asked = songs.host
    .callsTo('library.query')
    .filter((call) => Array.isArray(call['fields']) && call['fields'].includes('path'));
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ sort: SONGS_SORT.artist });
  expect(String(asked[0]?.['query'])).toContain('HAS "nujabes"');
  const index = (await songs.titles()).indexOf('Luv (sic) Part 3');
  expect(index).toBe(1);
  expect(songs.host.callsTo('playlist.playTrack')[0]).toMatchObject({ index });
  expect(songs.host.callsTo('library.addToPlaylist')).toHaveLength(1);
  expect(songs.host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  expect(songs.errors).toEqual([]);
});

test('分面条：勾一个流派按它筛，条件行列出它；分面开合落盘', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-songs-facets-toggle]').click();
  const genre = songs.view.locator('[data-songs-facet="genre"]');
  await genre.getByRole('checkbox', { name: 'Trip-Hop' }).check();
  await expect(songs.subtitle).toContainText('4 首');
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toBe('genre IS "Trip-Hop"');
  await expect(songs.view.locator('[data-songs-condition="genre:Trip-Hop"]')).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('default-theme.songs.v1'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ facetsOpen: true });
  await genre.getByRole('button', { name: '已勾 1', exact: true }).click();
  await expect(genre.getByRole('checkbox', { name: 'Trip-Hop' })).not.toBeChecked();
  await expect(songs.subtitle).toHaveText(/^8 首/);
  const artist = songs.view.locator('[data-songs-facet="artist"]');
  await artist.getByRole('textbox', { name: '筛选艺人' }).fill('mass');
  await expect(artist.getByRole('checkbox')).toHaveCount(1);
  const massive = artist.getByRole('checkbox', { name: 'Massive Attack' });
  await massive.focus();
  await page.keyboard.press('Space');
  await expect(massive).toBeChecked();
  await expect(songs.subtitle).toContainText('2 首');
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toBe('artist IS "Massive Attack"');
  expect(songs.errors).toEqual([]);
});

test('专辑格是链接，单击进那张专辑的详情页', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.row('Angel').getByRole('button', { name: 'Mezzanine' }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await expect(page.locator('[data-page="songs"]')).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

test('每行左边是所在专辑的封面缩略图，同一张专辑的几首只取一次地址', async ({ page }) => {
  const songs = await openSongs(page);
  const art = songs.row('Angel').locator('[data-column-id="art"] [data-song-art]');
  await expect(art.locator('img')).toBeVisible();
  const cells = await songs
    .row('Angel')
    .locator('[role="gridcell"]')
    .evaluateAll((all) => all.map((cell) => cell.getAttribute('data-column-id')));
  expect(cells.indexOf('art')).toBe(cells.indexOf('title') - 1);
  await expect(songs.row('Teardrop').locator('[data-song-art] img')).toBeVisible();
  const asked = songs.host
    .callsTo('artwork.getFb2kUrlByPath')
    .filter((params) => String(params['path']).includes('Mezzanine'));
  expect(asked).toHaveLength(1);
  expect(songs.errors).toEqual([]);
});

test('⋯ 菜单换行密度：行高与缩略图边长跟着变，落盘', async ({ page }) => {
  const songs = await openSongs(page);
  const row = songs.row('Angel');
  const height = async () => (await row.boundingBox())?.height ?? 0;
  expect(await height()).toBeCloseTo(40, 2);
  await songs.view.locator('[data-songs-more]').click();
  await page.locator('[data-action="density"]').click();
  await page.getByRole('menuitemradio', { name: '宽松' }).click();
  await expect.poll(height).toBeCloseTo(56, 2);
  const art = await row.locator('[data-song-art]').boundingBox();
  expect(art?.height).toBeCloseTo(48, 2);
  const saved = await page.evaluate(() => localStorage.getItem('default-theme.songs.v1'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ density: 'comfortable' });
  expect(songs.errors).toEqual([]);
});

test('右键多选的几首：说明行写已选几首与共同的艺术家，转到专辑去右键的那一首', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.row('Angel').click();
  await songs.row('Teardrop').click({ modifiers: ['Shift'] });
  await songs.row('Teardrop').click({ button: 'right' });
  const menu = page.locator('[data-track-menu]');
  await expect(menu.locator('[data-menu-caption]')).toContainText('已选 2 首');
  await expect(menu.locator('[data-menu-caption]')).toContainText('Massive Attack');
  await menu.locator('[data-action="go-to-album"]').click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  expect(songs.errors).toEqual([]);
});
