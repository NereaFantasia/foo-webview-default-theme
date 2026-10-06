import { expect, test, type Page } from '@playwright/test';
import type { PlayerPage } from '../fixtures/playerPage.ts';
import { openLargeQueue, QUEUE_LIST_GUID, queueScroller } from '../fixtures/rightCardPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 正在播的这一首前面那几行：平时滚在队列滚动区上缘之外，在队列区里往上滚才从交界露出来，历史区不动；
// 换曲时当前卡还露着、或刚在队列页里点了播放，就回到当前卡置顶。播放历史在队列滚动区上方单独一块，铺底色，
// 开着时不随队列滚动；记录多过平时露得下的行数时底边出箭头，点了往下拉开。观感只能实机看。

const current = (page: Page) => page.locator('[data-queue-current]');
const earlierRow = (page: Page, title: string) =>
  page
    .locator('[data-queue-earlier] [data-queue-row]')
    .filter({ has: page.getByText(title, { exact: true }) });
const toggle = (page: Page) => page.locator('[data-queue-review-toggle]');
const records = (page: Page) => page.locator('[data-queue-review-records]');
const grow = (page: Page) => page.locator('[data-queue-review-grow]');
const queueTrack = (index: number) =>
  makeTrack({ path: `file://E:/Music/queue/${index}.flac`, title: `曲目 ${index}` });

async function playAt(player: PlayerPage, index: number) {
  player.state.track = queueTrack(index);
  player.host.answer('playback.getCurrentTrackIndex', {
    playlistGuid: QUEUE_LIST_GUID,
    success: true,
    found: true,
    playlist: 0,
    index,
  });
  await player.host.emit('playback:trackChanged', player.state.track);
}

/** 当前曲目卡的上缘离队列滚动区上缘多远，取整到像素。 */
const cardOffset = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-queue-page]')?.parentElement;
    const card = document.querySelector('[data-queue-current]');
    if (!scroller || !card) return null;
    return Math.round(card.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
  });

/** 前面那一段里有几行露在队列滚动区里。 */
const shownEarlier = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-queue-page]')?.parentElement;
    if (!scroller) return -1;
    const top = scroller.getBoundingClientRect().top;
    return [...document.querySelectorAll('[data-queue-earlier] [data-queue-row]')].filter(
      (row) => row.getBoundingClientRect().bottom > top + 1,
    ).length;
  });

/** 前面那一段最后一行的下缘到当前曲目卡上缘的距离，取整到像素。 */
const gapAboveCard = (page: Page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-queue-earlier] [data-queue-row]')];
    const last = rows.at(-1)?.getBoundingClientRect();
    const card = document.querySelector('[data-queue-current]')?.getBoundingClientRect();
    return last && card ? Math.round(card.top - last.bottom) : null;
  });

const settled = (page: Page) =>
  expect.poll(() => queueScroller(page).evaluate((box) => box.getAnimations().length)).toBe(0);

test('前面那几行平时藏在队列区上缘之外，往上滚才露出来；历史区开着也不动', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  await playAt(player, 30);
  await expect(current(page)).toContainText('曲目 30');
  await expect.poll(() => cardOffset(page)).toBe(8);
  expect(await shownEarlier(page)).toBe(0);

  await toggle(page).click();
  await settled(page);
  const history = await page.locator('[data-queue-review-region]').boundingBox();
  await current(page).hover();
  await page.mouse.wheel(0, -200);
  await expect(earlierRow(page, '曲目 29')).toBeVisible();
  await expect.poll(() => shownEarlier(page)).toBeGreaterThan(2);
  expect(await page.locator('[data-queue-review-region]').boundingBox()).toEqual(history);
  // 紧挨当前卡的是第 30 行，序号照来源列表写；它与当前卡之间只隔 8，没有空着的一截。
  await expect(earlierRow(page, '曲目 29')).toContainText('30');
  await expect.poll(() => gapAboveCard(page)).toBe(8);

  // 拖宽右侧卡：前面那几行照样铺到当前卡跟前。
  const handle = await page.getByRole('separator', { name: '调整面板宽度' }).boundingBox();
  if (!handle) throw new Error('没有调宽度的握柄');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++)
    await page.mouse.move(handle.x + handle.width / 2 - step * 15, handle.y + handle.height / 2);
  await page.mouse.up();
  await expect.poll(() => gapAboveCard(page)).toBe(8);
  await expect(earlierRow(page, '曲目 29')).toBeVisible();
  expect(player.errors).toEqual([]);
});

