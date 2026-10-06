import { QUEUE_LIST_GUID } from '../fixtures/rightCardPage.ts';
import { expect, test, type Page } from '@playwright/test';
import { openLargeQueue, queueScroller } from '../fixtures/rightCardPage.ts';
import type { PlayerPage } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { installFakeQueue, queueTracks } from '../fixtures/fakeQueue.ts';

const records = (page: Page) => page.locator('[data-queue-review-records]');
const toggle = (page: Page) => page.locator('[data-queue-review-toggle]');
const current = (page: Page) => page.locator('[data-queue-current]');
const reviewRows = (page: Page) => records(page).locator('[data-queue-row]');
const visibleReviewCount = (page: Page) =>
  records(page).evaluate((box) => {
    const bounds = box.getBoundingClientRect();
    return [...box.querySelectorAll('[data-queue-review-index]')].filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    }).length;
  });
const queueTrack = (index: number) =>
  makeTrack({ path: `file://E:/Music/queue/${index}.flac`, title: `曲目 ${index}` });

async function advance(player: PlayerPage, index: number) {
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

async function seed(page: Page) {
  const player = await openLargeQueue(page, 30);
  for (let i = 1; i <= 7; i++) {
    await advance(player, i);
    await expect(current(page)).toContainText(`曲目 ${i}`);
    await expect(
      page.locator('[data-queue-section="upnext"] [data-queue-row]').first(),
    ).toContainText(`曲目 ${i + 1}`);
  }
  return player;
}

test('历史入口仅图标和数量，固定视口向上看更早记录，键盘与矮窗可用', async ({ page }) => {
  const player = await seed(page);
  const top = (await current(page).boundingBox())?.y ?? 0;
  await expect(toggle(page)).toHaveText(/^\d+$/);
  await expect(toggle(page)).toHaveAccessibleName(/播放历史 · \d+ 首/);
  expect(await toggle(page).evaluate((button) => !!button.closest('[data-queue-page]'))).toBe(
    false,
  );
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => visibleReviewCount(page)).toBe(5);
  await expect
    .poll(async () => (await current(page).boundingBox())?.y ?? 0)
    .toBeGreaterThan(top + 200);
  await expect(current(page)).toHaveCount(1);
  await expect(reviewRows(page).last()).toContainText('曲目 6');
  await expect.poll(() => records(page).evaluate((box) => box.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => queueScroller(page).evaluate((node) => node.getAnimations().length))
    .toBe(0);
  const expandedTop = (await current(page).boundingBox())?.y ?? 0;
  await records(page).hover();
  await page.mouse.wheel(0, -1000);
  await expect.poll(() => records(page).evaluate((box) => box.scrollTop)).toBe(0);
  expect(Math.abs(((await current(page).boundingBox())?.y ?? 0) - expandedTop)).toBeLessThan(2);
  await toggle(page).click();
  await toggle(page).click();
  await expect.poll(() => records(page).evaluate((box) => box.scrollTop)).toBeGreaterThan(0);
  await reviewRows(page).last().click();
  await page.keyboard.press('Home');
  await expect(reviewRows(page).first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(reviewRows(page).last()).toBeFocused();
  player.host.answer('queue.insertNext', {
    success: true,
    insertedCount: 1,
    movedCount: 0,
    invalidCount: 0,
    queueCount: 1,
  });
  player.host.answer('queue.playNow', { success: true, playedIndex: 0, queueCount: 0 });
  await page.keyboard.press('Enter');
  await expect
    .poll(() => player.host.callsTo('queue.insertNext').at(-1)?.paths)
    .toEqual([queueTrack(6).handle]);
  await page.keyboard.press('ArrowLeft');
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await toggle(page).click();
  await page.setViewportSize({ width: 1280, height: 450 });
  await expect
    .poll(() => records(page).evaluate((box) => box.clientHeight))
    .toBeLessThanOrEqual(144);
  await expect.poll(() => visibleReviewCount(page)).toBeGreaterThanOrEqual(1);
  expect(player.errors).toEqual([]);
});

test('快速反向展开与收起接续动画，减弱动效直接落位，大封面只保留一张', async ({ page }) => {
  const player = await seed(page);
  const movement = await page.locator('[data-right-card]').evaluate(async (root) => {
    const button = root.querySelector<HTMLButtonElement>('[data-queue-review-toggle]');
    // 开合时动的是整个队列滚动区，交界跟着它走。
    const body = root.querySelector<HTMLElement>('[data-queue-page]')?.parentElement;
    if (!button || !body) throw new Error('回看未挂载');
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 65));
    const before = body.getBoundingClientRect().top;
    const running = body.getAnimations().length;
    button.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const after = body.getBoundingClientRect().top;
    return { delta: Math.abs(after - before), running };
  });
  expect(movement.running).toBeGreaterThan(0);
  expect(movement.delta).toBeLessThan(55);
  await expect(records(page)).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle(page).click();
  await expect.poll(() => visibleReviewCount(page)).toBe(5);
  expect(await queueScroller(page).evaluate((box) => box.getAnimations().length)).toBe(0);
  await toggle(page).click();
  await page.getByRole('button', { name: '展开封面', exact: true }).first().click();
  await toggle(page).click();
  await expect.poll(() => visibleReviewCount(page)).toBe(5);
  expect(
    (await page.getByRole('button', { name: '收起封面', exact: true }).boundingBox())?.width,
  ).toBeLessThanOrEqual(288);
  await expect(current(page)).toHaveCount(1);
  expect(player.errors).toEqual([]);
});

