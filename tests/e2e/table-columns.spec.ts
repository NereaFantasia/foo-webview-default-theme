import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  focusedColumn,
  gotoHarness,
  harnessGrid as grid,
  harnessGroup as group,
  harnessHeader as header,
  harnessLog,
  harnessRow as row,
  headerOrder,
  openTableHarness,
  storedColumns,
} from '../fixtures/tableHarnessPage.ts';

// 表格的列头：排序、拖分隔条改宽、拖列头与 Alt+← → 换列、Tab 次序、封面列与窄档，以及列存档落盘后重载
// 还在。列的勾选菜单在 table-column-menu。

// 无头浏览器缺省藏起滚动条，滚动条不占宽；宿主里是传统滚动条，这里照样画出来，列头与行才对得上真实情形。
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function widthOf(cell: Locator): Promise<number> {
  return (await cell.boundingBox())?.width ?? 0;
}

/** 按住列头或分隔条的中心，横向挪 `dx`；`finish` 在松手前做别的事（比如按 Esc）。 */
async function drag(page: Page, from: Locator, dx: number, finish?: () => Promise<void>) {
  const box = await from.boundingBox();
  if (!box) throw new Error('拖动的起点不在页面上');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(dx) * 10, y, { steps: 2 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await finish?.();
  await page.mouse.up();
}

/** 跟着指针走的列名：挂在 body 下的浮层里，不在表格里。 */
function ghost(page: Page, name: string): Locator {
  return page.locator('body > :not(#root) span[aria-hidden="true"]', { hasText: name });
}

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('列头与曲目行的各列对齐：两边都给滚动条留了槽', async ({ page }) => {
  await openTableHarness(page, { rows: 200 });
  const scrollbar = await grid(page)
    .locator('[role="rowgroup"]')
    .last()
    .evaluate((body) => {
      const scroller = body.parentElement;
      return scroller ? scroller.offsetWidth - scroller.clientWidth : 0;
    });
  expect(scrollbar).toBeGreaterThan(0);
  const first = row(page, 'Track 0001');
  for (const id of ['number', 'title', 'artist', 'album', 'rating', 'duration']) {
    const head = await grid(page)
      .locator(`[role="columnheader"][data-column-id="${id}"]`)
      .boundingBox();
    const cell = await first.locator(`[data-column-id="${id}"]`).boundingBox();
    expect(Math.abs((head?.x ?? 0) - (cell?.x ?? 1))).toBeLessThan(1);
    expect(Math.abs((head?.width ?? 0) - (cell?.width ?? 1))).toBeLessThan(1);
  }
});

test('单击列头交给调用方排序，指示跟着调用方给的走；带 Shift、Ctrl 的单击不排', async ({
  page,
}) => {
  await openTableHarness(page, { sortable: true });
  const title = header(page, '标题');
  await title.click();
  await expect(title).toHaveAttribute('aria-sort', 'ascending');
  await title.click();
  await expect(title).toHaveAttribute('aria-sort', 'descending');
  await title.click({ modifiers: ['Shift'] });
  await title.click({ modifiers: ['Control'] });
  await header(page, '状态').click();
  expect(await harnessLog(page)).toEqual([
    { type: 'sort', column: 'title' },
    { type: 'sort', column: 'title' },
  ]);
  await expect(header(page, '状态')).not.toHaveAttribute('aria-sort');
});

test('不给排序时列头点不着，也没有排序指示', async ({ page }) => {
  await openTableHarness(page);
  await header(page, '标题').click();
  await expect(header(page, '标题')).not.toHaveAttribute('aria-sort');
  expect(await harnessLog(page)).toEqual([]);
});

test('拖分隔条改宽，两侧一起改；落盘后重载还在；拖动中 Esc 回到原宽', async ({ page }) => {
  await openTableHarness(page);
  const title = header(page, '标题');
  const artist = header(page, '艺人');
  const handle = title.locator('.fui-TableResizeHandle');
  const before = [await widthOf(title), await widthOf(artist)];

  await drag(page, handle, 60, async () => {
    await expect(handle).toHaveAttribute('data-dragging', 'true');
    await expect(artist.locator('.fui-TableResizeHandle')).not.toHaveAttribute('data-dragging');
    await page.keyboard.press('Escape');
  });
  expect(await widthOf(title)).toBeCloseTo(before[0] ?? 0, 0);
  expect(await storedColumns(page)).toBeNull();

  await drag(page, handle, 60);
  const after = [await widthOf(title), await widthOf(artist)];
  expect((after[0] ?? 0) - (before[0] ?? 0)).toBeCloseTo(60, -1);
  expect((after[0] ?? 0) + (after[1] ?? 0)).toBeCloseTo((before[0] ?? 0) + (before[1] ?? 0), 0);
  expect(await storedColumns(page)).toMatchObject({ widths: expect.any(Array) });

  await gotoHarness(page);
  expect(await widthOf(header(page, '标题'))).toBeCloseTo(after[0] ?? 0, 0);
});

test('拖列头换列并落盘，落下后让位与列名都清掉；拖动中 Esc 滑回原位、回到原处松手也不排序', async ({
  page,
}) => {
  await openTableHarness(page, { sortable: true });
  const start = await headerOrder(page);
  const title = header(page, '标题');
  const artist = header(page, '艺人');
  const distance = ((await title.boundingBox())?.x ?? 0) - ((await artist.boundingBox())?.x ?? 0);

  await drag(page, artist, distance, async () => {
    await expect(artist).toHaveAttribute('data-dragging', 'true');
    await expect(ghost(page, '艺人')).toBeVisible();
    await page.keyboard.press('Escape');
    // 等各列滑回原位，再把指针挪回按下的那一格松手：这一下 click 落在它的排序按钮上。
    await expect(grid(page)).not.toHaveAttribute('data-column-motion');
    const box = await artist.boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + 8);
  });
  expect(await headerOrder(page)).toEqual(start);
  await expect(grid(page)).not.toHaveAttribute('data-column-motion');

  await drag(page, artist, distance);
  const moved = await headerOrder(page);
  expect(moved.indexOf('artist')).toBe(moved.indexOf('title') - 1);
  expect(await storedColumns(page)).toMatchObject({ order: expect.arrayContaining(['artist']) });
  await expect(artist).not.toHaveAttribute('data-dragging');
  await expect(grid(page)).not.toHaveAttribute('data-column-motion');
  await expect(ghost(page, '艺人')).toHaveCount(0);
  expect(await harnessLog(page)).toEqual([]);

  await gotoHarness(page, { sortable: true });
  expect(await headerOrder(page)).toEqual(moved);
});

