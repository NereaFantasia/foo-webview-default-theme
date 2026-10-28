import type { Page } from '@playwright/test';
import { installPageHost, type PageHost } from './pageHost.ts';

// 打开在线结果试验页（`OnlineHarness.tsx`）：开发服务器照常给 index.html，只把入口换成试验页的入口。

const ENTRY = "import '/tests/fixtures/onlineHarnessEntry.ts';";

export async function openOnlineHarness(
  page: Page,
  query: Readonly<Record<string, string>> = {},
): Promise<PageHost> {
  const host = await installPageHost(page);
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: ENTRY }),
  );
  await page.goto(`/?${new URLSearchParams(query).toString()}`);
  // 头一次打开时开发服务器要现转译整条导入链，比断言的缺省时限慢。
  await page.locator('[data-online-harness]').waitFor({ timeout: 30_000 });
  return host;
}

/** 试验页记下的搜索、起播与入队，按发生的先后。 */
export async function onlineLog(page: Page): Promise<unknown[]> {
  const log: unknown = await page.evaluate(() => Reflect.get(window, '__onlineLog') ?? []);
  return Array.isArray(log) ? log : [];
}
