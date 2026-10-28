import { expect, test, type Locator, type Page } from '@playwright/test';
import { searchQuery } from '../../src/library/search/searchQuery.ts';
import { SEARCH_HISTORY_KEY } from '../../src/library/search/searchHistory.ts';
import { albumsAnswer } from '../fixtures/albumLibrary.ts';
import { numberParam, stringParam } from '../fixtures/hostAnswers.ts';
import { albumTrackRow } from '../fixtures/libraryRows.ts';
import { trackPathOf } from '../../src/host/libraryContract.ts';
import { trackSortPattern } from '../../src/track/trackSort.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { SONG_ALBUMS, SONG_TRACKS } from '../fixtures/songsPage.ts';

test.use({ screenshot: 'off' });

const BULK_TRACKS = Array.from({ length: 320 }, (_, index) =>
  albumTrackRow('Modal Soul', 'Nujabes', `Match ${String(index).padStart(4, '0')}`, {
    trackNumber: index + 10,
  }),
);

async function openSearch(page: Page) {
  const errors = collectPageErrors(page);
  const matches = new Map([
    [searchQuery('Nujabes')?.query, SONG_TRACKS.filter((track) => track.artist === 'Nujabes')],
    [searchQuery('Feather')?.query, SONG_TRACKS.filter((track) => track.title === 'Feather')],
    [searchQuery('none')?.query, []],
    [searchQuery('Match')?.query, BULK_TRACKS],
  ]);
  const host = await installPageHost(page, {
    config: { [SEARCH_HISTORY_KEY]: ['Nujabes', 'Feather'] },
    answers: {
      library: {
        getAlbums: albumsAnswer(SONG_ALBUMS),
        // 「曲目」一类的表格按 handle 从整库曲目里取行
        getAll: {
          success: true,
          tracks: [...SONG_TRACKS, ...BULK_TRACKS],
          items: [...SONG_TRACKS, ...BULK_TRACKS],
          total: SONG_TRACKS.length + BULK_TRACKS.length,
          offset: 0,
        },
        query: (params) => {
          const hits = matches.get(stringParam(params, 'query')) ?? [];
          return {
            success: true,
            tracks: hits.slice(0, numberParam(params, 'limit') ?? 100),
            total: hits.length,
          };
        },
        getAlbumTracks: (params) => {
          const album = stringParam(params, 'album');
          const albumArtist = stringParam(params, 'albumArtist');
          const tracks = [...SONG_TRACKS, ...BULK_TRACKS].filter(
            (track) => track.album === album && track.albumArtist === albumArtist,
          );
          return { success: true, album, albumArtist, tracks, items: tracks, total: tracks.length };
        },
      },
    },
  });
  await page.goto('/');
  // 主窗等偏好存储读完才建服务、渲染，load 之后按键要等它挂上。
  await expect(page.locator('main')).toBeVisible();
  const input = page.locator('[data-search-input="sidebar"]:visible');
  const flyout = page.locator('[data-search-flyout]');
  return { host, errors, input, flyout };
}

/** 结果页「曲目」一类的表格里，各行的标题格 */
function trackTitles(view: Locator) {
  return view
    .getByRole('treegrid', { name: '曲目' })
    .locator('[role="gridcell"][data-column-id="title"]');
}

function trackRow(view: Locator, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return view
    .getByRole('treegrid', { name: '曲目' })
    .getByRole('row', { name: new RegExp(`(^|\\s)${escaped}(\\s|$)`) });
}