test('拖列头、拖分隔条的途中按下与松开回车、空格、Alt+→，都不排序也不换列', async ({ page }) => {
  await openTableHarness(page, { sortable: true });
  const artist = header(page, '艺人');
  await artist.click();
  const start = await headerOrder(page);
  const press = async () => {
    for (const key of ['Enter', ' ', 'Alt+ArrowRight']) await page.keyboard.press(key);
  };
  await drag(page, artist, -60, async () => {
    await press();
    await page.keyboard.press('Escape');
  });
  await drag(page, header(page, '标题').locator('.fui-TableResizeHandle'), 40, press);
  expect(await headerOrder(page)).toEqual(start);
  expect(await harnessLog(page)).toEqual([{ type: 'sort', column: 'artist' }]);
});

test('拖分隔条的途中它被卸掉（容器收窄进了窄档）：松手照样结束，之后键盘照常排序', async ({
  page,
}) => {
  await openTableHarness(page, { sortable: true });
  const box = page.locator('[data-harness-box]');
  const handle = header(page, '艺人').locator('.fui-TableResizeHandle');
  await drag(page, handle, 30, async () => {
    await expect(handle).toHaveAttribute('data-dragging', 'true');
    await box.evaluate((element) => element.style.setProperty('width', '500px'));
    await expect.poll(() => headerOrder(page)).toEqual(['number', 'title', 'duration']);
  });
  await box.evaluate((element) => element.style.setProperty('width', '900px'));
  await expect.poll(() => headerOrder(page)).toContain('artist');
  await header(page, '标题').getByRole('button').focus();
  await page.keyboard.press('Enter');
  expect(await harnessLog(page)).toEqual([{ type: 'sort', column: 'title' }]);
});

test('拖列头途中窗口失焦：换列取消，之后键盘点的排序不被吞', async ({ page }) => {
  await openTableHarness(page, { sortable: true });
  const artist = header(page, '艺人');
  const box = await artist.boundingBox();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 5 });
  await expect(artist).toHaveAttribute('data-dragging', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(artist).not.toHaveAttribute('data-dragging');
  await header(page, '标题').getByRole('button').focus();
  await page.keyboard.press('Enter');
  expect(await harnessLog(page)).toEqual([{ type: 'sort', column: 'title' }]);
  await page.mouse.up();
});