test('当前卡还露在视口里时换曲置顶，前面的歌藏回去；整个滚出视口在深处翻看时不动', async ({
  page,
}) => {
  const player = await openLargeQueue(page, 200);
  await playAt(player, 30);
  await expect.poll(() => cardOffset(page)).toBe(8);
  await playAt(player, 31);
  await expect(current(page)).toContainText('曲目 31');
  await expect.poll(() => cardOffset(page)).toBe(8);
  expect(await shownEarlier(page)).toBe(0);

  // 往上滚一点、当前卡还露着：换曲后回到置顶。
  await current(page).hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(() => shownEarlier(page)).toBeGreaterThan(0);
  await playAt(player, 32);
  await expect(current(page)).toContainText('曲目 32');
  await expect.poll(() => cardOffset(page)).toBe(8);
  expect(await shownEarlier(page)).toBe(0);

  // 往上翻到当前卡整个出了视口：读的那几行不跳。
  await current(page).hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => (await current(page).boundingBox())?.y ?? 0).toBeGreaterThan(800);
  const row = earlierRow(page, '曲目 20');
  await expect(row).toBeVisible();
  const before = (await row.boundingBox())?.y ?? 0;
  await playAt(player, 33);
  await expect(current(page)).toContainText('曲目 33');
  await expect
    .poll(async () => Math.round((await row.boundingBox())?.y ?? 0))
    .toBe(Math.round(before));
  expect(player.errors).toEqual([]);
});

test('在「接下来」深处双击一首播起：换过去之后当前卡置顶', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  await playAt(player, 30);
  await expect.poll(() => cardOffset(page)).toBe(8);
  await queueScroller(page).evaluate((box) => {
    box.scrollTop += 1500;
  });
  const target = page
    .locator('[data-kind="upnext"]')
    .filter({ has: page.getByText('曲目 60', { exact: true }) });
  await expect(target).toBeVisible();
  await target.dblclick();
  await expect
    .poll(() => player.host.callsTo('playlist.playTrack').at(-1))
    .toMatchObject({ index: 60 });
  await playAt(player, 60);
  await expect(current(page)).toContainText('曲目 60');
  await expect.poll(() => cardOffset(page)).toBe(8);
  expect(await shownEarlier(page)).toBe(0);
  expect(player.errors).toEqual([]);
});

test('点当前卡上的展开键：大封面展开、收起时前面那几首仍藏着', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  await playAt(player, 30);
  await expect.poll(() => cardOffset(page)).toBe(8);
  const coverToggle = current(page).locator('[data-cover-toggle]');
  await expect(coverToggle).toHaveAccessibleName('展开封面');
  await coverToggle.click();
  await expect(coverToggle).toHaveAccessibleName('收起封面');
  await page.waitForTimeout(400);
  expect(await cardOffset(page)).toBe(8);
  expect(await shownEarlier(page)).toBe(0);
  await coverToggle.click();
  await expect(coverToggle).toHaveAccessibleName('展开封面');
  await page.waitForTimeout(400);
  expect(await cardOffset(page)).toBe(8);
  expect(await shownEarlier(page)).toBe(0);
  expect(player.errors).toEqual([]);
});

