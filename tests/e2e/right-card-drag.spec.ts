import { expect, test, type Page } from '@playwright/test';
import { installFakeQueue, queueTracks } from '../fixtures/fakeQueue.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { openLargeQueue, queueScroller } from '../fixtures/rightCardPage.ts';

async function openQueue(page: Page, count = 80, upcoming = false) {
  const { host, errors } = upcoming ? await openLargeQueue(page, 8) : await openPlayer(page);
  const names = Array.from({ length: count }, (_, i) => `待播 ${i + 1}`);
  const queue = installFakeQueue(host, queueTracks(...names));
  await host.waitForListener('playback:queueChanged');
  await host.emit('playback:queueChanged', { origin: 'user_added', count: names.length });
  if (!upcoming) await page.locator('[data-right-card-key="queue"]').click();
  await expect(queuedRows(page)).toHaveCount(count);
  return { host, errors, queue, names };
}

const queuedRows = (page: Page) => page.locator('[data-queue-section="queued"] [data-queue-row]');

test('长队列拖到下缘后指针不动仍持续滚动，松手按可见落点重排并停止滚动', async ({ page }) => {
  const { queue, errors } = await openQueue(page);
  const scroller = queueScroller(page);
  const first = page.locator('[data-queue-section="queued"] [data-queue-row]').first();
  const handle = first.locator('[data-queue-handle]');
  await first.hover();
  await expect(handle).toBeVisible();
  await handle.hover();
  const start = await handle.boundingBox();
  const bounds = await scroller.boundingBox();
  if (!start || !bounds) throw new Error('队列不可见');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, bounds.y + bounds.height - 4, { steps: 8 });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(450);
  await page.mouse.move(start.x + start.width / 2, bounds.y + bounds.height / 2);
  const beforeKey = await page
    .locator('[data-queue-section="queued"] [data-queue-row]')
    .evaluateAll(
      (nodes, y) =>
        nodes
          .find(
            (node) =>
              !node.hasAttribute('data-lifted') &&
              node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2 > y,
          )
          ?.getAttribute('data-queue-row'),
      bounds.y + bounds.height / 2,
    );
  await page.mouse.up();
  await expect.poll(() => queue.titles().indexOf('待播 1')).toBeGreaterThan(5);
  const after = queue.titles();
  const moved = after.indexOf('待播 1');
  const next = queue.items[moved + 1];
  expect(next && `${next.track.handle}#0`).toBe(beforeKey);
  const stoppedAt = await scroller.evaluate((node) => node.scrollTop);
  await page.waitForTimeout(180);
  expect(await scroller.evaluate((node) => node.scrollTop)).toBe(stoppedAt);
  await expect(page.locator('[data-lifted]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('拖到上缘能返回前段，Esc 取消后保持原队列且不再自动滚动', async ({ page }) => {
  const { queue, names, errors } = await openQueue(page);
  const scroller = queueScroller(page);
  await scroller.evaluate((node) => {
    node.scrollTop = 1600;
  });
  const target = page
    .locator('[data-queue-section="queued"] [data-queue-row]')
    .filter({ hasText: '待播 35' });
  const handle = target.locator('[data-queue-handle]');
  await target.hover();
  await expect(handle).toBeVisible();
  await handle.hover();
  const start = await handle.boundingBox();
  const bounds = await scroller.boundingBox();
  if (!start || !bounds) throw new Error('队列不可见');
  const before = await scroller.evaluate((node) => node.scrollTop);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, bounds.y + 3, { steps: 8 });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(before - 300);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-lifted]')).toHaveCount(0);
  const stoppedAt = await scroller.evaluate((node) => node.scrollTop);
  await page.waitForTimeout(180);
  expect(await scroller.evaluate((node) => node.scrollTop)).toBe(stoppedAt);
  expect(queue.titles()).toEqual(names);
  expect(errors).toEqual([]);
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme}：手柄替换序号，完整行副本保留抓取偏移并随横纵移动`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const { queue, host, errors } = await openQueue(page, 3);
    const target = queuedRows(page).nth(2);
    const handle = target.locator('[data-queue-handle]');
    const number = target.getByText('3', { exact: true });
    await expect(handle).toBeHidden();
    await expect(number).toBeVisible();
    await target.hover();
    await expect(handle).toBeVisible();
    await expect(number).toBeHidden();
    const box = await target.boundingBox();
    if (!box) throw new Error('队列行不可见');
    await page.mouse.move(box.x + 90, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 42, box.y - 45, { steps: 4 });
    const preview = page.locator('[data-queue-drag-preview]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(['待播 3', 'Nujabes · Modal Soul', '2:55'].join(''));
    await expect(preview.locator('button, a, [tabindex], [data-queue-row]')).toHaveCount(0);
    const lifted = await preview.boundingBox();
    if (!lifted) throw new Error('拖动副本不可见');
    expect(lifted.x).toBeCloseTo(box.x - 48, 0);
    expect(lifted.y).toBeCloseTo(box.y - 55, 0);
    expect(lifted.width).toBeCloseTo(box.width, 0);
    expect(lifted.height).toBe(48);
    expect(host.callsTo('queue.setContents')).toHaveLength(0);
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => queue.titles()).toEqual(['待播 1', '待播 3', '待播 2']);
    expect(host.callsTo('queue.setContents')).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

for (const destination of ['卡片外', '接下来'] as const) {
  test(`拖到${destination}隐藏落点线，松手取消排序`, async ({ page }) => {
    const { queue, names, host, errors } = await openQueue(page, 3, true);
    const target = queuedRows(page).first();
    const upcoming = page.locator('[data-kind="upnext"]').first();
    await expect(upcoming).toBeVisible();
    await target.hover();
    const box = await target.boundingBox();
    const nextBox = await upcoming.boundingBox();
    if (!box || !nextBox) throw new Error('队列或接下来不可见');
    await page.mouse.move(box.x + 90, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 70, { steps: 3 });
    await expect(page.locator('[data-queue-drop-line]')).toBeVisible();
    await page.mouse.move(destination === '卡片外' ? box.x - 40 : nextBox.x + 90, nextBox.y + 10, {
      steps: 3,
    });
    await expect(page.locator('[data-queue-drop-line]')).toHaveCount(0);
    await expect(page.locator('[data-queue-drag-preview]')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[data-queue-drag-preview], [data-lifted]')).toHaveCount(0);
    await page.waitForTimeout(120);
    expect(host.callsTo('queue.setContents')).toHaveLength(0);
    expect(queue.titles()).toEqual(names);
    expect(errors).toEqual([]);
  });
}

test('指针离开后回到队列可继续拖动，多选按原顺序一起提交', async ({ page }) => {
  const { queue, host, errors } = await openQueue(page, 5);
  await queuedRows(page)
    .nth(1)
    .click({ position: { x: 90, y: 10 } });
  await queuedRows(page)
    .nth(3)
    .click({ modifiers: ['Control'], position: { x: 90, y: 10 } });
  await queuedRows(page).first().scrollIntoViewIfNeeded();
  const target = queuedRows(page).nth(1);
  await target.hover();
  const box = await target.boundingBox();
  const first = await queuedRows(page).first().boundingBox();
  if (!box || !first) throw new Error('队列不可见');
  await page.mouse.move(box.x + 90, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 60, { steps: 3 });
  await expect(page.locator('[data-lifted]')).toHaveCount(2);
  await expect(page.locator('[data-queue-drop-line]')).toHaveCount(0);
  await page.mouse.move(first.x + 90, first.y + 4, { steps: 3 });
  await expect(page.locator('[data-queue-drop-line]')).toBeVisible();
  expect(host.callsTo('queue.setContents')).toHaveLength(0);
  await page.mouse.up();
  await expect
    .poll(() => queue.titles())
    .toEqual(['待播 2', '待播 4', '待播 1', '待播 3', '待播 5']);
  expect(host.callsTo('queue.setContents')).toHaveLength(1);
  expect(errors).toEqual([]);
});
