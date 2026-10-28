import { expect, test, type Page } from '@playwright/test';
import { albumsAnswer } from '../fixtures/albumLibrary.ts';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { SONG_ALBUMS } from '../fixtures/songsPage.ts';

// 在线音乐第一批：结果页的在线音乐范围在试验页里配音乐客户端替身跑；整个主窗里没有后端，
// 只核对入口、范围切换与连不上服务时的空态。

test.use({ screenshot: 'off' });

const results = (page: Page) => page.locator('[data-online-results]');
const rows = (page: Page) => results(page).locator('[data-online-track]');

for (const colorScheme of ['light', 'dark'] as const)
  test(`全部：最佳匹配、各分类一节，页签写个数，曲目可起播（${colorScheme}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const errors = collectPageErrors(page);
    await openOnlineHarness(page);
    const view = results(page);
    await expect(view.getByRole('heading', { name: '最佳匹配' })).toBeVisible();
    await expect(view.locator('[data-online-best]')).toContainText('Nujabes');
    for (const name of ['艺人', '专辑', '曲目', '歌单'])
      await expect(view.getByRole('heading', { name, exact: true })).toBeVisible();
    for (const name of ['艺人 12', '专辑 12', '曲目 45', '歌单 9'])
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).nth(1)).toContainText('会员');
    await expect(rows(page).nth(2)).toHaveAttribute('data-dimmed', 'true');
    await rows(page).nth(3).dblclick();
    await expect
      .poll(async () => (await onlineLog(page)).find((entry) => isKind(entry, 'play')))
      .toMatchObject({ index: 3, query: 'Nujabes' });
    const play = (await onlineLog(page)).find((entry) => isKind(entry, 'play'));
    expect(play).toMatchObject({ ids: expect.arrayContaining(['1000', '1019']) });
    expect(errors).toEqual([]);
  });

test('曲目分类滚到底接着取，右键入队，多选时播放所选', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(page.getByRole('tab', { name: '曲目 45' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).first()).toBeVisible();
  const cursors = async () =>
    (await onlineLog(page)).flatMap((entry) =>
      isKind(entry, 'search') && Reflect.get(entry, 'type') === 'track'
        ? [Reflect.get(entry, 'cursor')]
        : [],
    );
  for (let round = 0; round < 6 && (await cursors()).length < 3; round += 1) {
    await results(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await page.waitForTimeout(150);
  }
  await expect.poll(cursors).toEqual([null, '20', '40']);
  await expect(page.locator('[data-online-more]')).toHaveCount(0);

  await results(page).evaluate((element) => element.scrollTo(0, 0));
  await rows(page).first().click({ button: 'right' });
  const menu = page.locator('[data-online-menu]');
  await expect(menu).toContainText('Track 01');
  for (const name of ['播放', '下一首播放', '加入队列', '复制标题'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '下一首播放', exact: true }).click();
  await expect
    .poll(async () => (await onlineLog(page)).find((entry) => isKind(entry, 'queue')))
    .toMatchObject({ ids: ['1000'], next: true });

  await rows(page).nth(0).click();
  await rows(page)
    .nth(2)
    .click({ modifiers: ['Control'] });
  await rows(page).nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '播放所选', exact: true }).click();
  await expect
    .poll(async () => (await onlineLog(page)).filter((entry) => isKind(entry, 'play')).at(-1))
    .toMatchObject({ ids: ['1000', '1002'], index: 0 });
});

test('「全部」里的图块只画一行，分类页放不下才换行，块间距照封面墙的算法，换列时滑到新位置', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 700, height: 900 });
  await openOnlineHarness(page);
  const albums = results(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '专辑', exact: true }) })
    .locator('[data-online-tile]');
  await expect.poll(() => albums.count()).toBeGreaterThan(1);
  const boxes = await albums.evaluateAll((tiles) =>
    tiles.map((tile) => [tile.getBoundingClientRect().top, tile.getBoundingClientRect().height]),
  );
  expect(boxes.every(([, height]) => (height ?? 0) > 0)).toBe(true);
  expect(boxes.length).toBeLessThan(8);
  expect(new Set(boxes.map(([top]) => top)).size).toBe(1);

  // 块间距照封面墙的算法：边长固定，余量先补进间距、最多补到 gap × stretch。读第一行相邻两块的间距与算式的差，
  // 差在取整的一像素之内；一行不足两块、或位移还在播读不准时，轮询到排好为止。
  const spacingError = (name: string, shape: { size: number; gap: number; stretch: number }) =>
    results(page)
      .getByRole('list', { name })
      .evaluate((element, { size, gap, stretch }) => {
        const width = element.getBoundingClientRect().width;
        const tiles = [...element.querySelectorAll('[data-online-tile]')].map((tile) =>
          tile.getBoundingClientRect(),
        );
        const row = tiles.filter((tile) => tile.top === tiles[0]?.top);
        const first = row[0];
        const second = row[1];
        if (!first || !second) return 99;
        const perRow = Math.max(1, Math.floor((width + gap) / (size + gap)));
        const expected =
          perRow > 1 ? Math.min(gap * stretch, (width - perRow * size) / (perRow - 1)) : gap;
        return Math.abs(second.left - first.right - expected);
      }, shape);
  // 艺人的间距不随窗宽变，余量全去两侧；专辑的间距最多补到两倍。
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('tab', { name: '艺人 12', exact: true }).click();
  await expect(
    results(page).getByRole('list', { name: '艺人' }).locator('[data-online-tile]'),
  ).toHaveCount(12);
  for (const width of [1400, 900, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => spacingError('艺人', { size: 120, gap: 24, stretch: 1 }))
      .toBeLessThan(1);
  }
  const artistTops = await results(page)
    .getByRole('list', { name: '艺人' })
    .locator('[data-online-tile]')
    .evaluateAll((tiles) => new Set(tiles.map((tile) => tile.getBoundingClientRect().top)).size);
  expect(artistTops).toBeGreaterThan(1);
  await page.getByRole('tab', { name: '专辑 12', exact: true }).click();
  for (const width of [2400, 2600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => spacingError('专辑', { size: 160, gap: 12, stretch: 2 }))
      .toBeLessThan(1);
  }

  // 侧边栏换形态挤出来的换列直接到位，所以先换到同一档侧边栏的宽度，再在这一档里拉窄。
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByRole('tab', { name: '专辑 12', exact: true }).click();
  await expect(results(page).getByRole('list', { name: '专辑' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect
    .poll(() =>
      results(page)
        .getByRole('listitem')
        .evaluateAll((cells) => cells.some((cell) => cell.getAnimations().length > 0)),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('悬停专辑图块出播放与更多两枚键：播放起播整张专辑，更多开对象菜单；移走卸掉，艺人没有键', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page);
  await page.getByRole('tab', { name: '专辑 12', exact: true }).click();
  const albums = results(page).getByRole('list', { name: '专辑' }).locator('[data-online-tile]');
  await expect(albums.first()).toBeVisible();
  const play = results(page).locator('[data-tile-play]');
  const more = results(page).locator('[data-tile-more]');
  await expect(play).toHaveCount(0);

  await albums.first().hover();
  await expect(play).toBeVisible();
  await expect(play).toHaveAccessibleName('播放');
  await play.click();
  await expect
    .poll(async () => (await onlineLog(page)).filter((entry) => isKind(entry, 'play')).at(-1))
    .toMatchObject({ index: 0 });

  await albums.first().hover();
  await more.click();
  await expect(page.locator('[data-online-object-menu]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await expect(play).toHaveCount(0);

  await page.getByRole('tab', { name: '艺人 12', exact: true }).click();
  await results(page)
    .getByRole('list', { name: '艺人' })
    .locator('[data-online-tile]')
    .first()
    .hover();
  await expect(play).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('组件未下载：写体积与许可，点了才下，下完接着搜', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ncm: 'missing' });
  const panel = page.locator('[data-online-empty]');
  await expect(panel).toContainText('在线音乐组件尚未下载');
  await expect(panel).toContainText('17 MB');
  await expect(panel).toContainText('ISC, MIT');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await expect(panel).toContainText('正在下载在线音乐组件');
  await expect(results(page).getByRole('heading', { name: '最佳匹配' })).toBeVisible({
    timeout: 10_000,
  });
});

test('没有结果用整页空态', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { results: 'empty' });
  await expect(page.locator('[data-online-empty]')).toContainText('网易云没有「Nujabes」的结果');
});

test('搜索失败用整页空态，重试后出结果', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { results: 'fail' });
  await expect(page.locator('[data-online-empty]')).toContainText('网易云搜索失败');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(results(page).getByRole('heading', { name: '最佳匹配' })).toBeVisible();
});

test('主窗：侧边栏没有在线音乐项；搜索框进结果页的在线音乐范围，连不上服务时如实写', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await installPageHost(page, { answers: { library: { getAlbums: albumsAnswer(SONG_ALBUMS) } } });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('button', { name: '在线音乐', exact: true })).toHaveCount(0);

  const input = page.locator('[data-search-input="sidebar"]:visible');
  await input.click();
  const flyout = page.locator('[data-search-flyout]');
  await flyout.getByRole('tab', { name: '在线音乐' }).click();
  await input.fill('Nujabes');
  await expect(flyout).toContainText('在线音乐暂不可用');
  await input.press('Enter');
  const search = page.locator('[data-page="search"]');
  await expect(search.getByRole('tab', { name: '在线音乐' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(search).toContainText('在线音乐暂不可用');
  await search.getByRole('tab', { name: '媒体库' }).click();
  await expect(search.getByRole('tab', { name: '全部' })).toBeVisible();
  expect(errors).toEqual([]);
});

function isKind(entry: unknown, kind: string): entry is object {
  return typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === kind;
}

test('专辑图块副标题里的艺人名可点，进这位艺人的在线列表页；点文字的空白处同样打开专辑', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { category: 'albums' });
  const list = page.locator('[data-page="onlineList"]');
  const tile = results(page).locator('[data-online-tile]').first();
  await tile.getByRole('button', { name: 'Nujabes', exact: true }).click();
  await expect(list.getByRole('heading', { name: 'Nujabes' })).toBeVisible();
  await expect(list.locator('[data-detail-facts]')).toContainText('艺人');

  await page.evaluate(() => {
    const back: unknown = Reflect.get(window, '__onlineBack');
    if (typeof back === 'function') back();
  });
  await results(page).locator('[data-online-tile]').first().getByText('专辑 2000').click();
  await expect(list.getByRole('heading', { name: '专辑 2000' })).toBeVisible();
});
