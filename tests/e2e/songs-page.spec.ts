import { expect, test, type Page } from '@playwright/test';
import { TRACK_SORT } from '../../src/track/trackSort.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openSongs, SONG_TRACKS } from '../fixtures/songsPage.ts';

// 歌曲页：从侧边栏进、按宿主排好的顺序画整库，搜索框按词与按查询筛、筛选浮层的常用条件与分面、列头排序、双击按查询
// 填表起播、专辑格进详情页。

const queries = (calls: readonly Record<string, unknown>[]) => calls.map((call) => call['query']);
const header = (page: Page, name: string) =>
  page.locator('[data-page="songs"]').getByRole('columnheader', { name });

test('侧边栏的歌曲能点，进来按艺术家排整库；页头写首数与总长，列头是缺省的七列', async ({
  page,
}) => {
  const songs = await openSongs(page);
  await expect(songs.subtitle).toHaveAttribute('title', /^8 首 · \d+ 分钟$/);
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
    { query: 'ALL', sort: TRACK_SORT.artist, limit: 1_000_000, fields: ['handle'] },
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

test('字段菜单末项切到高级查询：报错时保留上次结果，说明打开语法示例；回到普通搜索', async ({
  page,
}) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-mode="advanced"]').click();
  await songs.box.fill('%bitrate GREATER 900 AND');
  await expect(songs.view.locator('[data-query-scope="advanced"]')).toHaveText('查询有误');
  await expect(songs.box).toHaveAttribute('aria-invalid', 'true');
  const hint = songs.view.locator('[data-songs-invalid]');
  await expect(hint).toContainText('显示上次的 8 首结果');
  expect(await songs.titles()).toHaveLength(8);
  await hint.getByRole('button', { name: '语法示例' }).click();
  const examples = page.getByRole('menu', { name: '查询', exact: true });
  await expect(examples).toBeVisible();
  await examples.locator('[data-query-mode="text"]').click();
  await expect(songs.view.locator('[data-query-scope="all"]')).toBeVisible();
  await songs.box.fill('massive');
  await expect(songs.box).not.toHaveAttribute('aria-invalid', 'true');
  await expect(songs.subtitle).toContainText('2 首');
  expect(songs.errors).toEqual([]);
});

test('筛选浮层的常用：勾「无损」叠加为条件、条件行出现，✕ 去掉；Esc 关浮层', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-filter-toggle]').click();
  const lossless = page.locator('[data-preset-chips] [data-preset="lossless"]');
  await lossless.click();
  await expect(songs.subtitle).toContainText('7 首');
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toBe('%__encoding% IS lossless');
  await expect(lossless).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-filter-surface]')).toHaveCount(0);
  const chip = songs.view.locator('[data-query-condition="preset:lossless"]');
  await expect(chip).toBeVisible();
  await songs.view.getByRole('button', { name: '移除「无损」' }).click();
  await expect(chip).toHaveCount(0);
  await expect(songs.subtitle).toHaveText(/^8 首/);
  expect(songs.errors).toEqual([]);
});

