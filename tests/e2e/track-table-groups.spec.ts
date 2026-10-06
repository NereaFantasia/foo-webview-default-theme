import { expect, test } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import {
  clearHarnessLog,
  harnessGroup as group,
  harnessLog,
  harnessRow as row,
  openTableHarness,
} from '../fixtures/tableHarnessPage.ts';

// 表格的分组头：键盘开合与进出、调用方画的开合键、展开同级时的滚动补偿，以及焦点那一行被收起之后键盘从哪里
// 接着走。试验页里分组头的标签是 Section 0、Album 0 起，每个分组头里有一个开合键。

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('左右键开合与进出、回车与空格切换、* 展开同级，双击与右键交给调用方', async ({ page }) => {
  await openTableHarness(page, { sections: 2, albums: 2, rows: 3, groupFocus: true });
  const album = group(page, 'Album 0');
  await album.click();
  await expect(album).toHaveAttribute('data-row-focus', 'true');
  await expect(album).toHaveAttribute('aria-level', '2');
  await page.keyboard.press('ArrowLeft');
  await expect(album).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'Track 0001')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(group(page, 'Section 0')).toHaveAttribute('data-row-focus', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(album).toHaveAttribute('data-row-focus', 'true');
  await page.keyboard.press('Enter');
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Track 0001')).toHaveAttribute('data-row-focus', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(album).toHaveAttribute('data-row-focus', 'true');
  await page.keyboard.press(' ');
  await expect(album).toHaveAttribute('aria-expanded', 'false');

  await group(page, 'Album 1').getByRole('button').click();
  await expect(group(page, 'Album 1')).toHaveAttribute('aria-expanded', 'false');
  await album.click();
  await page.keyboard.press('*');
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  await expect(group(page, 'Album 1')).toHaveAttribute('aria-expanded', 'true');

  await clearHarnessLog(page);
  await album.dblclick();
  await album.click({ button: 'right' });
  expect(await harnessLog(page)).toMatchObject([
    { type: 'groupClick', key: 'a0', alt: false, ctrl: false },
    { type: 'play', key: 'a0' },
    { type: 'menu', key: 'a0', rows: null },
  ]);
  await clearHarnessLog(page);
  await group(page, 'Section 1').click({ modifiers: ['Alt'] });
  await group(page, 'Section 1').click({ modifiers: ['Control'] });
  expect(await harnessLog(page)).toMatchObject([
    { type: 'groupClick', key: 's1', alt: true, ctrl: false },
    { type: 'groupClick', key: 's1', alt: false, ctrl: true },
  ]);
});

test('调用方画的开合键：单击、双击都不算点分组头，点完键盘照样接得上', async ({ page }) => {
  await openTableHarness(page, { albums: 3, rows: 4 });
  const toggle = group(page, 'Album 1').getByRole('button');
  await toggle.dblclick();
  await expect(group(page, 'Album 1')).toHaveAttribute('aria-expanded', 'true');
  expect(await harnessLog(page)).toEqual([]);

  await row(page, 'Track 0002').click();
  await toggle.click();
  await expect(group(page, 'Album 1')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Track 0003')).toHaveAttribute('data-row-focus', 'true');
});

test('焦点那一行被收起后，焦点退到它的分组头上，下一次 ↓ 从那里接着走', async ({ page }) => {
  await openTableHarness(page, { albums: 3, rows: 10 });
  await row(page, 'Track 0015').click();
  await group(page, 'Album 1').getByRole('button').click();
  await expect(row(page, 'Track 0015')).toHaveCount(0);
  await expect(group(page, 'Album 1')).toHaveAttribute('data-row-focus', 'true');
  await page.keyboard.press('ArrowDown');
  const next = row(page, 'Track 0021');
  await expect(next).toHaveAttribute('data-row-focus', 'true');
  await expect(next).toBeInViewport();
});

test('上面的同级一起展开时，焦点所在的分组头留在视口里原来的位置', async ({ page }) => {
  await openTableHarness(page, { albums: 6, rows: 10, groupFocus: true });
  for (let at = 0; at < 6; at += 1) {
    await group(page, `Album ${at}`).getByRole('button').click();
  }
  const last = group(page, 'Album 5');
  await last.click();
  const before = await last.boundingBox();
  await page.keyboard.press('*');
  // 上面五组都展开了，紧挨着的那一组的末几首露在焦点分组头上方。
  await expect(row(page, 'Track 0050')).toBeInViewport();
  await expect(last).toBeInViewport();
  const after = await last.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
});
