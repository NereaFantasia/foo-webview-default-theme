import { trackRow } from '../fixtures/libraryRows.ts';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openSongs, SONG_TRACKS } from '../fixtures/songsPage.ts';
import { openFolders } from '../fixtures/foldersPage.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';

async function expectPlaceholderFits(input: Locator) {
  await expect(input).toBeVisible();
  await expect
    .poll(() =>
      input.evaluate((element: HTMLInputElement) => {
        const style = getComputedStyle(element);
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('无法测量提示文字');
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = context.measureText(element.placeholder).width;
        const available =
          element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return available - text;
      }),
    )
    .toBeGreaterThanOrEqual(0);
}

/** 经搜索框末尾的字段菜单切换普通搜索与高级查询。 */
async function setMode(page: Page, view: Locator, mode: 'advanced' | 'text') {
  await view.locator('[data-query-scope]').click();
  await page.locator(`[data-query-mode="${mode}"]`).click();
}

/** 输入框里留给文字的宽度，像素。 */
const typingWidth = (input: Locator) =>
  input.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });

/** 命令栏是一行：高不超过 40，栏里的键都在栏内。 */
const barFits = (view: Locator) =>
  view.locator('[data-command-bar]').evaluate((bar) => {
    const bounds = bar.getBoundingClientRect();
    const keys = [...bar.querySelectorAll('button, input')].map((key) =>
      key.getBoundingClientRect(),
    );
    return (
      bounds.height <= 40 &&
      keys.every(
        (key) =>
          key.width === 0 ||
          (key.x >= bounds.x - 0.5 &&
            key.right <= bounds.right + 0.5 &&
            key.y >= bounds.y - 0.5 &&
            key.bottom <= bounds.bottom + 0.5),
      )
    );
  });

test('模式保留两份草稿，清词不清常用条件，Esc 先关菜单再清词', async ({ page }) => {
  const songs = await openSongs(page);
  const field = songs.view.locator('[data-query-scope]');
  await songs.box.fill('massive');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await setMode(page, songs.view, 'advanced');
  await expect(field).toHaveAttribute('data-query-scope', 'advanced');
  await expect(songs.box).toHaveValue('');
  await songs.box.fill('genre IS "Trip-Hop"');
  await songs.box.press('Enter');
  await expect(songs.subtitle).toHaveText(/^4 首/);
  await setMode(page, songs.view, 'text');
  await expect(songs.box).toHaveValue('massive');
  await songs.view.locator('[data-filter-toggle]').click();
  await page.locator('[data-preset-chips] [data-preset="lossless"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-filter-surface]')).toHaveCount(0);
  await songs.box.press('Alt+ArrowDown');
  const menu = page.getByRole('menu', { name: '搜索范围' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(songs.box).toHaveValue('massive');
  await songs.box.press('Escape');
  await expect(songs.box).toHaveValue('');
  await expect(songs.view.locator('[data-query-condition="preset:lossless"]')).toBeVisible();
  await setMode(page, songs.view, 'advanced');
  await expect(songs.box).toHaveValue('genre IS "Trip-Hop"');
  expect(songs.errors).toEqual([]);
});

test('普通输入不猜测语法；语法示例写进高级草稿并选中参数，文字草稿保留', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('? 100%');
  await expect(songs.view.locator('[data-query-scope]')).toHaveAttribute('data-query-scope', 'all');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await setMode(page, songs.view, 'advanced');
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-snippet="format"]').click();
  await expect(songs.box).toHaveValue('%codec% IS flac');
  expect(
    await songs.box.evaluate((input: HTMLInputElement) =>
      input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
    ),
  ).toBe('flac');
  await setMode(page, songs.view, 'text');
  await expect(songs.box).toHaveValue('? 100%');
  expect(songs.errors).toEqual([]);
});

test('组词期间不请求、不执行回车或 Esc，结束组词才发布最终文字', async ({ page }) => {
  const songs = await openSongs(page);
  const before = songs.host.callsTo('library.query').length;
  await songs.box.focus();
  await songs.box.dispatchEvent('compositionstart', { data: '' });
  await songs.box.fill('mass');
  await songs.box.press('Enter');
  await songs.box.press('Escape');
  await expect(songs.box).toHaveValue('mass');
  // 超过查询去抖窗口仍不能发送组词中间态。
  await page.waitForTimeout(400);
  expect(songs.host.callsTo('library.query')).toHaveLength(before);
  await songs.box.fill('massive');
  await songs.box.dispatchEvent('compositionend', { data: 'massive' });
  await songs.box.press('Enter');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  expect(songs.host.callsTo('library.query').at(-1)?.query).toContain('HAS "massive"');
  expect(songs.errors).toEqual([]);
});