test('Alt+下箭头打开搜索范围菜单，选「标题」后框尾写标题', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.focus();
  await songs.box.press('Alt+ArrowDown');
  const menu = page.getByRole('menu', { name: '搜索范围' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: '标题', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(songs.view.locator('[data-query-scope="title"]')).toHaveText('标题');
  expect(songs.errors).toEqual([]);
});

test('点列头按标题排、再点换成降序；降序不再问宿主', async ({ page }) => {
  const songs = await openSongs(page);
  await header(page, '标题').click();
  await expect
    .poll(() => songs.titles())
    .toEqual([...SONG_TRACKS].map((track) => track.title).sort((a, b) => a.localeCompare(b)));
  const asked = songs.host.callsTo('library.query').length;
  expect(songs.host.callsTo('library.query').at(-1)).toMatchObject({ sort: TRACK_SORT.title });
  await header(page, '标题').click();
  await expect.poll(async () => (await songs.titles())[0]).toBe('Workinonit');
  expect(songs.host.callsTo('library.query')).toHaveLength(asked);
  expect(songs.errors).toEqual([]);
});

test('命令栏的排序：选字段按它向宿主要顺序，菜单里换方向不再问宿主，列头记号跟着变', async ({
  page,
}) => {
  const songs = await openSongs(page);
  const menu = page.locator('[data-page="songs"] [data-sort-menu]');
  await menu.click();
  await page.locator('[data-sort-field="title"]').click();
  await expect
    .poll(() => songs.titles())
    .toEqual([...SONG_TRACKS].map((track) => track.title).sort((a, b) => a.localeCompare(b)));
  expect(songs.host.callsTo('library.query').at(-1)).toMatchObject({ sort: TRACK_SORT.title });
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'ascending');
  const asked = songs.host.callsTo('library.query').length;
  await menu.click();
  await page.getByRole('menuitemradio', { name: '降序', exact: true }).click();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => (await songs.titles())[0]).toBe('Workinonit');
  await menu.click();
  await page.getByRole('menuitemradio', { name: '升序', exact: true }).click();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'ascending');
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
  expect(asked[0]).toMatchObject({ sort: TRACK_SORT.artist });
  expect(String(asked[0]?.['query'])).toContain('HAS "nujabes"');
  const index = (await songs.titles()).indexOf('Luv (sic) Part 3');
  expect(index).toBe(1);
  expect(songs.host.callsTo('playlist.playTrack')[0]).toMatchObject({ index });
  expect(songs.host.callsTo('library.addToPlaylist')).toHaveLength(1);
  expect(songs.host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  expect(songs.errors).toEqual([]);
});

test('筛选浮层：勾一个流派按它筛，条件行列出它，角标计数；Esc 关闭回到筛选键', async ({ page }) => {
  const songs = await openSongs(page);
  const toggle = songs.view.locator('[data-filter-toggle]');
  await toggle.click();
  await expect(songs.view.locator('[data-filter-surface="popover"]')).toBeVisible();
  const genre = songs.view.locator('[data-facet-column="genre"]');
  await genre.getByRole('checkbox', { name: 'Trip-Hop' }).check();
  await expect(songs.subtitle).toContainText('4 首');
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toBe('genre IS "Trip-Hop"');
  await expect(songs.view.locator('[data-query-condition="genre:Trip-Hop"]')).toBeVisible();
  await expect(toggle).toContainText('1');
  await genre.getByRole('button', { name: '已选 1 项', exact: true }).click();
  await expect(genre.getByRole('checkbox', { name: 'Trip-Hop' })).not.toBeChecked();
  await expect(songs.subtitle).toHaveText(/^8 首/);
  const artist = songs.view.locator('[data-facet-column="artist"]');
  await artist.getByRole('textbox', { name: '筛选艺人' }).fill('mass');
  await expect(artist.getByRole('checkbox')).toHaveCount(1);
  const massive = artist.getByRole('checkbox', { name: 'Massive Attack' });
  await massive.focus();
  await page.keyboard.press('Space');
  await expect(massive).toBeChecked();
  await expect(songs.subtitle).toContainText('2 首');
  expect(queries(songs.host.callsTo('library.query')).at(-1)).toBe('artist IS "Massive Attack"');
  await page.keyboard.press('Escape');
  await expect(songs.view.locator('[data-filter-surface]')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  expect(songs.errors).toEqual([]);
});

test('筛选嵌入页面与改回浮层：形态落盘，旧的歌曲偏好格式不变', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-filter-toggle]').click();
  await songs.view.locator('[data-filter-dock]').click();
  await expect(songs.view.locator('[data-filter-surface="docked"]')).toBeVisible();
  const stored = () => page.evaluate(() => localStorage.getItem('default-theme.songs-filter.v1'));
  expect(await stored()).toBe('docked');
  const saved = await page.evaluate(() => localStorage.getItem('default-theme.songs.v1'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ facetsOpen: true });
  await page.reload();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '歌曲', exact: true })
    .click();
  await expect(songs.view.locator('[data-filter-surface="docked"]')).toBeVisible();
  await songs.view.locator('[data-filter-collapse]').click();
  await expect(songs.view.locator('[data-filter-surface]')).toHaveCount(0);
  await songs.view.locator('[data-filter-toggle]').click();
  await songs.view.locator('[data-filter-undock]').click();
  await expect(songs.view.locator('[data-filter-surface="popover"]')).toBeVisible();
  expect(await stored()).toBe('popover');
  expect(songs.errors).toEqual([]);
});