test('双击前面的一行从那一首播起；键盘上下键在这一段里挪', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  await playAt(player, 30);
  await current(page).hover();
  await page.mouse.wheel(0, -300);
  const row = earlierRow(page, '曲目 27');
  await row.dblclick();
  await expect
    .poll(() => player.host.callsTo('playlist.playTrack').at(-1))
    .toMatchObject({ index: 27 });
  await row.click();
  await page.keyboard.press('ArrowDown');
  await expect(earlierRow(page, '曲目 28')).toBeFocused();
  expect(player.errors).toEqual([]);
});

test('播放历史在队列区上方单独一块、铺底色；队列滚动时它不动', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  for (let index = 1; index <= 3; index++) await playAt(player, index);
  await toggle(page).click();
  await settled(page);
  const panel = page.locator('[data-queue-review-region] > div');
  expect(await panel.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(await records(page).evaluate((node) => !!node.closest('[data-queue-page]'))).toBe(false);
  const before = await page.locator('[data-queue-review-region]').boundingBox();
  await queueScroller(page).evaluate((box) => {
    box.scrollTop += 600;
  });
  expect(await page.locator('[data-queue-review-region]').boundingBox()).toEqual(before);
  expect(player.errors).toEqual([]);
});

test('记录多过平时露得下的 5 行时底边出箭头：点了拉开、队列让出高度、箭头转向上，再点收回', async ({
  page,
}) => {
  const player = await openLargeQueue(page, 200);
  for (let index = 1; index <= 3; index++) await playAt(player, index);
  await toggle(page).click();
  await settled(page);
  await expect(grow(page)).toHaveCount(0);
  // 历史里还有打开页面时在放的那一首与第 0 首，一共 10 条。
  for (let index = 4; index <= 9; index++) await playAt(player, index);
  await expect(toggle(page)).toHaveText('10');
  await expect(grow(page)).toBeVisible();
  await expect(grow(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(grow(page)).toHaveAccessibleName('显示更多播放历史');
  expect(await records(page).evaluate((box) => box.clientHeight)).toBe(240);
  const boundary = () => queueScroller(page).evaluate((box) => box.getBoundingClientRect().top);
  const closed = await boundary();

  await grow(page).click();
  expect(await queueScroller(page).evaluate((box) => box.getAnimations().length)).toBeGreaterThan(
    0,
  );
  await settled(page);
  await expect(grow(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(grow(page)).toHaveAccessibleName('显示较少播放历史');
  await expect.poll(() => records(page).evaluate((box) => box.clientHeight)).toBeGreaterThan(240);
  const grownHeight = await records(page).evaluate((box) => box.clientHeight);
  expect(grownHeight % 48).toBe(0);
  expect(Math.round((await boundary()) - closed)).toBe(grownHeight - 240);
  await expect
    .poll(() =>
      grow(page)
        .locator('svg')
        .evaluate((icon) => getComputedStyle(icon).rotate),
    )
    .toBe('180deg');
  // 拉开后最近的一首仍贴着交界。
  await expect(page.locator('[data-queue-review-index="9"]')).toBeInViewport();

  await grow(page).click();
  await settled(page);
  await expect.poll(() => records(page).evaluate((box) => box.clientHeight)).toBe(240);
  expect(Math.round(await boundary())).toBe(Math.round(closed));
  await expect(page.locator('[data-queue-review-index="9"]')).toBeInViewport();

  // 收起再打开从平时的高度开始。
  await grow(page).click();
  await settled(page);
  await toggle(page).click();
  await toggle(page).click();
  await settled(page);
  await expect.poll(() => records(page).evaluate((box) => box.clientHeight)).toBe(240);
  expect(player.errors).toEqual([]);
});

test('减弱动效下拉开、收回直接落位', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  for (let index = 1; index <= 9; index++) await playAt(player, index);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle(page).click();
  await grow(page).click();
  expect(await queueScroller(page).evaluate((box) => box.getAnimations().length)).toBe(0);
  await expect.poll(() => records(page).evaluate((box) => box.clientHeight)).toBeGreaterThan(240);
  expect(player.errors).toEqual([]);
});
