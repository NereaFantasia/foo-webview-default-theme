import { expect, test, type Page } from '@playwright/test';
import type { AlbumInfo, LibraryTrack } from 'foo-webview-sdk';
import {
  albumsAnswer,
  albumTracksAnswer,
  libraryAnswers,
  SAMPLE_ALBUMS,
} from '../fixtures/albumLibrary.ts';
import { listParam, stringParam, type ConfigValue } from '../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow } from '../fixtures/libraryRows.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

// 专辑详情页：三处入口先取数再进、被点处的小转圈、找不到只提示；页头、事实行与动作键；曲目表的起播、
// 列头排序、多碟分节；整页滚动时列头吸顶；离开再回来交还滚动、焦点与排序；这张移出媒体库时留在原页。

const page$ = (page: Page) => page.locator('[data-page="album"]');
const title = (page: Page) => page$(page).locator('h1');
const table = (page: Page) => page$(page).getByRole('treegrid', { name: '曲目' });
const row = (page: Page, name: string) =>
  table(page).getByRole('row', { name: new RegExp(`\\b${name}\\b`) });
const scroller = (page: Page) => page.locator('[data-detail-scroller]');
const tile = (page: Page, name: string) =>
  page.locator('[data-album-tile]').filter({ hasText: name });
const header = (page: Page, name: string) =>
  table(page).getByRole('columnheader', { name, exact: true });
const rowTitles = (page: Page) =>
  table(page)
    .locator('[role="gridcell"][data-column-id="title"]')
    .evaluateAll((cells) => cells.map((cell) => cell.textContent ?? ''));

/** 一张有很多首的专辑：分两张碟，每张 `perDisc` 首，第二张碟有副标题。 */
const BIG = albumRow('Big Box', 'Various', { genre: 'Rock', year: '1990', trackCount: 60 });

function bigTracks(perDisc: number): LibraryTrack[] {
  return [1, 2].flatMap((disc) =>
    Array.from({ length: perDisc }, (_, at) =>
      albumTrackRow('Big Box', 'Various', `Song ${disc}-${String(at + 1).padStart(2, '0')}`, {
        discNumber: disc,
        trackNumber: at + 1,
        duration: 200,
        path: `file://E:\\Music\\Big Box\\${disc}-${at + 1}.flac`,
      }),
    ),
  );
}

let errors: string[] = [];

async function start(
  page: Page,
  options: {
    albums?: readonly AlbumInfo[];
    config?: Record<string, ConfigValue>;
    width?: number;
  } = {},
): Promise<PageHost> {
  errors = collectPageErrors(page);
  const albums = options.albums ?? [...SAMPLE_ALBUMS, BIG];
  const answers = libraryAnswers(albums);
  const host = await installPageHost(page, { answers, config: options.config ?? {} });
  host.answer('library.getAlbumTracks', (params) =>
    stringParam(params, 'album') === 'Big Box'
      ? { ...albumTracksAnswer(params), tracks: bigTracks(30), items: bigTracks(30), total: 60 }
      : albumTracksAnswer(params),
  );
  host.answer('titleformat.evalBatch', (params) => {
    const paths = listParam(params, 'paths').map(String);
    return {
      success: true,
      pattern: stringParam(params, 'pattern'),
      total: paths.length,
      successCount: paths.length,
      errorCount: 0,
      results: paths.map((path) => ({
        path,
        success: true,
        result: path.includes('Big Box\\2-') ? 'lossless|24|Live' : 'lossless|16|',
      })),
    };
  });
  await page.setViewportSize({ width: options.width ?? 1280, height: 800 });
  await page.goto('/');
  await expect(
    page.locator('[data-album-tile], [data-album-list] [role="row"]').first(),
  ).toBeVisible();
  return host;
}

