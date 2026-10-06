import { expect, test } from '@playwright/test';
import { openLargeQueue, queueScroller } from '../fixtures/rightCardPage.ts';

test('快速跨屏滚动持续覆盖视口，使用粘性行带，不随整个长列表离屏', async ({ page }) => {
  const { errors } = await openLargeQueue(page, 120000, 40);
  const result = await queueScroller(page).evaluate(async (box) => {
    const samples: { covered: boolean; slots: number; sticky: string; scroll: number }[] = [];
    for (let i = 0; i < 32; i++) {
      box.scrollTop = 48 * (i % 2 === 0 ? i * 270 : (i + 1) * 340);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const frame = box.getBoundingClientRect();
      const viewport = box.querySelector<HTMLElement>('[data-queue-viewport]');
      const slots = [...box.querySelectorAll<HTMLElement>('[data-queue-slot]')];
      const top = Math.max(
        frame.top + 50,
        (box.querySelector('[data-queue-virtual-list]')?.getBoundingClientRect().top ?? 0) + 1,
      );
      const bottom = frame.bottom - 2;
      const bounds = slots.map((slot) => slot.getBoundingClientRect());
      samples.push({
        covered:
          bounds.some((rect) => rect.top <= top && rect.bottom > top) &&
          bounds.some((rect) => rect.top < bottom && rect.bottom >= bottom),
        slots: slots.length,
        sticky: viewport ? getComputedStyle(viewport).position : '',
        scroll: box.scrollTop,
      });
    }
    return samples;
  });
  expect(result.every((sample) => sample.sticky === 'sticky')).toBe(true);
  expect(result.filter((sample) => !sample.covered)).toEqual([]);
  expect(Math.max(...result.map((sample) => sample.slots))).toBeLessThan(80);
  await expect(page.locator('[data-queue-slot] [data-queue-row]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('六位序号、小时长度、长文本及窄卡不相互覆盖', async ({ page }) => {
  const { errors } = await openLargeQueue(page);
  await queueScroller(page).evaluate((box) => {
    box.scrollTop = box.scrollHeight;
  });
  const last = page.locator('[data-queue-row]').filter({ hasText: '曲目 120000' });
  await expect(last).toBeVisible();
  const measure = async () =>
    last.evaluate((row) => {
      const lead = row.children[0];
      const number = lead.children[0];
      const cover = row.children[1];
      const identity = row.children[2];
      const tail = row.children[3];
      return {
        numberFits: number.getBoundingClientRect().right <= cover.getBoundingClientRect().left,
        titleFits: identity.getBoundingClientRect().right <= tail.getBoundingClientRect().left,
        fits: row.scrollWidth <= row.clientWidth,
        number: number.textContent,
      };
    });
  expect(await measure()).toEqual({
    numberFits: true,
    titleFits: true,
    fits: true,
    number: '120001',
  });
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.locator('[data-right-card]')).toBeVisible();
  await queueScroller(page).evaluate((box) => {
    box.scrollTop = box.scrollHeight;
  });
  await expect(last).toBeVisible();
  expect(await measure()).toEqual({
    numberFits: true,
    titleFits: true,
    fits: true,
    number: '120001',
  });
  expect(errors).toEqual([]);
});

test('End 直接到末尾且取得焦点，Home 能返回；预览尺寸有上限', async ({ page }) => {
  const { errors } = await openLargeQueue(page, 5000, 20);
  await page
    .locator('[data-queue-row]')
    .filter({ hasText: /^2曲目 1/ })
    .first()
    .click();
  await page.keyboard.press('End');
  const last = page.locator('[data-queue-row]').filter({ hasText: '曲目 5000' });
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-kind="upnext"]').first()).toBeFocused();
  await page.getByRole('button', { name: '展开封面', exact: true }).first().click();
  const cover = page.getByRole('button', { name: '收起封面', exact: true });
  await expect(cover).toBeVisible();
  expect((await cover.boundingBox())?.width).toBeLessThanOrEqual(288);
  expect(errors).toEqual([]);
});