test('离开歌曲页再后退恢复模式和两份草稿', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('massive');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await setMode(page, songs.view, 'advanced');
  await songs.box.fill('genre IS "Trip-Hop"');
  await songs.box.press('Enter');
  await expect(songs.subtitle).toHaveText(/^4 首/);
  await songs.row('Teardrop').getByRole('button', { name: 'Mezzanine' }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(songs.box).toHaveValue('genre IS "Trip-Hop"');
  await expect(songs.view.locator('[data-query-scope]')).toHaveAttribute(
    'data-query-scope',
    'advanced',
  );
  await setMode(page, songs.view, 'text');
  await expect(songs.box).toHaveValue('massive');
  expect(songs.errors).toEqual([]);
});

test('文件夹使用同一模式切换与独立草稿，目录定位不受影响', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  const box = env.view.locator('input[data-query-input]');
  await box.fill('Amber');
  await box.press('Enter');
  await expect
    .poll(() => env.host.callsTo('library.search').at(-1)?.query)
    .toContain('HAS "amber"');
  await setMode(page, env.view, 'advanced');
  await expect(box).toHaveValue('');
  await box.fill('title IS "Zebra"');
  await box.press('Enter');
  await expect
    .poll(() => env.host.callsTo('library.search').at(-1)?.query)
    .toBe('title IS "Zebra"');
  await setMode(page, env.view, 'text');
  await expect(box).toHaveValue('Amber');
  await env.locate();
  await expect(env.box).toHaveValue('');
  expect(env.errors).toEqual([]);
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme} 下搜索框高度固定，清空与条件计数不移动字段键；窄档收成搜索键`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const songs = await openSongs(page);
    await expectPlaceholderFits(songs.box);
    const surface = songs.view.locator('[data-query-box] .fui-Input');
    expect((await surface.boundingBox())?.height).toBe(32);
    const field = songs.view.locator('[data-query-scope]');
    const before = await field.boundingBox();
    await songs.box.fill('massive');
    expect(await field.boundingBox()).toEqual(before);
    await songs.view.locator('[data-filter-toggle]').click();
    await page.locator('[data-preset-chips] [data-preset="lossless"]').click();
    await page.keyboard.press('Escape');
    expect(await field.boundingBox()).toEqual(before);
    await songs.view.locator('[data-query-clear]').click();
    expect(await field.boundingBox()).toEqual(before);
    await page.setViewportSize({ width: 390, height: 800 });
    const open = songs.view.locator('[data-command-search-open]');
    await expect(open).toBeVisible();
    const key = await open.boundingBox();
    expect(key && key.width === 32 && key.height === 32 && key.x + key.width <= 390).toBeTruthy();
    const filter = await songs.view.locator('[data-filter-toggle]').boundingBox();
    expect(filter?.width).toBe(32);
    await open.click();
    await expect(songs.box).toBeFocused();
    await expectPlaceholderFits(songs.box);
    await songs.box.press('Escape');
    await expect(open).toBeFocused();
    expect(songs.errors).toEqual([]);
  });
}

test('文件夹默认占位提示在宽中窄窗口内完整显示', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  const input = env.view.locator('input[data-query-input]');
  await expect(input).toHaveAttribute('placeholder', '搜索曲目');
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await expectPlaceholderFits(input);
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await env.view.locator('[data-command-search-open]').click();
  await expectPlaceholderFits(input);
  expect(env.errors).toEqual([]);
});

test('文件夹：中英文长字段在各宽度下不挤没输入区，命令栏单行不越界', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const folders = await openFolders(page);
  await folders.folder('Alpha').click();
  for (const language of ['zh-CN', 'en']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    if (language === 'en') {
      folders.host.config.set('defaultTheme.locale', 'en');
      await page.reload();
      await page
        .getByRole('navigation', { name: 'Sidebar' })
        .getByRole('button', { name: 'Folders', exact: true })
        .click();
      await folders.view
        .getByRole('tree')
        .getByRole('button', { name: 'Expand', exact: true })
        .first()
        .click();
      await folders.view.getByRole('treeitem').filter({ hasText: 'Alpha' }).click();
    }
    await folders.view.locator('[data-query-scope]').click();
    await page
      .getByRole('menuitemradio', {
        name: language === 'en' ? 'Album artist' : '专辑艺人',
        exact: true,
      })
      .click();
    const input = folders.view.locator('input[data-query-input]');
    await input.fill('a');
    for (const width of [1280, 1000, 900, 800, 640]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => typingWidth(input)).toBeGreaterThanOrEqual(48);
      await expect.poll(() => barFits(folders.view)).toBe(true);
      await expect(input).toHaveValue('a');
    }
    await page.setViewportSize({ width: 390, height: 800 });
    await folders.view.locator('[data-command-search-open]').click();
    await expect.poll(() => typingWidth(input)).toBeGreaterThanOrEqual(48);
    await expect(input).toHaveValue('a');
    await folders.view.locator('[data-command-search-close]').click();
  }
  expect(folders.errors).toEqual([]);
});

test('播放列表的过滤框各宽度可输入，视图键贴着命令栏右端', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await openPlaylist(page, 'Mix');
  const input = env.view.locator('input[data-playlist-filter]');
  await input.fill('a');
  for (const width of [1280, 1000, 900, 800, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() => env.view.locator('[data-command-bar]').getAttribute('data-tier'))
      .toMatch(/wide|medium|narrow/);
    const narrow =
      (await env.view.locator('[data-command-bar]').getAttribute('data-tier')) === 'narrow';
    if (narrow) await env.view.locator('[data-command-search-open]').click();
    await expect.poll(() => typingWidth(input)).toBeGreaterThanOrEqual(48);
    if (narrow) await env.view.locator('[data-command-search-close]').click();
    await expect.poll(() => barFits(env.view)).toBe(true);
    const bar = await env.view.locator('[data-command-bar]').boundingBox();
    const view = await env.view.locator('[data-playlist-view]').boundingBox();
    expect(bar && view && Math.abs(bar.x + bar.width - (view.x + view.width)) <= 1).toBeTruthy();
  }
  expect(env.errors).toEqual([]);
});

test('数值条件加入和移除共用条件条，清输入不会清掉条件', async ({ page }) => {
  const songs = await openSongs(page);
  songs.host.answer('library.query', (params) => {
    const query = String(params['query']);
    const tracks = query.includes('%length_seconds% GREATER 239')
      ? SONG_TRACKS.filter((track) => track.duration >= 240)
      : SONG_TRACKS;
    return {
      success: true,
      total: tracks.length,
      tracks: tracks.map((track) => ({ handle: track.handle })),
    };
  });
  await songs.view.locator('[data-filter-toggle]').click();
  await songs.view.locator('[data-condition-add]').click();
  await page.getByRole('combobox', { name: '字段', exact: true }).click();
  await page.getByRole('option', { name: '时长（秒）', exact: true }).click();
  await page.getByRole('combobox', { name: '条件', exact: true }).click();
  await page.getByRole('option', { name: '不少于', exact: true }).click();
  await page.getByRole('spinbutton').fill('240');
  await page.getByRole('button', { name: '添加条件', exact: true }).last().click();
  await expect(songs.subtitle).toHaveText(/^4 首/);
  const chip = songs.view.locator('[data-query-condition^="condition:"]');
  await expect(chip).toContainText('时长（秒） · 不少于 240');
  await songs.box.fill('x');
  await songs.view.locator('[data-query-clear]').click();
  await expect(chip).toBeVisible();
  await chip.getByLabel('移除「时长（秒） · 不少于 240」', { exact: true }).click();
  await expect(songs.subtitle).toHaveText(/^8 首/);
  expect(songs.errors).toEqual([]);
});

test('分类选项超过十二项即可搜索，选项减少后仍可清空已有搜索词', async ({ page }) => {
  const songs = await openSongs(page);
  const tracks = Array.from({ length: 14 }, (_, index) =>
    trackRow('Album', `Track ${index}`, { genre: `Genre ${index}` }),
  );
  const replace = async (count: number) => {
    const rows = tracks.slice(0, count);
    songs.host.answer('library.getAll', {
      success: true,
      tracks: rows,
      items: rows,
      total: count,
      offset: 0,
    });
    songs.host.answer('library.query', {
      success: true,
      total: count,
      tracks: rows.map((track) => ({ handle: track.handle })),
    });
    await songs.host.emit('library:itemsAdded', {
      count,
      handles: [],
      truncated: false,
      timestamp: Date.now(),
    });
  };
  await replace(14);
  await expect(songs.subtitle).toHaveText(/^14 首/);
  await songs.view.locator('[data-filter-toggle]').click();
  const facet = songs.view.locator('[data-facet-column="genre"]');
  const search = facet.getByRole('textbox');
  await expect(search).toBeVisible();
  await search.fill('Genre 12');
  await expect(facet.getByRole('checkbox')).toHaveCount(1);
  await replace(2);
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await expect(search).toBeVisible();
  await search.fill('');
  await expect(facet.getByRole('checkbox')).toHaveCount(2);
  expect(songs.errors).toEqual([]);
});
