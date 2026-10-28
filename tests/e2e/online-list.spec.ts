import { expect, test, type Page } from '@playwright/test';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';
import { collectPageErrors } from '../fixtures/pageHost.ts';

// 在线列表页（专辑、歌单、艺人热门共用）在在线结果试验页里跑：音乐客户端是页面里的替身，
// 单击结果里的图块或用 `list=<种类>:<ID>` 直接进来。

test.use({ screenshot: 'off' });

const listPage = (page: Page) => page.locator('[data-page="onlineList"]');
const rows = (page: Page) => listPage(page).locator('[data-online-track]');
const entries = async (page: Page, kind: string) =>
  (await onlineLog(page)).filter(
    (entry): entry is object =>
      typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === kind,
  );

test('从结果页单击专辑图块打开列表页：页头写种类、年份与首数，无版权的变淡，双击起播记专辑来源，后退回结果页', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { category: 'albums' });
  await page.locator('[data-online-results] [data-online-tile]').first().click();

  await expect(listPage(page).getByRole('heading', { name: '专辑 2000' })).toBeVisible();
  const facts = listPage(page).locator('[data-detail-facts]');
  for (const text of ['专辑', '2005', '14 首']) await expect(facts).toContainText(text);
  await expect(rows(page).first()).toContainText('album 01');
  await expect(rows(page).nth(5)).toHaveAttribute('data-dimmed', 'true');

  await rows(page).nth(2).dblclick();
  await expect
    .poll(async () => (await entries(page, 'play')).at(-1))
    .toMatchObject({ index: 2, source: 'onlineAlbum', query: '专辑 2000' });
  expect(Reflect.get((await entries(page, 'play')).at(-1) ?? {}, 'ids')).toHaveLength(14);

  await page.evaluate(() => {
    const back: unknown = Reflect.get(window, '__onlineBack');
    if (typeof back === 'function') back();
  });
  await expect(page.locator('[data-online-results]')).toBeVisible();
  // 页头的艺术家露出来就取头像：那是另一张列表的请求，不算这一张的
  expect(
    (await entries(page, 'list')).filter((entry) =>
      String(Reflect.get(entry, 'key')).startsWith('album:'),
    ),
  ).toEqual([{ kind: 'list', key: 'album:2000', cursor: null }]);
  expect(errors).toEqual([]);
});

test('歌单滚到底接着取，查找只筛已取到的曲目，筛不到时写没有匹配', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'playlist:6000' });
  await expect(listPage(page).getByRole('heading', { name: '深夜 Jazzy Hip Hop' })).toBeVisible();
  const scroller = listPage(page).locator('[data-detail-scroller]');
  const cursors = async () =>
    (await entries(page, 'list')).map((entry) => Reflect.get(entry, 'cursor'));
  for (let round = 0; round < 8 && (await cursors()).length < 3; round += 1) {
    await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await page.waitForTimeout(150);
  }
  await expect.poll(cursors).toEqual([null, '20', '40']);
  await expect(page.locator('[data-online-more]')).toHaveCount(0);

  await scroller.evaluate((element) => element.scrollTo(0, 0));
  await listPage(page).locator('[data-detail-find-toggle]').click();
  const find = listPage(page).locator('[data-detail-find]');
  await find.fill('playlist 4');
  // 按空白拆词、每个词都要出现：标题含「4」的是 04、14、24、34 与 40–45。
  await expect(rows(page)).toHaveCount(10);
  await find.fill('不存在');
  await expect(listPage(page).locator('[data-online-list-no-matches]')).toHaveText(
    '没有匹配的曲目',
  );
  expect(await cursors()).toEqual([null, '20', '40']);
});

test('艺人热门：工具行左边是页签；页头的 ⋯ 出在线对象菜单，没有「打开」，加入队列带上全部曲目', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'artist:3000' });
  await expect(listPage(page).getByRole('heading', { name: 'Nujabes' })).toBeVisible();
  const tabs = listPage(page).locator('[data-detail-tools]').getByRole('tab');
  await expect(tabs).toHaveText([/^热门歌曲/, /^专辑/, /^单曲与 EP/]);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  await listPage(page).locator('[data-detail-more]').click();
  await expect(page.locator('[data-online-object-menu]')).toBeVisible();
  for (const name of ['播放', '下一首播放', '加入队列', '复制名称'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '打开', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '加入队列', exact: true }).click();
  await expect
    .poll(async () => (await entries(page, 'queue')).at(-1))
    .toMatchObject({ next: false });
  expect(Reflect.get((await entries(page, 'queue')).at(-1) ?? {}, 'ids')).toHaveLength(12);
});

test('读取失败写明原因，重试再取', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'album:5000', lists: 'fail' });
  await expect(listPage(page).getByText('没能读取这张专辑')).toBeVisible();
  await expect(listPage(page).getByText('网易云提示请求过于频繁')).toBeVisible();
  await listPage(page).getByRole('button', { name: '重试' }).click();
  await expect(listPage(page).getByRole('heading', { name: 'Modal Soul' })).toBeVisible();
  await expect(rows(page).first()).toContainText('album 01');
});

test('列表不存在时写网易云上没有，不给重试', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'album:404' });
  await expect(listPage(page).getByText('网易云上没有这张专辑')).toBeVisible();
  await expect(listPage(page).getByRole('button', { name: '重试' })).toHaveCount(0);
});

