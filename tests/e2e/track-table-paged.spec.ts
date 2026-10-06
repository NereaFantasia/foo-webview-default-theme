import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  clearHarnessLog,
  harnessGrid as grid,
  harnessGroup as group,
  harnessLog,
  harnessRow as row,
  openTableHarness,
} from '../fixtures/tableHarnessPage.ts';

// 表格内核给分页取行的调用方留的口：画出来的区间、按行给的评分戳、调用方自己做的打字即跳，以及句柄的
// `reveal`。试验页扮演调用方，把表格报的区间与找到的条目记在页面里。

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** 试验页记下的 `onRange` 区间，按先后。 */
async function ranges(page: Page): Promise<{ start: number; end: number }[]> {
  const log = await harnessLog(page);
  return log.flatMap((entry) =>
    typeof entry === 'object' && entry !== null && Reflect.get(entry, 'type') === 'range'
      ? [{ start: Number(Reflect.get(entry, 'start')), end: Number(Reflect.get(entry, 'end')) }]
      : [],
  );
}

/** 行的滚动区。 */
function scroller(page: Page): Locator {
  return grid(page).locator('[role="rowgroup"]').last().locator('..');
}

function reveal(page: Page, index: number, select: boolean): Promise<unknown> {
  return page.evaluate(
    ([at, pick]) => {
      const call: unknown = Reflect.get(window, '__tableReveal');
      return typeof call === 'function' ? call(at, pick) : null;
    },
    [index, select] as const,
  );
}

/** 这一行的中线离滚动区中线多远，CSS 像素。 */
async function offCenter(page: Page, target: Locator): Promise<number> {
  const box = await scroller(page).boundingBox();
  const hit = await target.boundingBox();
  if (!box || !hit) throw new Error('量不到行或滚动区');
  return Math.abs(hit.y + hit.height / 2 - (box.y + box.height / 2));
}

test('画出来的区间变了才报：滚动报新区间，重画但区间与条目流都没变时不报', async ({ page }) => {
  await openTableHarness(page, { rows: 500, range: true });
  await expect.poll(async () => (await ranges(page)).at(-1)?.start).toBe(0);
  const first = (await ranges(page)).at(-1);
  expect(first?.end).toBeGreaterThan(10);
  expect(first?.end).toBeLessThan(40);

  await clearHarnessLog(page);
  await scroller(page).evaluate((element) => {
    element.scrollTop = 36 * 200;
  });
  await expect.poll(async () => (await ranges(page)).at(-1)?.start ?? 0).toBeGreaterThan(180);
  const scrolled = (await ranges(page)).at(-1);
  expect((scrolled?.end ?? 0) - (scrolled?.start ?? 0)).toBeLessThan(40);

  await clearHarnessLog(page);
  await row(page, 'Track 0203').click();
  await expect(row(page, 'Track 0203')).toHaveAttribute('aria-selected', 'true');
  expect(await ranges(page)).toEqual([]);
});

test('条目流换了一份时区间没变也报：开合之后同一段显示位已是另一批行', async ({ page }) => {
  await openTableHarness(page, { albums: 10, rows: 10, range: true });
  await expect.poll(async () => (await ranges(page)).length).toBeGreaterThan(0);
  const before = (await ranges(page)).at(-1);
  await clearHarnessLog(page);
  await group(page, 'Album 0').getByRole('button').click();
  await expect(row(page, 'Track 0001')).toHaveCount(0);
  await expect.poll(() => ranges(page)).toEqual([before]);
});

test('按行给评分戳：事件晚于各页的戳，两页的行都换成事件报的值', async ({ page }) => {
  const host = await openTableHarness(page, { rows: 20, pageStamps: 5 });
  await host.waitForListener('metadb:changed');
  const file = (order: string) => `E:/Music/Album 0/${order}.flac`;
  await host.emit('metadb:changed', {
    tracks: [
      { handle: file('0002'), path: file('0002'), subsong: 0, rating: 4 },
      { handle: file('0008'), path: file('0008'), subsong: 0, rating: 3 },
    ],
    count: 2,
    fromHook: false,
    timestamp: 0,
  });
  await expect(row(page, 'Track 0002').getByRole('radio', { name: '4' })).toBeChecked();
  await expect(row(page, 'Track 0008').getByRole('radio', { name: '3' })).toBeChecked();
});

test('调用方做的打字即跳：键交给它，找到后经句柄落焦点、选中并滚到视口中间', async ({ page }) => {
  await openTableHarness(page, { rows: 300, asyncSearch: true });
  await row(page, 'Track 0001').click();
  await page.keyboard.type('track 0120');
  const hit = row(page, 'Track 0120');
  await expect(hit).toHaveAttribute('data-row-focus', 'true');
  await expect(hit).toHaveAttribute('aria-selected', 'true');
  expect(await offCenter(page, hit)).toBeLessThan(36);
  expect((await harnessLog(page)).at(-1)).toEqual({ type: 'typeSearch', key: 'r119' });

  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Track 0121')).toHaveAttribute('data-row-focus', 'true');
});

test('reveal：只落焦点不改选中；select 时只选它；分组头只落焦点；那一位不是条目时答假', async ({
  page,
}) => {
  await openTableHarness(page, { albums: 3, rows: 100 });
  await row(page, 'Track 0001').click();
  // 条目流是 [Album 0, 100 行, Album 1, 100 行, …]，显示位 150 是第 149 首。
  expect(await reveal(page, 150, false)).toBe(true);
  const target = row(page, 'Track 0149');
  await expect(target).toHaveAttribute('data-row-focus', 'true');
  await expect(target).toHaveAttribute('aria-selected', 'false');
  expect(await offCenter(page, target)).toBeLessThan(36);

  expect(await reveal(page, 160, true)).toBe(true);
  await expect(row(page, 'Track 0159')).toHaveAttribute('aria-selected', 'true');
  expect(await reveal(page, 101, true)).toBe(true);
  await expect(group(page, 'Album 1')).toHaveAttribute('data-row-focus', 'true');
  expect(await reveal(page, 160, false)).toBe(true);
  await expect(row(page, 'Track 0159')).toHaveAttribute('aria-selected', 'true');
  expect(await reveal(page, 9999, true)).toBe(false);
  // 只选它：先前单击选中的第一首已不在选中里。
  expect(await reveal(page, 1, false)).toBe(true);
  await expect(row(page, 'Track 0001')).toHaveAttribute('aria-selected', 'false');
});
