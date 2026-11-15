import { expect, test } from '@playwright/test';
import { openSearchBox } from '../fixtures/searchBox.ts';

test.use({ screenshot: 'off' });

// 搜索框是 Fluent 输入框：真正的 <input> 外面还有带内边距的根和左边的搜索图标，点在哪里都算点输入框
const SPOTS = [
  ['文字区', (b: { x: number; width: number }) => b.x + b.width / 2, 0.5],
  ['搜索图标', (b: { x: number; width: number }) => b.x + 14, 0.5],
  ['框的左缘', (b: { x: number; width: number }) => b.x + 2, 0.5],
  ['框的上缘', (b: { x: number; width: number }) => b.x + b.width / 2, 0.02],
] as const;

for (const [name, atX, atY] of SPOTS) {
  test(`点搜索框的${name}，下拉不收、焦点在输入框`, async ({ page }) => {
    const { errors, input, bounds, closedCount } = await openSearchBox(page);
    await page.mouse.click(atX(bounds), bounds.y + bounds.height * atY);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toBeFocused();
    expect(await closedCount()).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('点输入框里的清除键：清掉文字，下拉照开、焦点回输入框', async ({ page }) => {
  const { errors, input, closedCount } = await openSearchBox(page);
  await input.fill('hello');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toBeFocused();
  expect(await closedCount()).toBe(0);
  expect(errors).toEqual([]);
});

test('点搜索框以外的地方，下拉照旧收起', async ({ page }) => {
  const { input } = await openSearchBox(page);
  await page.locator('main').click({ position: { x: 4, y: 4 } });
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});