test('侧栏搜索可用，最近历史可单条删除和清空，Esc 先关闭再清词', async ({ page }) => {
  const { host, errors, input, flyout } = await openSearch(page);
  await expect(input).toBeEnabled();
  await input.focus();
  await expect(flyout.getByRole('option', { name: 'Nujabes', exact: true })).toBeVisible();
  await flyout.getByRole('button', { name: '移除「Feather」' }).click();
  await expect(flyout.getByRole('option')).toHaveCount(1);
  await flyout.getByRole('button', { name: '清空历史' }).click();
  await expect(flyout.getByRole('option')).toHaveCount(0);
  await expect.poll(() => host.config.get(SEARCH_HISTORY_KEY)).toEqual([]);
  await input.fill('Nujabes');
  await input.press('Escape');
  await expect(flyout).toHaveCount(0);
  await expect(input).toHaveValue('Nujabes');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(flyout).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('最佳匹配不自动选中，Enter 进入结果页，分类不增加导航历史', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  await expect(flyout.getByRole('option')).toHaveCount(4);
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await expect(view.getByRole('heading', { level: 1 })).toHaveText('Nujabes');
  await expect(flyout).toHaveCount(0);
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await expect(trackTitles(view)).toHaveCount(2);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('[data-page="search"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('建议键盘进入专辑，后退恢复原页面、查询、浮层与焦点', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  await expect(flyout.getByRole('option')).toHaveCount(4);
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', /album/);
  await input.press('Enter');
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await expect(flyout).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(flyout).toBeVisible();
  await expect(input).toHaveValue('Nujabes');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-activedescendant', /album/);
  expect(errors).toEqual([]);
});

test('最佳匹配可以是艺人并打开艺人页；节头「查看 N 张」进结果页的专辑类', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  await expect(flyout.getByRole('option')).toHaveCount(4);
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', /artist/);
  await input.press('Enter');
  await expect(page.locator('[data-page="artists"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(flyout).toBeVisible();
  await flyout.getByRole('button', { name: '查看 1 张', exact: true }).click();
  const view = page.locator('[data-page="search"]');
  await expect(view.getByRole('tab', { name: '专辑', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await view.getByRole('tab', { name: '艺人', exact: true }).click();
  await expect(view.getByRole('option', { name: /Nujabes/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('结果页打开专辑后返回恢复分类；编辑草稿不改变已提交结果', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  await input.press('Enter');
  let view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '专辑', exact: true }).click();
  const list = view.getByRole('listbox', { name: '专辑', exact: true });
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  view = page.locator('[data-page="search"]');
  await expect(view.getByRole('tab', { name: '专辑', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await view.getByRole('button', { name: '编辑搜索' }).click();
  await input.fill('Feather');
  await expect(flyout.getByRole('option')).toHaveCount(1);
  await expect(view.getByRole('heading', { level: 1 })).toHaveText('Nujabes');
  await input.press('Enter');
  await expect(
    page.locator('[data-page="search"]').getByRole('heading', { level: 1, name: 'Feather' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('从专辑页后退回结果页：过渡期间版式位置不变，结果区不误播切分类的上滑', async ({ page }) => {
  const { errors, input } = await openSearch(page);
  await input.fill('Nujabes');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '专辑', exact: true }).click();
  const list = view.getByRole('listbox', { name: '专辑', exact: true });
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  // offsetTop 不受过渡的缩放影响，只反映版式：离场的专辑页带封面光晕，它被移走时不能让新页面整体下移
  const sampled = page.evaluate(
    () =>
      new Promise<{ top: number; sliding: number }[]>((done) => {
        const frames: { top: number; sliding: number }[] = [];
        const start = performance.now();
        const tick = () => {
          const search = document.querySelector<HTMLElement>('[data-page="search"]');
          const scroller = search?.querySelector('[data-search-scroller]');
          if (search && scroller) {
            frames.push({ top: search.offsetTop, sliding: scroller.getAnimations().length });
          }
          if (performance.now() - start < 600) requestAnimationFrame(tick);
          else done(frames);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.press('Alt+ArrowLeft');
  const frames = await sampled;
  expect(frames.length).toBeGreaterThan(10);
  expect(new Set(frames.map((frame) => frame.top)).size, JSON.stringify(frames)).toBe(1);
  expect(frames.every((frame) => frame.sliding === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('IME 组词期间 Enter 不导航，不发中间态查询', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.focus();
  await input.dispatchEvent('compositionstart');
  await input.fill('Nujabes');
  await input.press('Enter');
  await expect(page.locator('[data-page="search"]')).toHaveCount(0);
  expect(host.callsTo('library.query')).toEqual([]);
  await input.dispatchEvent('compositionend', { data: 'Nujabes' });
  await input.press('Enter');
  await expect(page.locator('[data-page="search"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('390 窄窗 Ctrl+F 打开输入浮层，快速关开及减弱动效后仍可提交', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const { errors, flyout } = await openSearch(page);
  await page.keyboard.press('Control+f');
  const input = page.locator('[data-search-input="flyout"]');
  await expect(input).toBeFocused();
  await input.fill('Nujabes');
  await input.press('Escape');
  await page.keyboard.press('Control+f');
  await expect(input).toBeFocused();
  await expect(flyout).not.toHaveAttribute('inert');
  const box = await flyout.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await input.press('Enter');
  await expect(page.locator('[data-page="search"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('900 图标态放大镜可用，未连接宿主也能进入并显示明确状态', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.locator('[data-search-trigger]').click();
  const input = page.locator('[data-search-input="flyout"]');
  await expect(input).toBeFocused();
  await input.fill('Nujabes');
  await expect(page.locator('[data-search-flyout]')).toContainText('未连接 foobar2000', {
    timeout: 10000,
  });
  expect(errors).toEqual([]);
});

test('搜索打开时跨宽度档，输入和焦点跟随当前入口', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  await page.setViewportSize({ width: 900, height: 700 });
  const popupInput = page.locator('[data-search-input="flyout"]');
  await expect(popupInput).toBeFocused();
  await expect(popupInput).toHaveValue('Nujabes');
  await page.setViewportSize({ width: 390, height: 540 });
  await expect(popupInput).toBeFocused();
  const box = await flyout.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 444).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Nujabes');
  await input.press('Enter');
  await expect(page.locator('[data-page="search"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('正常动效快速反向开合后只保留一个可交互浮层', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  for (let index = 0; index < 10; index++) {
    await input.press('Escape');
    await page.keyboard.press('Control+f');
  }
  await expect(flyout).toHaveCount(1);
  await expect(flyout).not.toHaveAttribute('inert');
  await expect(input).toBeFocused();
  await input.press('Enter');
  await expect(flyout).toHaveCount(0);
  await expect(page.locator('[data-page="search"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('曲目回车按整张专辑起播，晚到成功不关闭新词的建议', async ({ page }) => {
  const { host, errors, input, flyout } = await openSearch(page);
  await input.fill('Feather');
  await expect(flyout.getByRole('option')).toHaveCount(1);
  const held = host.hold('library.getAlbumTracks');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect.poll(() => held.pending.length).toBe(1);
  await input.fill('Nujabes');
  held.release();
  await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
  await expect(input).toHaveValue('Nujabes');
  await expect(flyout).toBeVisible();
  await expect(page.locator('[data-page="search"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('键盘可到达历史管理按钮，删除后焦点回到输入框', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.focus();
  await expect(flyout.getByRole('option')).toHaveCount(2);
  // 键盘序：输入框 → 两枚范围页签（各占一个 Tab 停靠点）→ 清空历史 → 各条的移除键
  await input.press('Tab');
  await expect(flyout.getByRole('tab', { name: '媒体库' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(flyout.getByRole('tab', { name: '在线音乐' })).toBeFocused();
  await page.keyboard.press('Tab');
  const clear = flyout.getByRole('button', { name: '清空历史' });
  await expect(clear).toBeFocused();
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('Tab');
  const remove = flyout.getByRole('button', { name: '移除「Nujabes」' });
  await expect(remove).toBeFocused();
  await remove.press('Enter');
  await expect(input).toBeFocused();
  await expect(flyout.getByRole('option')).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const width of [1280, 900, 390]) {
  test(`${width} 折叠态管理搜索历史不改变浮层锚点`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() =>
      localStorage.setItem('default-theme.sidebar.v1', JSON.stringify({ rail: true })),
    );
    const { host, errors, flyout } = await openSearch(page);
    const trigger = page.locator('[data-search-trigger]:visible');
    if (width > 640) await trigger.click();
    else await page.keyboard.press('Control+f');
    const input = page.locator('[data-search-input="flyout"]');
    await expect(input).toBeFocused();
    await expect(flyout.getByRole('option')).toHaveCount(2);
    const position = () => flyout.evaluate((node) => [node.style.left, node.style.top]);
    const before = await position();
    await flyout.getByRole('button', { name: '移除「Feather」' }).click();
    await expect(input).toBeFocused();
    await expect(flyout.getByRole('option')).toHaveCount(1);
    expect.soft(await position()).toEqual(before);
    await flyout.getByRole('button', { name: '清空历史' }).click();
    await expect(input).toBeFocused();
    await expect(flyout.getByRole('option')).toHaveCount(0);
    await expect.poll(() => host.config.get(SEARCH_HISTORY_KEY)).toEqual([]);
    expect.soft(await position()).toEqual(before);
    await page.keyboard.press('Control+f');
    await expect(input).toBeFocused();
    expect.soft(await position()).toEqual(before);
    await input.press('Escape');
    await expect(flyout).toHaveCount(0);
    if (width > 640) await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('曲目表按 handle 一次取全命中，只画看得见的行；分类切换不新增历史', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await expect(trackTitles(view).first()).toHaveText('Match 0000');
  const compiled = searchQuery('Match');
  expect(
    host
      .callsTo('library.query')
      .filter((call) => call['query'] === compiled?.query && call['fields'] !== undefined),
  ).toEqual([
    expect.objectContaining({ sort: compiled?.sort, fields: ['handle'] }),
    expect.objectContaining({ sort: compiled?.sort, fields: ['handle'] }),
  ]);
  await expect.poll(() => trackTitles(view).count()).toBeLessThan(80);
  const scroller = view.locator('[data-search-scroller]');
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(trackTitles(view).filter({ hasText: 'Match 0319' })).toBeVisible();
  await expect.poll(() => trackTitles(view).count()).toBeLessThan(80);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('筛选只收窄曲目表：勾了条件出条件行，筛完没有时可一键清除', async ({ page }) => {
  const { errors, input } = await openSearch(page);
  await input.fill('Nujabes');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await expect(trackTitles(view)).toHaveCount(2);
  await view.locator('[data-filter-toggle]').click();
  await page.locator('[data-preset-chips] [data-preset="lossless"]').click();
  await page.keyboard.press('Escape');
  await expect(view.locator('[data-query-condition="preset:lossless"]')).toBeVisible();
  // 替身只认没有条件的查询，筛完一首都没有
  await expect(view.locator('[data-search-empty="filtered"]')).toBeVisible();
  await expect(view.getByRole('heading', { level: 1 })).toHaveText('Nujabes');
  await view.getByRole('button', { name: '清除全部筛选', exact: true }).click();
  await expect(trackTitles(view)).toHaveCount(2);
  expect(errors).toEqual([]);
});
test('列头排序三态，离开后返回恢复分类与排序', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await expect(trackTitles(view).first()).toHaveText('Match 0000');
  const lastSort = () => host.callsTo('library.query').at(-1)?.['sort'];
  const header = view.getByRole('columnheader', { name: '标题' });
  await header.click();
  await expect.poll(lastSort).toBe(trackSortPattern('title'));
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await header.click();
  await expect.poll(lastSort).toBe(searchQuery('Match')?.sort);
  await header.click();
  await expect.poll(lastSort).toBe(trackSortPattern('title'));
  await trackRow(view, 'Match 0002').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '转到专辑', exact: true }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(view.getByRole('tab', { name: '曲目', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(view.getByRole('columnheader', { name: '标题' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  expect(errors).toEqual([]);
});
test('搜索曲目右键出曲目菜单，只发送落点曲目；键盘也可打开', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Feather');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await trackRow(view, 'Feather').click({ button: 'right' });
  const menu = page.locator('[data-track-menu]').first();
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '播放', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
  await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
  const feather = SONG_TRACKS.find((track) => track.title === 'Feather');
  if (!feather) throw new Error('缺少 Feather');
  await expect
    .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
    .toEqual([trackPathOf(feather)]);
  await trackRow(view, 'Feather').click();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});
for (const colorScheme of ['light', 'dark'] as const) {
  test(`曲目多选不跳转，批量发送；回车按整张专辑起播（${colorScheme}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { host, errors, input } = await openSearch(page);
    await input.fill('Nujabes');
    await input.press('Enter');
    const view = page.locator('[data-page="search"]');
    await view.getByRole('tab', { name: '曲目', exact: true }).click();
    const grid = view.getByRole('treegrid', { name: '曲目' });
    const nujabes = SONG_TRACKS.filter((track) => track.artist === 'Nujabes');
    const first = trackRow(view, nujabes[0]?.title ?? '');
    const last = trackRow(view, nujabes.at(-1)?.title ?? '');
    await first.click();
    await last.click({ modifiers: ['Control'] });
    await expect(view).toBeVisible();
    await expect(grid.locator('[role="row"][aria-selected="true"]')).toHaveCount(2);
    await last.click({ button: 'right' });
    await expect(page.locator('[data-track-menu] [data-menu-caption]')).toContainText('2 首');
    await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
    await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
    await expect
      .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
      .toEqual(nujabes.map(trackPathOf));
    await first.click();
    await page.keyboard.press('Enter');
    await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
    expect(errors).toEqual([]);
  });
}
test('曲目表 Ctrl+A 选中全部命中，批量发送不遗漏没画出来的行', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await trackRow(view, 'Match 0000').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-track-menu] [data-menu-caption]')).toContainText('320 首');
  await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
  await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
  await expect
    .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
    .toEqual(BULK_TRACKS.map(trackPathOf));
  expect(errors).toEqual([]);
});
test('曲目表的行取自整库曲目，混着标签不全的曲目也能批量评分与发送', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  const known = SONG_TRACKS[0]!;
  const unknown = albumTrackRow('Unknown', 'Unknown Artist', 'Unknown Track');
  host.answer('library.query', { success: true, tracks: [known, unknown], total: 2 });
  host.answer('library.getAll', {
    success: true,
    tracks: [known, unknown],
    items: [known, unknown],
    total: 2,
    offset: 0,
  });
  await input.fill('Mixed');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await trackRow(view, known.title).click();
  await page.keyboard.press('Control+a');
  const grid = view.getByRole('treegrid', { name: '曲目' });
  await expect(grid.locator('[role="row"][aria-selected="true"]')).toHaveCount(2);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '发送到', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: '评分', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
test('网格专辑菜单可打开详情，改查询会作废旧菜单', async ({ page }) => {
  const { errors, input } = await openSearch(page);
  await input.fill('Nujabes');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '专辑', exact: true }).click();
  await view.getByLabel('网格视图', { exact: true }).click();
  await view.getByRole('option').click({ button: 'right' });
  await expect(page.locator('[data-search-menu]')).toBeVisible();
  await page.getByRole('menuitem', { name: '打开专辑详情', exact: true }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(view.locator('[data-search-list]')).toHaveAttribute('data-search-view', 'grid');
  await view.getByRole('option').click({ button: 'right' });
  await page.keyboard.press('Control+f');
  await input.fill('Feather');
  await input.press('Enter');
  await expect(page.locator('[data-search-menu]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`390 分类收成下拉，网格和菜单不越界，键盘可操作（${colorScheme}）`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 540 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { errors } = await openSearch(page);
    await page.keyboard.press('Control+f');
    const input = page.locator('[data-search-input="flyout"]');
    await input.fill('Nujabes');
    await input.press('Enter');
    const view = page.locator('[data-page="search"]');
    await expect(view.getByRole('tab', { name: '专辑', exact: true })).toHaveCount(0);
    await view.locator('[data-search-category]').click();
    await page.getByRole('menuitemradio', { name: '专辑', exact: true }).click();
    await expect(view.locator('[data-search-category]')).toHaveAttribute(
      'data-search-category',
      'albums',
    );
    await view.getByLabel('网格视图', { exact: true }).click();
    const list = view.locator('[data-search-list]');
    await expect(list.getByRole('option').first()).toBeVisible();
    await expect
      .poll(() =>
        view
          .locator('[data-search-scroller]')
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await list.focus();
    await page.keyboard.press('ArrowDown');
    await expect(list).toHaveAttribute('aria-activedescendant', /album/);
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('[data-search-menu]').first();
    await expect(menu).toBeVisible();
    await expect
      .poll(() => menu.evaluate((node) => node.getBoundingClientRect().left))
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => menu.evaluate((node) => node.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(540);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(list).toBeFocused();
    expect(errors).toEqual([]);
  });
}
