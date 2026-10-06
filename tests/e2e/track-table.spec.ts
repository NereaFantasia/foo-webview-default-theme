import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  gotoHarness,
  harnessGrid as grid,
  harnessLog,
  harnessRow as row,
  openTableHarness,
  tokenColor,
} from '../fixtures/tableHarnessPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 表格内核在试验页上的行为：虚拟滚动、选中与焦点、键盘、起播、菜单、评分、正在播放与骨架行。分组头的
// 用例在 track-table-groups。试验页扮演表格的调用方，交给调用方的动作记在页面里，这里读出来断言。

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** 行的滚动区在视口里的上下边。 */
async function scrollerBox(page: Page): Promise<{ top: number; bottom: number }> {
  return grid(page)
    .locator('[role="rowgroup"]')
    .last()
    .evaluate((body) => {
      const box = body.parentElement?.getBoundingClientRect();
      return { top: box?.top ?? 0, bottom: box?.bottom ?? 0 };
    });
}

test('五千行只画看得见的几十行，滚到底看得到最后一首', async ({ page }) => {
  await openTableHarness(page, { rows: 5000 });
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '5001');
  expect(await grid(page).getByRole('row').count()).toBeLessThan(40);

  await row(page, 'Track 0001').click();
  await page.keyboard.press('End');
  await expect(row(page, 'Track 5000')).toBeInViewport();
  await expect(row(page, 'Track 5000')).toHaveAttribute('data-row-focus', 'true');
  expect(await grid(page).getByRole('row').count()).toBeLessThan(40);
});

test('读屏：平铺表也是 treegrid，行在第 1 层；行数与行号不算封面下垫的空位；空表的空态包在行与格里', async ({
  page,
}) => {
  await openTableHarness(page, { rows: 3 });
  await expect(grid(page)).toHaveAttribute('role', 'treegrid');
  await expect(row(page, 'Track 0001')).toHaveAttribute('aria-level', '1');
  await expect(row(page, 'Track 0002')).toHaveAttribute('aria-rowindex', '3');

  await gotoHarness(page, { albums: 2, rows: 2, cover: true });
  // 两组各一个分组头、两行曲目，封面下垫的空位不是行。
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '7');
  await expect(row(page, 'Track 0003')).toHaveAttribute('aria-rowindex', '6');
  await expect(row(page, 'Track 0003')).toHaveAttribute('aria-level', '2');

  await gotoHarness(page, { rows: 0 });
  const empty = grid(page)
    .getByRole('row')
    .filter({ has: page.locator('[data-empty]') });
  await expect(empty.getByRole('gridcell')).toContainText('空表');
});

test('窗口只长高不到一行时，行的视口跟着长，底下不留空白', async ({ page }) => {
  await openTableHarness(page, { rows: 50 });
  const heights = () =>
    grid(page)
      .locator('[role="rowgroup"]')
      .last()
      .evaluate((body) => ({
        scroller: body.parentElement?.clientHeight ?? 0,
        viewport: body.firstElementChild?.getBoundingClientRect().height ?? 0,
      }));
  const before = await heights();
  expect(before.viewport).toBe(before.scroller);
  await page.locator('[data-harness-box]').evaluate((box) => {
    if (box instanceof HTMLElement) box.style.height = `${box.offsetHeight + 12}px`;
  });
  await expect.poll(async () => (await heights()).scroller).toBe(before.scroller + 12);
  await expect.poll(async () => (await heights()).viewport).toBe(before.scroller + 12);
});

