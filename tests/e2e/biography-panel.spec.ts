import { expect, test, type Page } from '@playwright/test';
import { biographyHtml, biographyOverviewHtml } from '../fixtures/biographySamples.ts';
import { installPageHost } from '../fixtures/pageHost.ts';
import { expandBiographyArticle, openBiographyLink } from '../fixtures/biographyActions.ts';

async function start(page: Page, body = biographyHtml()) {
  const host = await installPageHost(page);
  host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  host.answer('http.get', (params) => ({
    success: true,
    status: 200,
    headers: {},
    body: String(params['url']).endsWith('/+wiki') ? body : biographyOverviewHtml(),
    responseType: 'text',
  }));
  await page.route('**/biography-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/biographyHarnessEntry.ts"></script></body></html>',
    }),
  );
  await page.goto('/biography-harness');
  await expect(page.getByRole('switch', { name: '在线艺人简介' })).toBeEnabled();
  return host;
}

async function enable(page: Page) {
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  await expect(page.locator('[data-biography-link]')).toBeVisible();
}

async function confirm(page: Page) {
  await openBiographyLink(page);
  await page.getByRole('button', { name: '确认艺人', exact: true }).click();
}

async function change(page: Page, method: string, value: string | boolean) {
  await page.evaluate(
    ({ method, value }) => {
      const harness: unknown = Reflect.get(window, '__biographyHarness');
      if (typeof harness !== 'object' || harness === null) throw new Error('未找到简介验证入口');
      const action: unknown = Reflect.get(harness, method);
      if (typeof action !== 'function') throw new Error('未知简介验证操作');
      action(value);
    },
    { method, value },
  );
}

test('默认关闭，确认身份后显示完整正文与出处许可', async ({ page }) => {
  const host = await start(page);
  await expect(page.getByText('在线简介未开启')).toBeVisible();
  expect(host.callsTo('http.get')).toEqual([]);
  await enable(page);
  expect(host.callsTo('http.get')).toEqual([]);
  await confirm(page);
  await expect(page.getByText('第一段简介。', { exact: true })).toBeVisible();
  await expect(page.getByText('Last.fm · 用户撰写')).toBeVisible();
  await expect(page.getByText('CC BY-SA 3.0')).toBeVisible();
  await expect(page.getByRole('button', { name: '收起', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新简介' })).toBeEnabled();
  expect(host.callsTo('http.get')).toHaveLength(2);
});

test('惰性解析不执行网页脚本、不加载图片，实体与换行按正文显示', async ({ page }) => {
  const attempted: string[] = [];
  await page.route('https://**/*', (route) => {
    attempted.push(route.request().url());
    return route.abort();
  });
  await start(
    page,
    biographyHtml(
      'Queen',
      `<p>安全 &amp; 正文<br>第二行</p>
    <p>第二段</p><img src="https://untrusted.example/photo.jpg" onerror="window.__bioExecuted=true">
    <script>window.__bioExecuted=true</script><iframe src="https://untrusted.example/frame"></iframe>
    <p hidden>隐藏文本</p><style>body{display:none}</style>`,
    ),
  );
  await enable(page);
  await confirm(page);
  const body = page.locator('[data-biography] p');
  await expect(body.first()).toHaveText('安全 & 正文\n第二行');
  await expect(body).toHaveCount(2);
  expect(await page.evaluate(() => Reflect.get(window, '__bioExecuted'))).toBeUndefined();
  expect(attempted).toEqual([]);
});

test('错误域名不能被确认，简繁来源名经手选分别处理', async ({ page }) => {
  const host = await start(page, biographyHtml('赵咏华'));
  await change(page, 'select', '趙詠華');
  await enable(page);
  await openBiographyLink(page);
  const field = page.getByRole('textbox', { name: 'Last.fm 艺人链接' });
  await field.fill('https://www.last.fm.evil.example/music/test');
  await confirm(page);
  await expect(page.getByText('请输入使用 HTTPS 的 Last.fm 艺人链接')).toBeVisible();
  expect(host.callsTo('http.get')).toEqual([]);
  await field.fill('https://www.last.fm/zh/music/%E8%B5%B5%E5%92%8F%E5%8D%8E/+wiki');
  await confirm(page);
  await expect(page.getByText('第一段简介。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新简介' })).toBeEnabled();
  expect(host.callsTo('http.get')[0]?.['url']).toContain('%E8%B5%B5%E5%92%8F%E5%8D%8E');
});

test('刷新失败保留旧正文和许可，来源恢复后清除错误', async ({ page }) => {
  const host = await start(page);
  await enable(page);
  await confirm(page);
  await expect(page.getByText('第一段简介。', { exact: true })).toBeVisible();
  host.answer('http.get', { success: true, status: 503, headers: {}, body: '' });
  await page.getByRole('button', { name: '刷新简介' }).click();
  await expect(page.getByText('无法连接数据源', { exact: false })).toBeVisible();
  await expect(page.getByText('第一段简介。', { exact: true })).toBeVisible();
  host.answer('http.get', {
    success: true,
    status: 200,
    headers: {},
    body: biographyHtml('Queen', '<p>新正文</p>'),
  });
  await page.getByRole('button', { name: '刷新简介' }).click();
  await expect(page.getByText('新正文', { exact: true })).toBeVisible();
  await expect(page.getByText('无法连接数据源', { exact: false })).toHaveCount(0);
});

test('关闭联网后晚到正文不显示、不写缓存，再开启可正常读取', async ({ page }) => {
  const host = await start(page);
  const held = host.hold('http.get');
  await enable(page);
  await confirm(page);
  await expect.poll(() => held.pending.length).toBe(1);
  await page.getByRole('switch', { name: '在线艺人简介' }).uncheck();
  held.respond(0);
  await expect(page.getByText('在线简介未开启')).toBeVisible();
  await expect(page.getByText('第一段简介。', { exact: true })).toHaveCount(0);
  expect(host.callsTo('file.write')).toEqual([]);
  held.release();
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  await expect(page.getByText('第一段简介。', { exact: true })).toBeVisible();
});

test('空正文与不认识的页面分开报告，重新选择不会误用其他艺人的正文', async ({ page }) => {
  const empty =
    '<link rel="canonical" href="https://www.last.fm/zh/music/Queen/+wiki"><div class="no-data-message--wiki"></div>';
  const host = await start(page, empty);
  await enable(page);
  await confirm(page);
  await expect(page.getByText('未找到可用简介')).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新简介' })).toBeEnabled();
  host.answer('http.get', {
    success: true,
    status: 200,
    headers: {},
    body: '<html>challenge</html>',
  });
  await page.getByRole('button', { name: '刷新简介' }).click();
  await expect(page.getByText('无法解析此来源页面')).toBeVisible();
  await change(page, 'select', 'Other');
  await expect(page.locator('[data-biography-link]')).toBeVisible();
  await expect(page.getByText('无法解析此来源页面')).toHaveCount(0);
});

test('窄视口中长名字和长正文不造成水平溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const name = '很长的艺人名字'.repeat(12);
  await start(page, biographyHtml(name, `<p>${'长正文'.repeat(120)}</p>`));
  await change(page, 'select', name);
  await enable(page);
  await confirm(page);
  await expandBiographyArticle(page);
  await expect(page.getByText('Last.fm · 用户撰写')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