test('鼠标拖列头往右换列：落下后焦点还在被拖的那一列上', async ({ page }) => {
  await openTableHarness(page, { sortable: true });
  const artist = header(page, '艺人');
  const album = await header(page, '专辑').boundingBox();
  const from = await artist.boundingBox();
  const distance =
    (album?.x ?? 0) + (album?.width ?? 0) - 4 - ((from?.x ?? 0) + (from?.width ?? 0) / 2);
  await drag(page, artist, distance);
  const moved = await headerOrder(page);
  expect(moved.indexOf('artist')).toBe(moved.indexOf('album') + 1);
  expect(await focusedColumn(page)).toBe('artist');
});

test('上一列刚落下就拖下一列：跟手的列名不被上一轮的淡出收掉', async ({ page }) => {
  await openTableHarness(page);
  const title = header(page, '标题');
  const artist = header(page, '艺人');
  const distance = ((await title.boundingBox())?.x ?? 0) - ((await artist.boundingBox())?.x ?? 0);
  await drag(page, artist, distance);
  const album = await header(page, '专辑').boundingBox();
  const x = (album?.x ?? 0) + (album?.width ?? 0) / 2;
  const y = (album?.y ?? 0) + (album?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y);
  // 停住不动，挨过上一轮列名的淡出时长（83 ms）。
  await page.waitForTimeout(200);
  await expect(ghost(page, '专辑')).toBeVisible({ timeout: 100 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('可排序的列头，排序按钮念列名而不是列头上的记号', async ({ page }) => {
  await openTableHarness(page, { sortable: true });
  await expect(header(page, '音轨号').getByRole('button', { name: '音轨号' })).toBeVisible();
});

test('减弱动效时换列照样落下、照样清场', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTableHarness(page);
  const title = header(page, '标题');
  const artist = header(page, '艺人');
  const distance = ((await title.boundingBox())?.x ?? 0) - ((await artist.boundingBox())?.x ?? 0);
  await drag(page, artist, distance);
  const moved = await headerOrder(page);
  expect(moved.indexOf('artist')).toBe(moved.indexOf('title') - 1);
  await expect(grid(page)).not.toHaveAttribute('data-column-motion');
  await expect(ghost(page, '艺人')).toHaveCount(0);
});

test('列头只占一站 Tab；左右键在列之间移焦点，Alt+→ 与右边一列换位且不当成前进', async ({
  page,
}) => {
  await openTableHarness(page);
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.altKey && event.key === 'ArrowRight') {
        document.body.dataset['altRight'] = String(event.defaultPrevented);
      }
    });
  });
  await row(page, 'Track 0001').click();
  await page.keyboard.press('Tab');
  expect(await focusedColumn(page)).toBe('status');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focusedColumn(page)).toBe('title');

  await page.keyboard.press('Alt+ArrowRight');
  const order = await headerOrder(page);
  expect(order.indexOf('title')).toBe(order.indexOf('artist') + 1);
  expect(await focusedColumn(page)).toBe('title');
  await expect(page.locator('body')).toHaveAttribute('data-alt-right', 'true');

  await page.keyboard.press('Tab');
  expect(await focusedColumn(page)).toBeUndefined();
});

test('封面列：行让开封面宽、分组头横跨整行，短组垫满封面高；封面的分隔条只改它自己', async ({
  page,
}) => {
  await openTableHarness(page, { albums: 3, rows: 2, cover: true });
  const cover = grid(page).locator('[role="columnheader"][data-column-id="cover"]');
  const first = row(page, 'Track 0001');
  const album = (label: string) => group(page, label).boundingBox();
  const span = async () => ((await album('Album 1'))?.y ?? 0) - ((await album('Album 0'))?.y ?? 0);
  const inset = async () =>
    ((await first.boundingBox())?.x ?? 0) - ((await album('Album 0'))?.x ?? 0);
  expect(await widthOf(cover)).toBe(120);
  expect(await inset()).toBeCloseTo(120, 0);
  // 分组头 32 高；两首不够一张 120 的封面高，调用方垫到 4 行（每行 36）。
  expect(await span()).toBe(32 + 4 * 36);
  await expect(first.locator('[data-column-id="status"]')).toHaveAttribute('aria-colindex', '2');

  const title = await widthOf(header(page, '标题'));
  await drag(page, cover.locator('.fui-TableResizeHandle'), 30);
  expect(await widthOf(cover)).toBeCloseTo(150, 0);
  expect(await inset()).toBeCloseTo(150, 0);
  expect(await span()).toBe(32 + 5 * 36);
  expect(await widthOf(header(page, '标题'))).toBeLessThan(title);
});

test('容器不宽于 520 时只留序号、标题与时长', async ({ page }) => {
  await openTableHarness(page, { width: 500 });
  // 容器宽度要等 ResizeObserver 量到才进窄档。
  await expect.poll(() => headerOrder(page)).toEqual(['number', 'title', 'duration']);
});
