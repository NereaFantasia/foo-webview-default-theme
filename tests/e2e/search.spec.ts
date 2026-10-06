import { expect, test, type Page } from '@playwright/test';
import { searchQuery } from '../../src/library/search/searchQuery.ts';
import { SEARCH_HISTORY_KEY } from '../../src/library/search/searchHistory.ts';
import { albumsAnswer } from '../fixtures/albumLibrary.ts';
import { hostFailure, numberParam, stringParam } from '../fixtures/hostAnswers.ts';
import { albumTrackRow } from '../fixtures/libraryRows.ts';
import { trackPathOf } from '../../src/host/libraryContract.ts';
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
  await expect(flyout.getByRole('option')).toHaveCount(3);
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await expect(view.getByRole('heading', { level: 1 })).toHaveText('Nujabes');
  await expect(flyout).toHaveCount(0);
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await expect(view.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('[data-page="search"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('建议键盘进入专辑，后退恢复原页面、查询、浮层与焦点', async ({ page }) => {
  const { errors, input, flyout } = await openSearch(page);
  await input.fill('Nujabes');
  await expect(flyout.getByRole('option')).toHaveCount(3);
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
  await input.press('Tab');
  const clear = flyout.getByRole('button', { name: '清空历史' });
  await expect(clear).toBeFocused();
  await clear.press('Shift+Tab');
  await expect(input).toBeFocused();
  await input.press('Tab');
  await page.keyboard.press('Tab');
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

test('列表按近尾位置续取，网格切换不新增历史，DOM 数量保持有界', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  const list = view.locator('[data-search-list]');
  await expect(list.getByRole('option').first()).toBeVisible();
  const first = list.getByRole('option').first();
  await first.evaluate((node) => node.setAttribute('data-retained', 'yes'));
  const scroller = view.locator('[data-search-scroller]');
  await scroller.evaluate((node) => {
    node.scrollTop = 80;
  });
  await expect(list.locator('[data-retained="yes"]')).toHaveCount(1);
  await scroller.evaluate((node) => {
    node.scrollTop = 5100;
  });
  await expect
    .poll(() => host.callsTo('library.query').some((call) => call['limit'] === 200))
    .toBe(true);
  await expect.poll(() => list.getByRole('option').count()).toBeLessThan(50);
  await view.getByLabel('网格视图', { exact: true }).click();
  await expect(list).toHaveAttribute('data-search-view', 'grid');
  await expect.poll(() => list.getByRole('option').count()).toBeLessThan(100);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('续取失败不抹掉旧项，也不自动重试；显式重试后继续', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  await expect(view.getByRole('option').first()).toBeVisible();
  host.answer('library.query', (params) =>
    (numberParam(params, 'limit') ?? 0) > 100
      ? hostFailure('OPERATION_FAILED', 'failed')
      : { success: true, tracks: BULK_TRACKS.slice(0, 100), total: BULK_TRACKS.length },
  );
  const scroller = view.locator('[data-search-scroller]');
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(view.locator('[data-search-more]').getByRole('button')).toHaveText('重试');
  await expect(view.getByRole('option').first()).toBeVisible();
  const attempts = host
    .callsTo('library.query')
    .filter((call) => Number(call['limit']) > 100).length;
  await scroller.evaluate((node) => {
    node.scrollTop -= 150;
  });
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(host.callsTo('library.query').filter((call) => Number(call['limit']) > 100)).toHaveLength(
    attempts,
  );
  host.answer('library.query', (params) => ({
    success: true,
    tracks: BULK_TRACKS.slice(0, numberParam(params, 'limit') ?? 100),
    total: BULK_TRACKS.length,
  }));
  await view.locator('[data-search-more]').getByRole('button').click();
  await expect(view.locator('[data-search-more]').getByRole('button')).toHaveText('加载更多');
  expect(errors).toEqual([]);
});

test('返回搜索补回已加载前缀，恢复深处滚动和视图', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  const scroller = view.locator('[data-search-scroller]');
  await expect(view.getByRole('option').first()).toBeVisible();
  await scroller.evaluate((node) => {
    node.scrollTop = 5100;
  });
  await expect
    .poll(() => host.callsTo('library.query').some((call) => call['limit'] === 200))
    .toBe(true);
  await expect(view.locator('[data-search-more]').getByRole('button')).toBeEnabled();
  await scroller.evaluate((node) => {
    node.scrollTop = 7840;
  });
  await view.getByRole('option').filter({ hasText: 'Match 0140' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '转到专辑', exact: true }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(view.getByRole('tab', { name: '曲目', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(7000);
  await expect(view.getByRole('option').filter({ hasText: 'Match 0140' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('搜索曲目右键复用发送菜单，只发送落点曲目；键盘也可打开', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Feather');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  const list = view.getByRole('listbox', { name: '曲目', exact: true });
  await list.getByRole('option').click({ button: 'right' });
  const menu = page.locator('[data-search-menu]').first();
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '播放', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
  await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
  const feather = SONG_TRACKS.find((track) => track.title === 'Feather');
  if (!feather) throw new Error('缺少 Feather');
  await expect
    .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
    .toEqual([trackPathOf(feather)]);
  await list.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(list).toBeFocused();
  expect(errors).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`分类结果多选不跳转，切换视图保留选择并批量发送（${colorScheme}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { host, errors, input } = await openSearch(page);
    await input.fill('Nujabes');
    await input.press('Enter');
    const view = page.locator('[data-page="search"]');
    await view.getByRole('tab', { name: '曲目', exact: true }).click();
    const list = view.locator('[data-search-list]');
    const rows = list.getByRole('option');
    await rows.first().click();
    await rows.last().click({ modifiers: ['Control'] });
    await expect(view).toBeVisible();
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(2);
    await view.getByLabel('网格视图', { exact: true }).click();
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(2);
    await rows.last().click({ button: 'right' });
    await expect(page.locator('[data-search-menu] [data-menu-caption]')).toContainText('2 首');
    await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
    await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
    await expect
      .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
      .toEqual(SONG_TRACKS.filter((track) => track.artist === 'Nujabes').map(trackPathOf));
    await rows.first().click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(2);
    await rows.first().click();
    await rows.last().click({ button: 'right' });
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect.poll(() => host.callsTo('playlist.playTrack').length).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('搜索 Ctrl+A 先读取完整结果，批量发送不遗漏未加载曲目', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  const list = view.locator('[data-search-list]');
  await list.getByRole('option').first().click();
  await page.keyboard.press('Control+a');
  await expect.poll(() => host.callsTo('library.query').at(-1)?.['limit']).toBe(320);
  await expect.poll(() => list.locator('[aria-selected="false"]').count()).toBe(0);
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-search-menu] [data-menu-caption]')).toContainText('320 首');
  await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
  await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
  await expect
    .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
    .toEqual(BULK_TRACKS.map(trackPathOf));
  expect(errors).toEqual([]);
});

test('全选读取期间改选，晚到的完整结果不能覆盖新选择', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  await input.fill('Match');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  const list = view.locator('[data-search-list]');
  await list.getByRole('option').first().click();
  const held = host.hold('library.query');
  await page.keyboard.press('Control+a');
  await expect.poll(() => held.pending.length).toBe(1);
  await list.getByRole('option').nth(1).click();
  held.release();
  await expect(view.locator('[data-search-more]')).toHaveCount(0);
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(list.locator('[aria-selected="true"]')).toContainText('Match 0001');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-search-menu] [data-menu-caption]')).toContainText('Match 0001');
  expect(errors).toEqual([]);
});

test('部分搜索曲目缺少完整标签时，批量评分不可用且不影响整批发送', async ({ page }) => {
  const { host, errors, input } = await openSearch(page);
  const known = SONG_TRACKS[0]!;
  const unknown = albumTrackRow('Unknown', 'Unknown Artist', 'Unknown Track');
  host.answer('library.query', { success: true, tracks: [known, unknown], total: 2 });
  await input.fill('Mixed');
  await input.press('Enter');
  const view = page.locator('[data-page="search"]');
  await view.getByRole('tab', { name: '曲目', exact: true }).click();
  const list = view.locator('[data-search-list]');
  await list.getByRole('option').first().click();
  await page.keyboard.press('Control+a');
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(2);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '发送到', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: '评分', exact: true })).toBeDisabled();
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
  test(`390 网格和菜单不越界，键盘可操作（${colorScheme}）`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 540 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { errors } = await openSearch(page);
    await page.keyboard.press('Control+f');
    const input = page.locator('[data-search-input="flyout"]');
    await input.fill('Match');
    await input.press('Enter');
    const view = page.locator('[data-page="search"]');
    await view.getByRole('tab', { name: '曲目', exact: true }).click();
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
    await expect(list).toHaveAttribute('aria-activedescendant', /track/);
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('[data-search-menu]').first();
    await expect(menu).toBeVisible();
    await expect
      .poll(() => menu.evaluate((node) => node.getBoundingClientRect().left))
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => menu.evaluate((node) => node.getBoundingClientRect().right))
      .toBeLessThanOrEqual(390);
    await expect
      .poll(() => menu.evaluate((node) => node.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(540);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(list).toBeFocused();
    expect(errors).toEqual([]);
  });
}
