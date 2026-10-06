import { expect, test, type Page } from '@playwright/test';
import type { PlayerBarStyle } from '../../src/theme/playerBarStyle.ts';
import { installFakeQueue, queueTracks, type FakeQueue } from '../fixtures/fakeQueue.ts';
import type { PageHost } from '../fixtures/pageHost.ts';
import { choosePlayerBar, openPlayer } from '../fixtures/playerPage.ts';

interface QueuePage {
  readonly host: PageHost;
  readonly queue: FakeQueue;
  readonly errors: string[];
}

/** 开好页面，装一份三首的队列，再按 `style` 形态的那枚队列键把右侧卡开到队列页。 */
async function openQueue(
  page: Page,
  options: { style?: PlayerBarStyle; width?: number } = {},
): Promise<QueuePage> {
  if (options.style) await choosePlayerBar(page, options.style);
  const { host, errors } = await openPlayer(page, { width: options.width });
  const queue = installFakeQueue(host, queueTracks('Teardrop', 'Glory Box', 'Accordion'));
  await host.waitForListener('playback:queueChanged');
  await host.emit('playback:queueChanged', { origin: 'user_added', count: 3 });
  await queueKey(page).click();
  await expect(rows(page)).toHaveCount(3);
  return { host, queue, errors };
}

const queueKey = (page: Page) => page.locator('[data-right-card-key="queue"]');
const card = (page: Page) => page.locator('[data-right-card]');
const rows = (page: Page) => page.locator('[data-queue-section="queued"] [data-queue-row]');
const row = (page: Page, title: string) => rows(page).filter({ hasText: title });

test('底栏形态：队列键在标题栏、窗口三键左边，开合停靠的右侧卡，卡开着时键亮着', async ({
  page,
}) => {
  const { errors } = await openQueue(page);
  const key = queueKey(page);
  await expect(page.locator('header [data-right-card-key="queue"]')).toHaveCount(1);
  await expect(page.locator('[data-player-bar] [data-right-card-key]')).toHaveCount(0);
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  const content = await page.locator('main').boundingBox();
  const panel = await card(page).locator('..').boundingBox();
  if (!content || !panel) throw new Error('卡没画出来');
  expect(Math.round(panel.width)).toBe(320);
  expect(Math.round(panel.x + panel.width)).toBe(Math.round(content.x + content.width) - 8);
  await key.click();
  await expect(card(page)).toHaveCount(0);
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('窄窗：卡是浮层，点外面收起；Esc 收起时焦点回到队列键', async ({ page }) => {
  const { errors } = await openQueue(page, { width: 900 });
  await page.mouse.click(100, 400);
  await expect(card(page)).toHaveCount(0);
  await queueKey(page).click();
  await expect(card(page)).toBeVisible();
  await row(page, 'Glory Box').click();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(queueKey(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('Delete 移除选中的几首；清空之后出提示，撤销按原来的顺序放回', async ({ page }) => {
  const { queue, errors } = await openQueue(page);
  await row(page, 'Teardrop').click();
  await row(page, 'Accordion').click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect.poll(() => queue.titles()).toEqual(['Glory Box']);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Glory Box')).toBeFocused();
  await page.getByRole('button', { name: '清空' }).click();
  await expect.poll(() => queue.titles()).toEqual([]);
  const notice = page.locator('[data-queue-notice]');
  await expect(notice).toContainText('已清空队列，共 1 首');
  await notice.getByText('撤销').click();
  await expect.poll(() => queue.titles()).toEqual(['Glory Box']);
  await expect(rows(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('拖动排序：按住一行拖到另一行上半截，松手一次提交', async ({ page }) => {
  const { queue, host, errors } = await openQueue(page);
  await row(page, 'Accordion').hover();
  await expect(row(page, 'Accordion').locator('[data-queue-handle]')).toBeVisible();
  await row(page, 'Accordion').locator('[data-queue-handle]').hover();
  const from = await row(page, 'Accordion').locator('[data-queue-handle]').boundingBox();
  const to = await row(page, 'Teardrop').boundingBox();
  if (!from || !to) throw new Error('行没画出来');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 8, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => queue.titles()).toEqual(['Accordion', 'Teardrop', 'Glory Box']);
  expect(host.callsTo('queue.setContents')).toHaveLength(1);
  await expect(rows(page).first()).toContainText('Accordion');
  expect(errors).toEqual([]);
});

test('双击立即播放：排在它前面的跳过，它被取走', async ({ page }) => {
  const { queue, host, errors } = await openQueue(page);
  await row(page, 'Accordion').dblclick();
  await expect.poll(() => host.callsTo('queue.playNow')).toEqual([{ index: 0 }]);
  await expect.poll(() => queue.titles()).toEqual([]);
  expect(errors).toEqual([]);
});

test('右键菜单：作用于右键的那一行，「移到队首」改顺序', async ({ page }) => {
  const { queue, errors } = await openQueue(page);
  await row(page, 'Accordion').click({ button: 'right' });
  const menu = page.locator('[data-queue-menu="queued"]');
  await expect(menu).toContainText('队列第 3 项');
  await menu.getByRole('menuitem', { name: '移到队首' }).click();
  await expect.poll(() => queue.titles()).toEqual(['Accordion', 'Teardrop', 'Glory Box']);
  expect(errors).toEqual([]);
});

test('标题栏形态：队列键在导航行，开合同一张卡', async ({ page }) => {
  const { errors } = await openQueue(page, { style: 'titlebar' });
  await expect(page.locator('[data-nav-row] [data-right-card-key="queue"]')).toHaveCount(1);
  await expect(page.locator('header [data-right-card-key]')).toHaveCount(0);
  await queueKey(page).click();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('暂停与恢复只更新面板状态，队列和历史不变；侧边栏没有队列占位', async ({ page }) => {
  const { host, queue, errors } = await openQueue(page);
  const status = page.locator('[data-right-card-playback-state]');
  await expect(status).toHaveAttribute('data-right-card-playback-state', 'playing');
  const titles = queue.titles();
  const history = page.locator('[data-queue-review-toggle]');
  await expect(history).toHaveCount(0);
  await host.emit('playback:paused', { paused: true });
  await expect(status).toHaveText('已暂停');
  await host.emit('playback:paused', { paused: false });
  await expect(status).toHaveText('正在播放');
  expect(queue.titles()).toEqual(titles);
  await expect(history).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '侧边栏' }).getByRole('button', { name: /播放队列/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