test('后退回列表页时第一帧就在离开时的滚动位置，不先露出页首', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1000, height: 480 });
  await openOnlineHarness(page, { list: 'playlist:6000' });
  await expect(rows(page).first()).toBeVisible();
  const scroller = listPage(page).locator('[data-detail-scroller]');
  const left = await scroller.evaluate((element) => {
    element.scrollTo(0, 360);
    return element.scrollTop;
  });
  expect(left).toBeGreaterThan(200);
  // 离开这一页：直接改地点，试验页随即显示结果页。
  await page.evaluate(() => {
    const go: unknown = Reflect.get(window, '__onlineGo');
    if (typeof go === 'function') go();
  });
  await expect(listPage(page)).toHaveCount(0);
  const frames = await page.evaluate(
    () =>
      new Promise<(number | null)[]>((done) => {
        const seen: (number | null)[] = [];
        const tick = () => {
          const element = document.querySelector('[data-page="onlineList"] [data-detail-scroller]');
          seen.push(element ? element.scrollTop : null);
          if (seen.length < 12) requestAnimationFrame(tick);
          else done(seen);
        };
        const back: unknown = Reflect.get(window, '__onlineBack');
        if (typeof back === 'function') back();
        requestAnimationFrame(tick);
      }),
  );
  const shown = frames.filter((top): top is number => top !== null);
  expect(shown.length).toBeGreaterThan(0);
  expect(
    shown.every((top) => Math.abs(top - left) < 1),
    JSON.stringify({ left, frames }),
  ).toBe(true);
});

test('专辑页头的艺术家：一位不出箭头，头像加名字；点名字进艺术家页', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'album:2000' });
  const artists = listPage(page).locator('[data-detail-artists]');
  await expect(artists.locator('[data-artist-avatar]')).toHaveCount(1);
  await expect(artists.getByRole('button', { name: 'Nujabes' })).toBeVisible();
  await expect(listPage(page).locator('[data-detail-artists-more]')).toHaveCount(0);
  await artists.getByRole('button', { name: 'Nujabes' }).click();
  await expect(listPage(page).getByRole('heading', { name: 'Nujabes' })).toBeVisible();
});

test('合辑的艺术家一行放不下：整枚收起，右侧出箭头，点开从下拉里列出全部，Esc 收起', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'album:5100' });
  const artists = listPage(page).locator('[data-detail-artists]');
  const more = listPage(page).locator('[data-detail-artists-more]');
  await expect(more).toBeVisible();
  await expect(artists.getByRole('button', { name: 'Artist 01' })).toBeVisible();
  await expect(artists.getByRole('button', { name: 'Artist 12' })).toBeHidden();
  // 看得见的每一枚都完整落在行内
  const row = await artists.boundingBox();
  for (const link of await artists.getByRole('button').all()) {
    const box = await link.boundingBox();
    if (box && row) expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 1);
  }
  await more.click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveCount(12);
  await expect(items.first()).toHaveText('Artist 01');
  await expect(items.last()).toHaveText('Artist 12');
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
});

test('歌单介绍写两行，放不下时右侧出箭头，点开从下拉里写完整介绍，Esc 收起', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'playlist:6100' });
  const description = listPage(page).locator('[data-detail-description]');
  await expect(description).toBeVisible();
  const more = listPage(page).locator('[data-detail-description-more]');
  await expect(more).toBeVisible();
  await more.click();
  const full = page.locator('[data-detail-description-full]');
  await expect(full).toBeVisible();
  await expect(full).toContainText('第 6 段');
  await page.keyboard.press('Escape');
  await expect(full).toHaveCount(0);
});

test('歌单没有介绍时头部不出介绍这一行', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'playlist:6000' });
  await expect(listPage(page).getByRole('heading', { name: '深夜 Jazzy Hip Hop' })).toBeVisible();
  await expect(listPage(page).locator('[data-detail-description]')).toHaveCount(0);
});

test('曲目行的艺人名与专辑名可点：进在线的艺人页与专辑页；Ctrl 单击交给行选择，不跳转', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'playlist:6000' });
  const row = rows(page).first();
  await row.getByRole('button', { name: 'Nujabes', exact: true }).click({ modifiers: ['Control'] });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(listPage(page).getByRole('heading', { name: '深夜 Jazzy Hip Hop' })).toBeVisible();

  await row.getByRole('button', { name: 'Nujabes', exact: true }).click();
  await expect(listPage(page).getByRole('heading', { name: 'Nujabes' })).toBeVisible();
  await expect(listPage(page).locator('[data-detail-facts]')).toContainText('艺人');
  await page.evaluate(() => {
    const back: unknown = Reflect.get(window, '__onlineBack');
    if (typeof back === 'function') back();
  });
  await expect(listPage(page).getByRole('heading', { name: '深夜 Jazzy Hip Hop' })).toBeVisible();
  await rows(page).first().getByRole('button', { name: 'Modal Soul', exact: true }).click();
  await expect(listPage(page).getByRole('heading', { name: 'Modal Soul' })).toBeVisible();
});

test('曲目右键菜单出「转到专辑」「转到艺人」，去在线的专辑页与艺人页；多选时不出', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'playlist:6000' });
  const menu = page.locator('[data-online-menu]');
  await rows(page).first().click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: '转到专辑' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: '转到艺人' }).click();
  await expect(listPage(page).getByRole('heading', { name: 'Nujabes' })).toBeVisible();

  await page.evaluate(() => {
    const back: unknown = Reflect.get(window, '__onlineBack');
    if (typeof back === 'function') back();
  });
  await rows(page).first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '转到专辑' }).click();
  await expect(listPage(page).getByRole('heading', { name: 'Modal Soul' })).toBeVisible();

  await page.evaluate(() => {
    const back: unknown = Reflect.get(window, '__onlineBack');
    if (typeof back === 'function') back();
  });
  await rows(page).first().click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ['Shift'] });
  await rows(page).nth(1).click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '复制标题' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '转到艺人' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: '转到专辑' })).toHaveCount(0);
});