/** 右键封面、点「打开专辑详情」，等进到那一页。 */
async function openFromMenu(page: Page, name: string): Promise<void> {
  await tile(page, name).click({ button: 'right' });
  await page.locator('[data-album-menu] [data-action="open-detail"]').click();
  await expect(title(page)).toHaveText(name);
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('从下拉的 › 进：页头写名字、艺人与信息胶囊，曲目表列出曲目；侧边栏亮「专辑」', async ({
  page,
}) => {
  await start(page);
  await tile(page, 'The Wall').click();
  await page.locator('[data-dropdown-detail]').click();
  await expect(title(page)).toHaveText('The Wall');
  const head = page$(page).locator('[data-detail-head]');
  await expect(head).toContainText('Pink Floyd');
  const facts = page$(page).locator('[data-detail-facts] .fui-Tag');
  await expect(facts).toHaveText(['Rock', '1979', '2 首', 'FLAC 16/44.1']);
  await facts.nth(2).hover();
  await expect(page.getByRole('tooltip')).toContainText('2 首，6 分钟');
  await expect
    .poll(async () => (await head.locator('[data-detail-cover]').boundingBox())?.width)
    .toBe(350);
  await expect(row(page, 'The Wall 1')).toBeVisible();
  await expect(row(page, 'The Wall 2')).toBeVisible();
  const nav = page.getByRole('navigation', { name: '侧边栏' });
  await expect(nav.getByRole('button', { name: '专辑', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('曲目还没到时留在原处，等过 300 ms 被点的 › 转圈；到了再进', async ({ page }) => {
  const host = await start(page);
  await tile(page, 'The Wall').click();
  const key = page.locator('[data-dropdown-detail]');
  await expect(page.locator('[data-album-dropdown]')).toContainText('The Wall 1');
  const held = host.hold('library.getAlbumTracks');
  await key.click();
  await expect.poll(() => held.pending.length).toBe(1);
  await expect(key).toHaveAttribute('aria-busy', 'true');
  await expect(key.getByRole('progressbar')).toBeVisible();
  await expect(page$(page)).toHaveCount(0);
  held.release();
  await expect(title(page)).toHaveText('The Wall');
});

test('从专辑菜单进；页里的 ⋯ 是同一份专辑菜单，但没有指向这一页的「打开专辑详情」', async ({
  page,
}) => {
  await start(page);
  await openFromMenu(page, 'Kind of Blue');
  await page$(page).locator('[data-detail-more]').click();
  const menu = page.locator('[data-album-menu]');
  await expect(menu.locator('[data-action="play"]')).toBeVisible();
  await expect(menu.locator('[data-action="open-detail"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('这张没有曲目：不进页面，专辑页出提示，关掉就收', async ({ page }) => {
  const host = await start(page);
  host.answer('library.getAlbumTracks', (params) => ({ ...albumTracksAnswer(params), tracks: [] }));
  await tile(page, 'Revolver').click({ button: 'right' });
  await page.locator('[data-album-menu] [data-action="open-detail"]').click();
  const notice = page.locator('[data-album-notice="detail"]');
  await expect(notice).toContainText('媒体库中没有此专辑的曲目');
  await expect(page$(page)).toHaveCount(0);
  await notice.getByRole('button', { name: '关闭' }).click();
  await expect(notice).toHaveCount(0);
});

test('播放键从第一首起播整张；双击一行从那一首起播', async ({ page }) => {
  const host = await start(page);
  await openFromMenu(page, 'The Wall');
  await page$(page).locator('[data-detail-play]').click();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  expect(host.callsTo('library.addToPlaylist').at(-1)).toMatchObject({
    paths: [
      'file://E:\\Music\\The Wall\\The Wall 1.flac',
      'file://E:\\Music\\The Wall\\The Wall 2.flac',
    ],
  });
  expect(host.callsTo('playlist.playTrack')[0]).toMatchObject({ index: 0 });
  await row(page, 'The Wall 2').dblclick();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(2);
  expect(host.callsTo('playlist.playTrack')[1]).toMatchObject({ index: 1 });
});

test('多碟：碟、曲顺序下按碟分节，节头写副标题；列头排序后平铺，点 # 回来', async ({ page }) => {
  await start(page);
  await openFromMenu(page, 'Big Box');
  const discs = page$(page).locator('[data-detail-disc]');
  await expect(discs.first()).toHaveText('碟 1');
  await expect(page$(page).locator('[data-detail-disc="2"]')).toHaveCount(0);
  await header(page, '标题').click();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'ascending');
  await expect(discs).toHaveCount(0);
  await header(page, '标题').click();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'descending');
  expect((await rowTitles(page))[0]).toBe('Song 2-30');
  await header(page, '音轨号').click();
  await expect(discs.first()).toHaveText('碟 1');
  expect((await rowTitles(page))[0]).toBe('Song 1-01');
  await scroller(page).evaluate((element) => element.scrollTo({ top: 1200 }));
  await expect(page$(page).locator('[data-detail-disc="2"]')).toHaveText('碟 2 · Live');
});

test('整页一起滚：列头吸在顶上，行不从它底下露出来；End 落到最后一首、停在列头下面', async ({
  page,
}) => {
  await start(page);
  await openFromMenu(page, 'Big Box');
  const box = scroller(page);
  const head = table(page).locator('[role="rowgroup"]').first();
  // 行画在贴住视口的那一层里、被它裁掉：这一层的上沿不高于列头的下沿，行就不会从列头底下透出来。
  const shown = table(page).locator('[role="rowgroup"]').nth(1).locator('> [role="none"]');
  // 吸顶的列头贴在滚动区的上内边距以内。
  const inset = await box.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
  const top = async () => ((await box.boundingBox())?.y ?? 0) + inset;
  const headBottom = async () => {
    const rect = await head.boundingBox();
    return (rect?.y ?? 0) + (rect?.height ?? 0);
  };
  await box.evaluate((element) => element.scrollTo({ top: 1200 }));
  // 两边都在轮询里现量：进页的缩放动画还没走完时，量出来的位置都在变。
  await expect
    .poll(async () => Math.round(((await head.boundingBox())?.y ?? -1) - (await top())))
    .toBe(0);
  await expect
    .poll(async () => Math.round(((await shown.boundingBox())?.y ?? -1) - (await headBottom())))
    .toBe(0);
  await expect(row(page, 'Song 1-01')).toHaveCount(0);

  await table(page).focus();
  await page.keyboard.press('End');
  const last = row(page, 'Song 2-30');
  await expect(last).toBeInViewport();
  const lastTop = (await last.boundingBox())?.y ?? 0;
  expect(lastTop).toBeGreaterThanOrEqual(await headBottom());
  // 滚到了底，下面只剩页面的下内边距：那一层照样贴在列头下面，不被往上推。
  const layerTop = (await shown.boundingBox())?.y ?? -1;
  expect(Math.abs(layerTop - (await headBottom()))).toBeLessThan(1);
});

test('离开再从历史回来：滚动、焦点行与排序交还', async ({ page }) => {
  await start(page);
  await openFromMenu(page, 'Big Box');
  await header(page, '标题').click();
  await scroller(page).evaluate((element) => element.scrollTo({ top: 1400 }));
  const target = row(page, 'Song 2-05');
  await target.click();
  const scrolled = await scroller(page).evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  const nav = page.getByRole('navigation', { name: '侧边栏' });
  await nav.getByRole('button', { name: '专辑', exact: true }).click();
  await expect(page$(page)).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(title(page)).toHaveText('Big Box');
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBe(scrolled);
  const active = await table(page).getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).toContainText('Song 2-05');
  await expect(target).toHaveAttribute('aria-selected', 'false');
});

test('从封面墙进、Alt+← 回去：下拉还开着，DOM 焦点回到网格上那一块', async ({ page }) => {
  await start(page);
  await tile(page, 'The Wall').click();
  await page.locator('[data-dropdown-detail]').click();
  await expect(title(page)).toHaveText('The Wall');
  await table(page).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  const grid = page.locator('[data-album-wall]');
  await expect(page.locator('[data-album-dropdown]')).toHaveAttribute(
    'data-album-dropdown',
    /^The Wall/,
  );
  await expect(grid).toBeFocused();
  const active = await grid.getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).toContainText('The Wall');
});

test('从列表形态进、后退回去：列表的滚动与焦点行交还', async ({ page }) => {
  await start(page, {
    albums: [...SAMPLE_ALBUMS, BIG],
    config: { 'defaultTheme.browser.form': 'list' },
  });
  const list = page.getByRole('treegrid', { name: '专辑列表' });
  const listScroller = list.locator('[role="rowgroup"]').last().locator('xpath=..');
  await listScroller.evaluate((element) => element.scrollTo({ top: 400 }));
  const picked = list.getByRole('row', { name: /Kind of Blue 2/ });
  await picked.click();
  const scrolled = await listScroller.evaluate((element) => element.scrollTop);
  // 光比滚动量测不出垫位行晚到造成的错位：连同那一行在视口里的位置一起比。
  const shownAt = async () => Math.round((await picked.boundingBox())?.y ?? -1);
  const before = await shownAt();
  await list.locator('[data-list-album="Led Zeppelin IV"] [data-list-album-name]').click();
  await expect(title(page)).toHaveText('Led Zeppelin IV');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(list).toBeVisible();
  await expect.poll(() => listScroller.evaluate((element) => element.scrollTop)).toBe(scrolled);
  await expect.poll(shownAt).toBe(before);
  const active = await list.getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).toContainText('Kind of Blue 2');
});

test('列表形态切走再切回来：交还切走时的滚动，不是更早从详情页回来时的那份', async ({ page }) => {
  await start(page, {
    albums: [...SAMPLE_ALBUMS, BIG],
    config: { 'defaultTheme.browser.form': 'list' },
  });
  const list = page.getByRole('treegrid', { name: '专辑列表' });
  const listScroller = list.locator('[role="rowgroup"]').last().locator('xpath=..');
  const scrollTop = () => listScroller.evaluate((element) => element.scrollTop);
  await listScroller.evaluate((element) => element.scrollTo({ top: 400 }));
  await list.locator('[data-list-album="Led Zeppelin IV"] [data-list-album-name]').click();
  await expect(title(page)).toHaveText('Led Zeppelin IV');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(scrollTop).toBe(400);

  await listScroller.evaluate((element) => element.scrollTo({ top: 100 }));
  await expect.poll(scrollTop).toBe(100);
  await page.locator('[data-album-form="wall"]').click();
  await openFromMenu(page, 'The Wall');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(tile(page, 'The Wall')).toBeVisible();
  await page.locator('[data-album-form="list"]').click();
  await expect(list).toBeVisible();
  await expect.poll(scrollTop).toBe(100);
});

test('库变了、这张的曲目原样回来：选中还在；换了排序才清空', async ({ page }) => {
  const host = await start(page);
  await openFromMenu(page, 'The Wall');
  await row(page, 'The Wall 1').click();
  await row(page, 'The Wall 2').click({ modifiers: ['Control'] });
  await host.waitForListener('library:itemsModified');
  const before = host.callsTo('library.getAlbumTracks').length;
  await host.emit('library:itemsModified', { count: 1, timestamp: 1 });
  await expect.poll(() => host.callsTo('library.getAlbumTracks').length).toBeGreaterThan(before);
  await page.waitForTimeout(200);
  await expect(row(page, 'The Wall 1')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'The Wall 2')).toHaveAttribute('aria-selected', 'true');
  // 标题升序与碟、曲顺序一样，行序号没变；反向才换了顺序。
  await header(page, '标题').click();
  await expect(row(page, 'The Wall 1')).toHaveAttribute('aria-selected', 'true');
  await header(page, '标题').click();
  await expect(row(page, 'The Wall 1')).toHaveAttribute('aria-selected', 'false');
});

test('停在页上时这张移出了媒体库：留在原页，写明原因，曲目表撤掉', async ({ page }) => {
  const host = await start(page);
  await openFromMenu(page, 'The Wall');
  await host.waitForListener('library:itemsRemoved');
  host.answer(
    'library.getAlbums',
    albumsAnswer(SAMPLE_ALBUMS.filter((one) => one.name !== 'The Wall')),
  );
  await host.emit('library:itemsRemoved', { count: 1, timestamp: 1 });
  await expect(page$(page).locator('[data-detail-notice="missing"]')).toContainText(
    '此专辑已不在媒体库中',
  );
  await expect(title(page)).toHaveText('The Wall');
  await expect(table(page)).toHaveCount(0);
});

test('窄于 600：封面缩成 96，只有播放键带字', async ({ page }) => {
  await start(page, { width: 600 });
  await openFromMenu(page, 'The Wall');
  const cover = page$(page).locator('[data-detail-cover]');
  await expect.poll(async () => (await cover.boundingBox())?.width).toBe(96);
  await expect(page$(page).locator('[data-detail-send]')).toHaveAccessibleName('发送到…');
  await expect(page$(page).locator('[data-detail-send]')).not.toContainText('发送到');
  await expect(page$(page).locator('[data-detail-play]')).toContainText('播放');
  await expect(page$(page).locator('[data-detail-shuffle]')).toHaveAccessibleName('随机播放');
  await expect(page$(page).locator('[data-detail-shuffle]')).not.toContainText('随机播放');
});

test('查找即时筛选标题与艺人；失焦保留，Esc 先清空再收起并归还焦点', async ({ page }) => {
  await start(page);
  await openFromMenu(page, 'The Wall');
  const toggle = page$(page).locator('[data-detail-find-toggle]');
  await toggle.click();
  const input = page$(page).getByRole('searchbox', { name: '查找曲目' });
  await expect(input).toBeFocused();
  await input.fill('wALL 2 ARTIST');
  await expect(row(page, 'The Wall 2')).toBeVisible();
  await expect(row(page, 'The Wall 1')).toHaveCount(0);
  await title(page).click();
  await expect(input).toHaveValue('wALL 2 ARTIST');
  await input.fill('absent');
  await expect(page$(page).locator('[data-detail-no-matches]')).toHaveText('没有匹配的曲目');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(row(page, 'The Wall 1')).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('排序只列五个字段，方向独立；与列头同步，收起后保留排序', async ({ page }) => {
  await start(page);
  await openFromMenu(page, 'Big Box');
  const toggle = page$(page).locator('[data-detail-sort-toggle]');
  await toggle.click();
  const field = page$(page).locator('[data-detail-sort-field]');
  const direction = page$(page).locator('[data-detail-sort-direction]');
  await field.click();
  const menu = page.getByRole('menu', { name: '排序字段' });
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    '专辑顺序',
    '标题',
    '艺人',
    '评分',
    '时长',
  ]);
  await menu.getByRole('menuitemradio', { name: '标题', exact: true }).click();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'ascending');
  await direction.click();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'descending');
  expect((await rowTitles(page))[0]).toBe('Song 2-30');
  await header(page, '时长').click();
  await expect(field).toHaveText('时长');
  await expect(direction).toHaveAccessibleName('升序');
  await field.click();
  await menu.getByRole('menuitemradio', { name: '专辑顺序', exact: true }).click();
  await direction.click();
  await expect(page$(page).locator('[data-detail-disc]').first()).toHaveText('碟 2 · Live');
  expect((await rowTitles(page))[0]).toBe('Song 2-30');
  await toggle.click();
  await expect(page$(page).locator('[data-detail-sort-controls]')).toBeHidden();
  await expect(toggle).toHaveAttribute('data-active', 'true');
  expect((await rowTitles(page))[0]).toBe('Song 2-30');
});