test('筛选浮层拖开成浮动面板：在外按下不关，× 关闭，再开仍在拖到的位置，双击标题栏回到筛选键下方', async ({
  page,
}) => {
  const songs = await openSongs(page);
  const toggle = songs.view.locator('[data-filter-toggle]');
  const surface = songs.view.locator('[data-filter-surface]');
  const settleSurface = () =>
    surface.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => {})),
      );
    });
  await toggle.click();
  await songs.subtitle.click();
  await expect(surface).toHaveCount(0);
  await toggle.click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'popover');
  await settleSurface();
  const before = await surface.boundingBox();
  const handle = await surface.locator('[data-filter-handle]').boundingBox();
  if (!before || !handle) throw new Error('浮层没有画出来');
  await page.mouse.move(handle.x + 40, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 160, handle.y + 180, { steps: 6 });
  await page.mouse.up();
  await expect(surface).toHaveAttribute('data-filter-surface', 'floating');
  const floated = (await surface.boundingBox())?.y ?? 0;
  expect(floated).toBeGreaterThan(before.y + 100);
  await songs.subtitle.click();
  await expect(surface).toBeVisible();
  await surface.locator('[data-filter-close]').click();
  await expect(surface).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'floating');
  await settleSurface();
  expect(Math.abs(((await surface.boundingBox())?.y ?? 0) - floated)).toBeLessThan(2);
  await surface
    .locator('[data-filter-handle]')
    .dblclick({ position: { x: 40, y: handle.height / 2 } });
  await expect(surface).toHaveAttribute('data-filter-surface', 'popover');
  await settleSurface();
  expect(Math.abs(((await surface.boundingBox())?.y ?? 0) - before.y)).toBeLessThan(2);
  expect(songs.errors).toEqual([]);
});

test('窄窗：搜索收成图标，筛选只弹出、铺满宽度，分面改成标签页', async ({ page }) => {
  const songs = await openSongs(page);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(songs.view.locator('[data-songs-header]')).toHaveAttribute('data-tier', 'narrow');
  await songs.view.locator('[data-filter-toggle]').click();
  const surface = songs.view.locator('[data-filter-surface="popover"]');
  await expect(surface).toHaveAttribute('data-narrow', 'true');
  await expect(surface.locator('[data-filter-dock]')).toHaveCount(0);
  await surface.getByRole('tab', { name: '年代' }).click();
  await expect(surface.locator('[data-facet-column="decade"]')).toBeVisible();
  await expect(surface.locator('[data-facet-column="genre"]')).toHaveCount(0);
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

test('视图面板换行密度：行高与缩略图边长跟着变，落盘', async ({ page }) => {
  const songs = await openSongs(page);
  const row = songs.row('Angel');
  const height = async () => (await row.boundingBox())?.height ?? 0;
  expect(await height()).toBeCloseTo(40, 2);
  await songs.view.locator('[data-songs-view]').click();
  await page.getByRole('tab', { name: '宽松' }).click();
  await page.keyboard.press('Escape');
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

test('显示统计列时统计组件检查失败：横幅说明并可重试，检查通过后横幅撤掉', async ({ page }) => {
  const songs = await openSongs(page, {
    configure: (host) => host.answer('config.getComponents', hostFailure('OPERATION_FAILED')),
  });
  await songs.view.locator('[data-songs-view]').click();
  await page.locator('[data-action="columns"]').click();
  await page.getByRole('menuitemcheckbox', { name: '播放次数' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  const notice = songs.view.locator('[data-songs-notice="stats"]');
  await expect(notice).toContainText('播放统计组件检查失败');
  songs.host.answer('config.getComponents', {
    success: true,
    count: 1,
    components: [{ name: 'Playback Statistics', filename: 'foo_playcount.dll', version: '3.1' }],
  });
  await notice.getByRole('button', { name: '重试' }).click();
  await expect(notice).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});