test('下一轮独立折叠且键盘不进入隐藏行，实际回绕后历史保留', async ({ page }) => {
  const player = await openLargeQueue(page, 12);
  await advance(player, 9);
  player.state.order = 1;
  await player.host.emit('playback:orderChanged', { order: 1, orderIndex: 1 });
  const nextRound = page.locator('[data-queue-next-round]');
  await expect(nextRound).toHaveAttribute('aria-expanded', 'false');
  const upcoming = page.locator('[data-queue-section="upnext"] [data-queue-row]');
  await expect(upcoming).toHaveCount(3);
  await upcoming.first().click();
  await page.keyboard.press('End');
  await expect(upcoming.last()).toBeFocused();
  await expect(upcoming.last()).toContainText('曲目 12');
  await nextRound.click();
  await expect(upcoming).toHaveCount(13);
  await upcoming.first().click();
  await page.keyboard.press('End');
  await expect(upcoming.last()).toBeFocused();
  await expect(upcoming.last()).toContainText('曲目 9');
  await expect(upcoming.last()).toContainText('10曲目 9');
  await expect(upcoming.filter({ hasText: /^1曲目 0/ })).toHaveCount(1);
  await advance(player, 0);
  await expect(toggle(page)).toHaveText('2');
  await expect(nextRound).toHaveAttribute('aria-expanded', 'false');
  expect(player.errors).toEqual([]);
});

test('播放来源第 N 首后显示 N+1，手动插播不改来源序号，多选仍按实际曲目执行', async ({ page }) => {
  const player = await openLargeQueue(page, 1000);
  await advance(player, 499);
  const upcoming = page.locator('[data-kind="upnext"]');
  await expect(upcoming.first()).toContainText('501曲目 500');
  await upcoming.first().click();
  await page.keyboard.press('ArrowDown');
  await expect(upcoming.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => player.host.callsTo('playlist.playTrack').at(-1)?.index).toBe(501);
  const queue = installFakeQueue(player.host, queueTracks('手动一', '手动二'), [
    queueTrack(500),
    queueTrack(501),
  ]);
  await player.host.emit('playback:queueChanged', { origin: 'user_added', count: 2 });
  await expect(page.locator('[data-kind="queued"]').first()).toContainText('1手动一');
  await expect(upcoming.first()).toContainText('501曲目 500');
  await upcoming.first().click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ContextMenu');
  const menu = page.locator('[data-queue-menu="upnext"]');
  await expect(menu).toContainText('已选 2 首');
  await menu.getByRole('menuitem', { name: '下一首播放', exact: true }).click();
  await expect.poll(() => queue.titles()).toEqual(['曲目 500', '曲目 501', '手动一', '手动二']);
  await expect(upcoming.first()).toContainText('501曲目 500');
  expect(player.errors).toEqual([]);
});

