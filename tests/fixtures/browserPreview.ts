import type { Page } from '@playwright/test';
import { WINDOW_MODE_TIMEOUT_MS } from '../../src/host/windowMode.ts';

/**
 * 不装宿主替身直接打开页面：等满模式读取的超时才转入浏览器预览，界面随后挂上。
 * 断言的默认超时只有 5 s，不先等界面挂上就会赶在超时之前判失败
 */
export async function openBrowserPreview(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .locator('#root > .fui-FluentProvider')
    .waitFor({ timeout: WINDOW_MODE_TIMEOUT_MS + 10_000 });
}
