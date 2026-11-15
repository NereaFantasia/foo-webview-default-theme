import type { Locator, Page } from '@playwright/test';

/**
 * 菜单、Popover 开着时页面不接指针，`locator.click()` 会因「被别的元素挡住」一直重试到超时
 * 这里在元素中心点按一下，和用户在页面上点一下是同一回事
 */
export async function pressOn(
  page: Page,
  target: Locator,
  options: { readonly button?: 'left' | 'right' } = {},
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('元素不可见');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, options);
}
