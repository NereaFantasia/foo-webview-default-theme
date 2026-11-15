import { expect, type Page } from '@playwright/test';
import { SEARCH_HISTORY_KEY } from '../../src/library/search/searchHistory.ts';
import { collectPageErrors, installPageHost } from './pageHost.ts';

/**
 * 打开主窗口，聚焦侧栏搜索框让下拉展开，并记下下拉有没有收起过
 * 看 aria-expanded 而不是下拉可不可见：收起有淡出动画，淡出期间 toBeVisible 仍然通过；
 * 收起后又被焦点回来重新打开，最后读到的仍是 true，所以另记变成过 false 的次数
 */
export async function openSearchBox(page: Page) {
  const errors = collectPageErrors(page);
  await installPageHost(page, { config: { [SEARCH_HISTORY_KEY]: ['Nujabes', 'Feather'] } });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  const input = page.locator('[data-search-input="sidebar"]:visible');
  await input.focus();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.evaluate((element) => {
    Reflect.set(window, '__searchClosed', 0);
    new MutationObserver(() => {
      if (element.getAttribute('aria-expanded') === 'false')
        Reflect.set(window, '__searchClosed', Number(Reflect.get(window, '__searchClosed')) + 1);
    }).observe(element, { attributes: true, attributeFilter: ['aria-expanded'] });
  });
  const box = input.locator('xpath=ancestor::span[contains(@class,"fui-Input")]');
  const bounds = await box.boundingBox();
  if (!bounds) throw new Error('搜索框没有排版');
  const closedCount = () => page.evaluate(() => Number(Reflect.get(window, '__searchClosed')));
  return { errors, input, bounds, closedCount };
}