test('筛选后页头播放与随机播放仍作用于整张专辑，不改全局播放顺序', async ({ page }) => {
  const host = await start(page);
  await openFromMenu(page, 'The Wall');
  await page$(page).locator('[data-detail-find-toggle]').click();
  await page$(page).getByRole('searchbox', { name: '查找曲目' }).fill('wall 2');
  await page$(page).locator('[data-detail-play]').click();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  const paths = [
    'file://E:\\Music\\The Wall\\The Wall 1.flac',
    'file://E:\\Music\\The Wall\\The Wall 2.flac',
  ];
  expect(host.callsTo('library.addToPlaylist').at(-1)).toMatchObject({ paths });
  await page$(page).locator('[data-detail-shuffle]').click();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(2);
  const shuffled = host.callsTo('library.addToPlaylist').at(-1);
  expect(
    listParam(shuffled ?? {}, 'paths')
      .map(String)
      .sort(),
  ).toEqual(paths);
  expect(host.callsTo('playlist.playTrack').at(-1)).toMatchObject({ index: 0 });
  expect(host.callsTo('playback.setPlaybackOrder')).toHaveLength(0);
});

test('新专辑不继承查找，后退恢复原查找与排序', async ({ page }) => {
  await start(page);
  await openFromMenu(page, 'The Wall');
  await page$(page).locator('[data-detail-find-toggle]').click();
  await page$(page).getByRole('searchbox', { name: '查找曲目' }).fill('wall 2');
  await header(page, '标题').click();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true })
    .click();
  await openFromMenu(page, 'Revolver');
  await expect(page$(page).getByRole('searchbox')).toHaveCount(0);
  await expect(page$(page).locator('[data-detail-sort-toggle]')).not.toHaveAttribute('data-active');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page$(page)).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(title(page)).toHaveText('The Wall');
  await expect(page$(page).getByRole('searchbox', { name: '查找曲目' })).toHaveValue('wall 2');
  await expect(row(page, 'The Wall 1')).toHaveCount(0);
  await expect(row(page, 'The Wall 2')).toBeVisible();
  await expect(header(page, '标题')).toHaveAttribute('aria-sort', 'ascending');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`窄窗长标题与展开工具不撑宽页面，光晕覆盖滚动内容：${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const name = 'A very long album title with enough words to exceed the available header width';
    await start(page, { width: 390, albums: [albumRow(name, 'Artist')] });
    await openFromMenu(page, name);
    await page$(page).locator('[data-detail-sort-toggle]').click();
    await expect(page$(page).locator('[data-detail-sort-controls]')).toBeVisible();
    await page$(page).locator('[data-detail-find-toggle]').click();
    await expect(page$(page).getByRole('searchbox')).toBeFocused();
    const geometry = await page$(page).evaluate((element) => {
      const nodes = element.querySelectorAll<HTMLElement>(
        '[data-detail-head], [data-detail-tools], h1',
      );
      const container = element.getBoundingClientRect();
      return [...nodes].flatMap((node) => {
        const box = node.getBoundingClientRect();
        return box.left >= container.left && box.right <= container.right
          ? []
          : [{ node: node.tagName, left: box.left, right: box.right, width: container.width }];
      });
    });
    expect(geometry).toEqual([]);
    await expect(title(page)).toHaveAttribute('data-size', 'title2');
    const glow = page$(page).locator(':scope > [data-cover-glow]');
    await expect(glow).toHaveCount(1);
    const intro = await page$(page).locator('[data-detail-intro]').boundingBox();
    const background = await glow.boundingBox();
    const view = await page$(page).boundingBox();
    expect((background?.x ?? 0) + (background?.width ?? 0)).toBeCloseTo(
      (view?.x ?? 0) + (view?.width ?? 0),
      0,
    );
    expect((background?.y ?? 0) + (background?.height ?? 0)).toBeCloseTo(
      (intro?.y ?? 0) + (intro?.height ?? 0),
      0,
    );
    await expect(glow).toHaveCSS('pointer-events', 'none');
    await expect(page$(page).locator('[data-detail-sort-direction]')).toBeVisible();
  });
}