test('单击只选它，Ctrl 单击切换，Shift 单击从锚选一段', async ({ page }) => {
  await openTableHarness(page);
  await row(page, 'Track 0003').click();
  await row(page, 'Track 0005').click({ modifiers: ['Control'] });
  await expect(row(page, 'Track 0003')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Track 0005')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Track 0004')).toHaveAttribute('aria-selected', 'false');

  await row(page, 'Track 0008').click({ modifiers: ['Shift'] });
  for (const title of ['Track 0005', 'Track 0006', 'Track 0007', 'Track 0008']) {
    await expect(row(page, title)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(row(page, 'Track 0003')).toHaveAttribute('aria-selected', 'false');

  await row(page, 'Track 0002').click();
  await expect(row(page, 'Track 0002')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Track 0006')).toHaveAttribute('aria-selected', 'false');
  const status = row(page, 'Track 0002').locator('[data-column-id="status"]');
  await expect(status).toBeEmpty();
});

test('上下键移焦点并改选中，Shift 扩选，Ctrl+A 全选；只在用键盘时焦点行描一圈', async ({
  page,
}) => {
  await openTableHarness(page, { rows: 300 });
  await row(page, 'Track 0001').click();
  await expect(row(page, 'Track 0001')).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const third = row(page, 'Track 0003');
  await expect(third).toHaveAttribute('data-row-focus', 'true');
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Track 0001')).toHaveAttribute('aria-selected', 'false');
  await expect(third).toHaveCSS('outline-style', 'solid');
  const id = await third.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(grid(page)).toHaveAttribute('aria-activedescendant', id ?? '');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(row(page, 'Track 0004')).toHaveAttribute('aria-selected', 'true');
  await expect(third).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+a');
  await expect(row(page, 'Track 0001')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Track 0010')).toHaveAttribute('aria-selected', 'true');
  await grid(page)
    .locator('[role="rowgroup"]')
    .last()
    .evaluate((body) => body.parentElement?.scrollTo({ top: 1e6 }));
  await expect(row(page, 'Track 0300')).toHaveAttribute('aria-selected', 'true');
});

test('双击与回车交给调用方起播', async ({ page }) => {
  await openTableHarness(page);
  await row(page, 'Track 0004').dblclick();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await harnessLog(page)).toEqual([
    { type: 'play', key: 'r3' },
    { type: 'play', key: 'r4' },
  ]);
});

test('右键落在选中里作用于整批，落在外面只作用于它；键盘也能开菜单', async ({ page }) => {
  await openTableHarness(page);
  await row(page, 'Track 0002').click();
  await row(page, 'Track 0004').click({ modifiers: ['Shift'] });
  await row(page, 'Track 0003').click({ button: 'right' });
  await row(page, 'Track 0007').click({ button: 'right' });
  await expect(row(page, 'Track 0007')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Track 0002')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ContextMenu');
  expect(await harnessLog(page)).toMatchObject([
    { type: 'menu', key: 'r2', rows: [1, 2, 3] },
    { type: 'menu', key: 'r6', rows: [6] },
    { type: 'menu', key: 'r7', rows: [7] },
    { type: 'menu', key: 'r7', rows: [7] },
  ]);
});

test('焦点行滚出视口后用键盘开菜单：先滚回来，菜单落在那一行底下', async ({ page }) => {
  await openTableHarness(page, { rows: 300 });
  const tenth = row(page, 'Track 0010');
  await tenth.click();
  const area = await scrollerBox(page);
  await page.mouse.move(300, (area.top + area.bottom) / 2);
  // 往下滚十二行：第 10 行到了视口上面第三行，还在多画的那几条里，DOM 里有、屏幕上看不见。
  await page.mouse.wheel(0, 36 * 12);
  await expect(tenth).not.toBeInViewport();
  await page.keyboard.press('Shift+F10');
  await expect(tenth).toBeInViewport();
  // 再滚远一些，那一行已经不在 DOM 里。
  await page.mouse.wheel(0, 36 * 200);
  await expect(tenth).toHaveCount(0);
  await page.keyboard.press('ContextMenu');
  await expect(tenth).toBeInViewport();

  const box = await scrollerBox(page);
  const points = (await harnessLog(page)).map((entry) =>
    typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'point') : undefined,
  );
  expect(points).toHaveLength(2);
  for (const point of points) {
    const y = typeof point === 'object' && point !== null ? Number(Reflect.get(point, 'y')) : NaN;
    expect(y).toBeGreaterThan(box.top);
    expect(y).toBeLessThanOrEqual(box.bottom);
  }
});

test('打字即跳落到标题以这串字开头的那一首', async ({ page }) => {
  await openTableHarness(page, { rows: 300, typing: true });
  await row(page, 'Track 0001').click();
  await page.keyboard.type('track 0120');
  const hit = row(page, 'Track 0120');
  await expect(hit).toBeInViewport();
  await expect(hit).toHaveAttribute('data-row-focus', 'true');
  await expect(hit).toHaveAttribute('aria-selected', 'true');
});

test('点星写评分并选中这一行，点当前那一颗清零；双击一颗星只写一次、不起播', async ({ page }) => {
  const host = await openTableHarness(page);
  host.answer('rating.set', (params) => ({
    success: true,
    path: String(params['path']),
    rating: Number(params['rating']),
    storage: 'file',
  }));
  const first = row(page, 'Track 0001');
  const star = (value: string) => first.getByRole('radio', { name: value });
  await star('4').click();
  await expect(star('4')).toBeChecked();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await star('4').click();
  await expect(star('4')).not.toBeChecked();

  await star('2').dblclick();
  await expect(star('2')).toBeChecked();
  const path = 'file://E:/Music/Album 0/0001.flac';
  expect(host.callsTo('rating.set')).toEqual([
    { path, rating: 4, cueIndex: 0 },
    { path, rating: 0, cueIndex: 0 },
    { path, rating: 2, cueIndex: 0 },
  ]);
  expect(await harnessLog(page)).toEqual([]);
});

test('正在播放的那一行：序号格画记号，整行文字取品牌色，悬停与深色档也不变；暂停时记号静止', async ({
  page,
}) => {
  const playing = makeTrack({ path: 'file://E:/Music/Album 0/0002.flac', title: 'Track 0002' });
  const host = await openTableHarness(
    page,
    {},
    {
      answers: {
        playback: {
          getState: { success: true, state: 'playing', canSeek: true, canPause: true },
          getCurrentTrack: { success: true, found: true, track: playing },
        },
      },
    },
  );
  const mark = row(page, 'Track 0002').getByRole('img', { name: '正在播放' });
  await expect(mark).toHaveAttribute('data-active', 'true');
  await expect(row(page, 'Track 0001').locator('[data-column-id="number"]')).toHaveText('01');
  const colorOf = (title: string, column: string) =>
    row(page, title)
      .locator(`[data-column-id="${column}"] > span`)
      .evaluate((element) => getComputedStyle(element).color);
  const expectBrand = async () => {
    const brand = await tokenColor(page, '--colorBrandForeground1');
    expect(await colorOf('Track 0002', 'title')).toBe(brand);
    expect(await colorOf('Track 0002', 'artist')).toBe(brand);
    expect(await colorOf('Track 0001', 'artist')).not.toBe(brand);
    return brand;
  };
  const light = await expectBrand();
  await row(page, 'Track 0002').hover();
  expect(await colorOf('Track 0002', 'title')).toBe(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => tokenColor(page, '--colorBrandForeground1')).not.toBe(light);
  await expectBrand();

  await host.waitForListener('playback:stateChanged');
  await host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'paused',
    position: 10,
    duration: playing.duration,
    canSeek: true,
  });
  await expect(mark).not.toHaveAttribute('data-active');
});

test('还没取到的行画骨架、报忙；照样能选中与交给调用方', async ({ page }) => {
  await openTableHarness(page, { rows: 20, pending: 3, loading: true });
  await expect(grid(page)).toHaveAttribute('aria-busy', 'true');
  const pending = grid(page).locator('[role="row"][aria-busy="true"]');
  await expect(pending.first()).toBeVisible();
  await expect(pending.first().getByRole('radio')).toHaveCount(0);
  await pending.first().click();
  await expect(pending.first()).toHaveAttribute('aria-selected', 'true');
  await pending.first().dblclick();
  expect(await harnessLog(page)).toEqual([{ type: 'play', key: 'r3' }]);
});

test('没有条目时画调用方给的空态', async ({ page }) => {
  await openTableHarness(page, { rows: 0 });
  await expect(grid(page).getByText('空表')).toBeVisible();
});
