import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  clearHarnessLog,
  harnessGrid as grid,
  harnessHeader,
  harnessLog,
  harnessRow as row,
  openTableHarness,
} from '../fixtures/tableHarnessPage.ts';

// 表格的行跟着页面的滚动盒滚：表格上方垫着别的内容，列头滚到顶时吸住，行只画在列头下面；键盘翻页、
// 焦点滚入视口与键盘开菜单都按列头下面那一截算。试验页的滚动盒 480 高，上方垫 300，行高 36。

const ROW = 36;
const ABOVE = 300;
/** 试验页滚动盒的上内边距。 */
const PAD = 16;

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const box = (page: Page) => page.locator('[data-harness-page]');
const head = (page: Page) => grid(page).locator('[role="rowgroup"]').first();
/** 贴住视口、裁住行的那一层。 */
const shown = (page: Page) =>
  grid(page).locator('[role="rowgroup"]').nth(1).locator('> [role="none"]');

/** 试验页记下的一次菜单动作的落点纵坐标；认不出时答 NaN，断言随之失败。 */
function pointY(entry: unknown): number {
  if (typeof entry !== 'object' || entry === null || !('point' in entry)) return Number.NaN;
  const point = entry.point;
  if (typeof point !== 'object' || point === null || !('y' in point)) return Number.NaN;
  return typeof point.y === 'number' ? point.y : Number.NaN;
}

async function rect(target: Locator) {
  const value = await target.boundingBox();
  if (!value) throw new Error('元素不在页面上');
  return { top: value.y, bottom: value.y + value.height, left: value.x };
}

async function scrollTo(page: Page, top: number): Promise<void> {
  await box(page).evaluate((element, value) => element.scrollTo({ top: value }), top);
  await expect.poll(() => box(page).evaluate((element) => element.scrollTop)).toBe(top);
}

/** 紧贴列头下沿的那一点落在哪一行上。 */
function rowUnderHead(page: Page): Promise<string> {
  return page.evaluate(() => {
    const table = document.querySelector('[aria-label="试验表"]');
    const header = table?.querySelector('[role="rowgroup"]')?.getBoundingClientRect();
    if (!header) return '';
    const hit = document.elementFromPoint(header.left + header.width / 2, header.bottom + 2);
    return (
      hit?.closest('[role="row"]')?.querySelector('[data-column-id="title"]')?.textContent ?? ''
    );
  });
}

test('表格顶还在盒里时跟着内容走；滚过之后列头吸在内边距下，行只画在列头下面、位置不走样', async ({
  page,
}) => {
  await openTableHarness(page, { page: 1, rows: 200, above: ABOVE });
  const outer = await rect(box(page));
  expect((await rect(head(page))).top).toBeCloseTo(outer.top + PAD + ABOVE, 0);
  await scrollTo(page, 100);
  expect((await rect(head(page))).top).toBeCloseTo(outer.top + PAD + ABOVE - 100, 0);
  expect(await rowUnderHead(page)).toBe('Track 0001');

  // 刚吸住的那一小段与滚得很深的地方各看一次：行画在它在滚动内容里本来的位置上。
  for (const top of [ABOVE + 8, 1000]) {
    await scrollTo(page, top);
    const header = await rect(head(page));
    expect(header.top).toBeCloseTo(outer.top + PAD, 0);
    expect((await rect(shown(page))).top).toBeCloseTo(header.bottom, 0);
    const title = await rowUnderHead(page);
    const order = Number(title.replace('Track ', ''));
    const body = outer.top + PAD + ABOVE + (header.bottom - header.top) - top;
    expect((await rect(row(page, title))).top).toBeCloseTo(body + (order - 1) * ROW, 0);
  }
});