test('面板选项在深浅两档都能开合封面，展开资料与评分跟随当前曲目', async ({ page }) => {
  const player = await openLargeQueue(page, 30);
  const options = page.getByRole('button', { name: '面板选项', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await options.click();
    await page.getByRole('menuitem', { name: '展开封面', exact: true }).click();
    await expect(
      current(page).getByRole('button', { name: '收起封面', exact: true }),
    ).toBeVisible();
    await expect(current(page).locator('[data-queue-rating]')).toHaveCount(1);
    await expect(current(page)).toContainText('FLAC · 44.1 kHz · 900 kbps');
    await options.click();
    await page.getByRole('menuitem', { name: '收起封面', exact: true }).click();
    await expect(
      current(page).getByRole('button', { name: '展开封面', exact: true }).first(),
    ).toBeVisible();
  }
  await options.click();
  await page.getByRole('menuitem', { name: '关闭面板', exact: true }).click();
  await expect(page.locator('[data-right-card]')).toHaveCount(0);
  expect(player.errors).toEqual([]);
});

test('当前曲目两种形态都有评分与操作，换曲后旧菜单失效', async ({ page }) => {
  const player = await openLargeQueue(page, 30);
  player.host.answer('rating.set', (params) => ({
    success: true,
    path: String(params['path']),
    rating: Number(params['rating']),
    storage: 'file',
  }));
  const queue = installFakeQueue(player.host, [], [queueTrack(0)]);
  for (const expanded of [false, true]) {
    if (expanded) {
      await current(page).getByRole('button', { name: '展开封面', exact: true }).first().click();
    }
    const stars = current(page).locator('[data-queue-rating]');
    const value = expanded ? 5 : 3;
    await expect(stars).toBeVisible();
    await stars.getByRole('radio', { name: String(value), exact: true }).click();
    await expect(stars.getByRole('radio', { name: String(value), exact: true })).toBeChecked();
    await expect
      .poll(() => player.host.callsTo('rating.set').at(-1))
      .toEqual({
        path: queueTrack(0).path,
        rating: value,
        cueIndex: 0,
      });
    await current(page).getByRole('button', { name: '更多操作', exact: true }).click();
    const menu = page.locator('[data-queue-menu="current"]');
    await expect(menu).toContainText('曲目 0');
    await expect(menu).toContainText('正在播放');
    await menu.getByRole('menuitem', { name: '加入队列', exact: true }).click();
    await expect.poll(() => queue.titles()).toEqual(['曲目 0']);
  }
  await current(page).getByText('曲目 0', { exact: true }).click({ button: 'right' });
  await expect(page.locator('[data-queue-menu="current"]')).toBeVisible();
  await advance(player, 1);
  await expect(page.locator('[data-queue-menu="current"]')).toHaveCount(0);
  expect(player.errors).toEqual([]);
});

test('历史停在底部时跟随新增，向上阅读时保留滚动位置', async ({ page }) => {
  const player = await seed(page);
  await toggle(page).click();
  await expect.poll(() => visibleReviewCount(page)).toBe(5);
  await advance(player, 8);
  await expect(reviewRows(page).last()).toContainText('曲目 7');
  await expect
    .poll(() =>
      records(page).evaluate((box) => box.scrollHeight - box.clientHeight - box.scrollTop),
    )
    .toBeLessThan(2);
  await records(page).evaluate((box) => {
    box.scrollTop = 0;
  });
  await expect.poll(() => records(page).evaluate((box) => box.scrollTop)).toBe(0);
  await advance(player, 9);
  await expect(current(page)).toContainText('曲目 9');
  expect(await records(page).evaluate((box) => box.scrollTop)).toBe(0);
  expect(await records(page).evaluate((box) => box.clientHeight)).toBe(240);
  expect(player.errors).toEqual([]);
});

test('跳播只记实际播放，清空队列不增加历史，列表编辑保留历史', async ({ page }) => {
  const player = await openLargeQueue(page, 30);
  player.host.answer('playlist.playTrack', async (params) => {
    await advance(player, Number(params['index']));
    return { success: true };
  });
  await page
    .locator('[data-queue-section="upnext"] [data-queue-row]')
    .filter({ hasText: /^6曲目 5/ })
    .dblclick();
  await expect(current(page)).toContainText('曲目 5');
  await toggle(page).click();
  await expect(reviewRows(page).filter({ hasText: /已播|跳过/ })).toHaveCount(0);
  for (let index = 1; index <= 4; index++) {
    await expect(reviewRows(page).filter({ hasText: `曲目 ${index}` })).toHaveCount(0);
  }
  await expect(reviewRows(page).last()).toContainText('曲目 0');
  const before = await toggle(page).textContent();
  const queue = installFakeQueue(player.host, queueTracks('手动一', '手动二'));
  await player.host.emit('playback:queueChanged', { origin: 'user_added', count: 2 });
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect.poll(() => queue.titles()).toEqual([]);
  expect(await toggle(page).textContent()).toBe(before);
  await player.host.emit('playlist:itemsAdded', {
    playlistGuid: QUEUE_LIST_GUID,
    playlist: 0,
    start: 0,
    count: 1,
  });
  await expect(toggle(page)).toHaveText(before ?? '');
  expect(player.errors).toEqual([]);
});

test('收起下一轮后丢弃尚未读完的多选菜单，重新打开只作用于本轮', async ({ page }) => {
  const player = await openLargeQueue(page, 1600);
  await advance(player, 1599);
  player.state.order = 1;
  await player.host.emit('playback:orderChanged', { order: 1, orderIndex: 1 });
  const nextRound = page.locator('[data-queue-next-round]');
  await nextRound.click();
  const first = page.locator('[data-kind="upnext"]').filter({ hasText: /^1601曲目 1600/ });
  await first.click();
  await page.keyboard.press('Shift+End');
  await expect(
    page.locator('[data-kind="upnext"]').filter({ hasText: /^1600曲目 1599/ }),
  ).toBeFocused();
  const held = player.host.hold('playlist.getTracks');
  const readsBefore = player.host.callsTo('playlist.getTracks').length;
  await page.keyboard.press('ContextMenu');
  await expect.poll(() => held.pending.length).toBeGreaterThan(0);
  await queueScroller(page).evaluate((box) => {
    box.scrollTop = 0;
  });
  await nextRound.click();
  await expect(nextRound).toHaveAttribute('aria-expanded', 'false');
  held.release();
  let lastCount = readsBefore;
  let lastRead = Date.now();
  // 多选读取会补齐被回收的缓存页；等请求结束后再核对菜单，避免只检查到尚未返回的那一帧。
  await expect
    .poll(() => {
      const count = player.host.callsTo('playlist.getTracks').length;
      if (count !== lastCount) {
        lastCount = count;
        lastRead = Date.now();
      }
      return Date.now() - lastRead;
    })
    .toBeGreaterThan(200);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator('[data-queue-menu]')).toHaveCount(0);
  await first.click({ button: 'right' });
  await expect(page.locator('[data-queue-menu]')).toContainText('曲目 1600');
  await expect(page.locator('[data-queue-menu]')).not.toContainText('已选');
  expect(player.errors).toEqual([]);
});

