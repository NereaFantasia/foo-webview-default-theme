import type { Locator, Page } from '@playwright/test';
import type { FakeHostOptions } from './fakeHost.ts';
import { installPageHost, type PageHost } from './pageHost.ts';

// 在浏览器测试里打开表格试验页。页面照常由开发服务器给 index.html（热更新的前导与连接都是它写好的），
// 只把入口模块 src/main.tsx 换成一句导入试验页的入口；试验页的参数放在地址栏里。
//
// 不自己答一整份页面：Playwright 答出去的文档不算来自本机，Edge 的本地网络访问检查会拦下它连回开发
// 服务器的 WebSocket，控制台里多出一串报错。

const ENTRY = "import '/tests/fixtures/tableHarnessEntry.ts';";

/** 试验表的列存档键；测试不另给时都用它，重载后读回的是同一份。 */
export const HARNESS_KEY = 'default-theme.test-table.v1';

/** 试验页的地址参数，含义见 `TableHarness.tsx` 的 `HarnessScenario`。 */
export type HarnessQuery = Readonly<Record<string, string | number | boolean>>;

/** 装上宿主替身并打开试验页；答出去的是替身，测试接着用它配应答、推事件、看调用。 */
export async function openTableHarness(
  page: Page,
  query: HarnessQuery = {},
  options?: FakeHostOptions,
): Promise<PageHost> {
  const host = await installPageHost(page, options);
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: ENTRY }),
  );
  await gotoHarness(page, query);
  return host;
}

/** 再开一次试验页，用于重载后看落盘的东西还在不在。 */
export async function gotoHarness(page: Page, query: HarnessQuery = {}): Promise<void> {
  const params: HarnessQuery = { key: HARNESS_KEY, ...query };
  const search = new URLSearchParams(
    Object.entries(params).map(([name, value]) => [name, String(value === true ? 1 : value)]),
  );
  await page.goto(`/?${search.toString()}`);
  // 头一次打开时开发服务器要现转译整条导入链，比断言的缺省时限慢。
  await page.locator('[role="treegrid"]').first().waitFor({ timeout: 30_000 });
}

/** 试验页记下的交给调用方的动作，按发生的先后。 */
export async function harnessLog(page: Page): Promise<unknown[]> {
  const log: unknown = await page.evaluate(() => Reflect.get(window, '__tableLog') ?? []);
  return Array.isArray(log) ? log : [];
}

/** 清空试验页的记录，下一段断言只看之后的动作。 */
export async function clearHarnessLog(page: Page): Promise<void> {
  await page.evaluate(() => Reflect.set(window, '__tableLog', []));
}

/** 试验表本身，按名字找。 */
export function harnessGrid(page: Page): Locator {
  return page.locator('[aria-label="试验表"]');
}

/** 标题含 `title` 的那一行曲目；试验页里的标题是 Track 0001 起。 */
export function harnessRow(page: Page, title: string): Locator {
  return harnessGrid(page).getByRole('row', { name: new RegExp(title) });
}

/** 标签是 `label` 的分组头，如 Album 0、Section 1。 */
export function harnessGroup(page: Page, label: string): Locator {
  return harnessGrid(page).locator(`[role="row"]:has([data-group-label="${label}"])`);
}

/** 在表格根元素这一层量一个 CSS 变量解析出来的颜色，拿来和格子的计算色比。 */
export function tokenColor(page: Page, variable: string): Promise<string> {
  return harnessGrid(page).evaluate((element, name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

/** 列名是 `name` 的列头格，如「标题」「音轨号」。 */
export function harnessHeader(page: Page, name: string): Locator {
  return harnessGrid(page).getByRole('columnheader', { name, exact: true });
}

/** 列头从左到右的列。 */
export function headerOrder(page: Page): Promise<string[]> {
  return harnessGrid(page)
    .getByRole('columnheader')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-column-id') ?? ''));
}

/** 焦点所在的列头是哪一列；焦点不在列头上时为 undefined。 */
export function focusedColumn(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      document.activeElement?.closest('[role="columnheader"]')?.getAttribute('data-column-id') ??
      undefined,
  );
}

/** 试验表的列存档，还没落过盘时为 null。 */
export async function storedColumns(page: Page): Promise<unknown> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), HARNESS_KEY);
  return raw === null ? null : JSON.parse(raw);
}