test('滚到底、下面还有内边距：最后一行贴着表体底边，行照样不钻到列头下面', async ({ page }) => {
  await openTableHarness(page, { page: 1, rows: 200, above: ABOVE, below: 40 });
  const max = await box(page).evaluate((element) => element.scrollHeight - element.clientHeight);
  await scrollTo(page, max);
  const outer = await rect(box(page));
  const last = await rect(row(page, 'Track 0200'));
  expect(last.bottom).toBeCloseTo(outer.bottom - 40, 0);
  const body = await rect(grid(page).locator('[role="rowgroup"]').nth(1));
  const layer = await rect(shown(page));
  expect(layer.bottom).toBeCloseTo(body.bottom, 0);
  expect(layer.top).toBeCloseTo((await rect(head(page))).bottom, 0);
});

test('PageDown 按列头下面看得见的行数翻；End、Home 把焦点行滚到列头下面', async ({ page }) => {
  await openTableHarness(page, { page: 1, rows: 200, above: ABOVE });
  await scrollTo(page, ABOVE);
  await row(page, 'Track 0001').click();
  const header = await rect(head(page));
  const pageRows = Math.floor((480 - PAD - (header.bottom - header.top)) / ROW);
  await page.keyboard.press('PageDown');
  const focused = async () => {
    const id = await grid(page).getAttribute('aria-activedescendant');
    return page.locator(`[id="${id}"] [data-column-id="title"]`).textContent();
  };
  expect(await focused()).toBe(`Track ${String(1 + pageRows).padStart(4, '0')}`);

  await page.keyboard.press('End');
  const last = row(page, 'Track 0200');
  await expect(last).toBeInViewport();
  await page.keyboard.press('Home');
  const first = row(page, 'Track 0001');
  await expect(first).toBeVisible();
  // 回到第一首：滚到它正好露在列头下面，不被吸顶的列头盖住一截。
  await expect
    .poll(async () => Math.round((await rect(first)).top))
    .toBe(Math.round((await rect(head(page))).bottom));
});

test('盒底留着下内边距：键盘翻页只翻它上面看得见的行，焦点行停在内边距上面', async ({ page }) => {
  const below = 80;
  await openTableHarness(page, { page: 1, rows: 200, above: ABOVE, below });
  await scrollTo(page, ABOVE);
  await row(page, 'Track 0001').click();
  const header = await rect(head(page));
  const pageRows = Math.floor((480 - PAD - below - (header.bottom - header.top)) / ROW);
  await page.keyboard.press('PageDown');
  const focusedTitle = `Track ${String(1 + pageRows).padStart(4, '0')}`;
  const id = await grid(page).getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${id}"] [data-column-id="title"]`)).toHaveText(focusedTitle);
  await page.keyboard.press('ArrowDown');
  const next = row(page, `Track ${String(2 + pageRows).padStart(4, '0')}`);
  const outer = await rect(box(page));
  await expect
    .poll(async () => Math.round((await rect(next)).bottom))
    .toBe(Math.round(outer.bottom - below));
});

test('焦点行滚出去后用键盘开菜单：先滚回来，落点在列头下面、盒子里面', async ({ page }) => {
  await openTableHarness(page, { page: 1, rows: 200, above: ABOVE });
  await row(page, 'Track 0003').click();
  await scrollTo(page, 3000);
  await clearHarnessLog(page);
  await page.keyboard.press('Shift+F10');
  await expect.poll(async () => (await harnessLog(page)).length).toBe(1);
  const [entry] = await harnessLog(page);
  const y = pointY(entry);
  const outer = await rect(box(page));
  expect(y).toBeGreaterThan((await rect(head(page))).bottom);
  expect(y).toBeLessThanOrEqual(outer.bottom);
});

test('列头与行的各列对齐：两边都不留滚动条的槽', async ({ page }) => {
  await openTableHarness(page, { page: 1, rows: 50, above: ABOVE });
  const heading = await rect(harnessHeader(page, '时长'));
  const cell = await rect(row(page, 'Track 0001').locator('[data-column-id="duration"]'));
  expect(cell.left).toBeCloseTo(heading.left, 0);
  const header = await rect(head(page));
  const body = await rect(grid(page).locator('[role="rowgroup"]').nth(1));
  expect(body.top).toBeCloseTo(header.bottom, 0);
});