test('跳过十万首不会膨胀历史', async ({ page }) => {
  const player = await openLargeQueue(page, 120000, 20);
  player.host.answer('playlist.playTrack', async (params) => {
    await advance(player, Number(params['index']));
    return { success: true };
  });
  await queueScroller(page).evaluate((box) => {
    box.scrollTop = 48 * 99996;
  });
  await page
    .locator('[data-kind="upnext"]')
    .filter({ hasText: /^100001曲目 100000/ })
    .dblclick();
  await toggle(page).click();
  await expect(toggle(page)).toHaveText('2');
  await expect(reviewRows(page)).toHaveCount(2);
  await expect(reviewRows(page).last()).toContainText('曲目 0');
  expect(await records(page).evaluate((box) => box.clientHeight)).toBe(96);
  expect(player.errors).toEqual([]);
});

test('历史去重移位保留阅读锚点，重播的当前项立即移出', async ({ page }) => {
  const player = await seed(page);
  for (const index of [8, 9, 10]) await advance(player, index);
  await expect(current(page)).toContainText('曲目 10');
  const count = await toggle(page).textContent();
  await toggle(page).click();
  await expect.poll(() => visibleReviewCount(page)).toBe(5);
  await records(page).evaluate(async (box) => {
    await new Promise<void>((resolve) => {
      box.addEventListener('scroll', () => requestAnimationFrame(() => resolve()), { once: true });
      box.scrollTop = 48 * 2;
    });
  });
  await expect.poll(() => records(page).evaluate((box) => box.scrollTop)).toBe(96);
  await advance(player, 0);
  await expect(toggle(page)).toHaveText(count ?? '');
  await expect(reviewRows(page).filter({ hasText: /曲目 0$/ })).toHaveCount(0);
  await expect.poll(() => records(page).evaluate((box) => box.scrollTop)).toBe(48);
  await advance(player, 7);
  await expect(toggle(page)).toHaveText(count ?? '');
  await expect(reviewRows(page).filter({ hasText: /曲目 7$/ })).toHaveCount(0);
  expect(player.errors).toEqual([]);
});

test('真实长历史维持固定视口，远跳键盘只挂载附近行', async ({ page }) => {
  const player = await openLargeQueue(page, 200);
  for (let index = 1; index <= 90; index++) await advance(player, index);
  await toggle(page).click();
  await expect(reviewRows(page).last()).toContainText('曲目 89');
  await expect.poll(() => records(page).evaluate((box) => box.clientHeight)).toBe(240);
  expect(await reviewRows(page).count()).toBeLessThan(80);
  await reviewRows(page).last().click();
  await page.keyboard.press('Home');
  await expect(reviewRows(page).first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(reviewRows(page).last()).toBeFocused();
  await expect(reviewRows(page).last()).toContainText('曲目 89');
  expect(await reviewRows(page).count()).toBeLessThan(80);
  expect(player.errors).toEqual([]);
});
