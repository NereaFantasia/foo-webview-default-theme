import { expect, test, type Page } from '@playwright/test';
import { biographyHtml, biographyOverviewHtml } from '../fixtures/biographySamples.ts';
import { installPageHost } from '../fixtures/pageHost.ts';
import {
  confirmBiographyExternal,
  expandBiographyArticle,
  openBiographyLink,
} from '../fixtures/biographyActions.ts';

const FACTS = `<ul><li class="factbox-item"><h4>成立时间</h4><p>1970</p></li>
  <li class="factbox-item"><h4>成立地点</h4><p>London, England</p></li></ul>`;
const WIKI = biographyHtml('Queen', '<p>Queen is a British rock band.</p>').replace(
  '</body>',
  `${FACTS}</body>`,
);
const panel = (page: Page) => page.locator('[data-biography]');
const refresh = (page: Page) => panel(page).getByRole('button', { name: '刷新简介' });

async function start(page: Page, wiki = WIKI, overview = biographyOverviewHtml()) {
  const host = await installPageHost(page);
  host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  host.answer('http.get', (params) => ({
    success: true,
    status: 200,
    headers: {},
    body: String(params['url']).endsWith('/+wiki') ? wiki : overview,
  }));
  await page.route('**/biography-details', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/biographyHarnessEntry.ts"></script></body></html>',
    }),
  );
  await page.goto('/biography-details');
  await expect(page.getByRole('switch', { name: '在线艺人简介' })).toBeEnabled();
  return host;
}

async function enable(page: Page) {
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  await openBiographyLink(page);
  await panel(page).getByRole('button', { name: '确认艺人', exact: true }).click();
  await expect(panel(page).getByText('Queen is a British rock band.')).toBeVisible();
  await expandBiographyArticle(page);
}

async function parse(page: Page, html: string, method = 'parseDetails') {
  return page.evaluate(
    ({ html, method }) => {
      const harness: unknown = Reflect.get(window, '__biographyHarness');
      if (typeof harness !== 'object' || harness === null) throw new Error('没有解析入口');
      const read: unknown = Reflect.get(harness, method);
      if (typeof read !== 'function') throw new Error('没有解析方法');
      const result: unknown = read(html, 'Queen', 'zh');
      return result;
    },
    { html, method },
  );
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme} 下显示资料、标签、精确计数与 SDK 相似艺人外链，窄窗不溢出`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 700 });
    const host = await start(page);
    await enable(page);
    await expect(refresh(page)).toBeEnabled();
    await expect(panel(page).getByText('标签', { exact: true }).locator('..')).toContainText(
      'rock · classic rock',
    );
    await expect(panel(page).getByText('London, England')).toBeVisible();
    await expect(panel(page).locator('dd[title="1,234,567"]')).toHaveText('123.5万');
    await expect(panel(page).getByText('CC BY-SA 3.0')).toBeVisible();
    await expect(panel(page).getByText('艺人资料来自 Last.fm')).toBeVisible();
    host.answer('shell.openExternal', { success: true });
    await panel(page).getByRole('button', { name: 'David Bowie · Last.fm' }).click();
    await confirmBiographyExternal(page);
    await expect
      .poll(() => host.callsTo('shell.openExternal')[0]?.['url'])
      .toBe('https://www.last.fm/zh/music/David%20Bowie');
    await panel(page).getByText('艺人资料来自 Last.fm').click();
    await confirmBiographyExternal(page);
    await expect
      .poll(() => host.callsTo('shell.openExternal')[1]?.['url'])
      .toBe('https://www.last.fm/zh/music/Queen');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('正文先出现，附加资料刷新失败不抹掉正文、资料和标签', async ({ page }) => {
  const host = await start(page);
  const held = host.hold('http.get');
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  await openBiographyLink(page);
  await panel(page).getByRole('button', { name: '确认艺人', exact: true }).click();
  await expect.poll(() => held.pending.length).toBe(1);
  held.respond(0);
  await expect(panel(page).getByText('Queen is a British rock band.')).toBeVisible();
  await expandBiographyArticle(page);
  await expect(panel(page).getByText('London, England')).toBeVisible();
  await expect(refresh(page)).toBeDisabled();
  await expect.poll(() => held.pending.length).toBe(1);
  held.respond(0);
  held.release();
  await expect(refresh(page)).toBeEnabled();
  host.answer('http.get', (params) => ({
    success: true,
    status: String(params['url']).endsWith('/+wiki') ? 200 : 503,
    headers: {},
    body: WIKI,
  }));
  await refresh(page).click();
  await expect(panel(page).getByText('无法连接数据源', { exact: false })).toBeVisible();
  await expect(panel(page).getByText('Queen is a British rock band.')).toBeVisible();
  await expect(panel(page).getByText('标签', { exact: true }).locator('..')).toContainText(
    'classic rock',
  );
  await expect(panel(page).getByText('London, England')).toBeVisible();
});

test('真实 DOM 解析排除隐藏内容、脚本、危险外链和假精确计数，不加载外部资源', async ({ page }) => {
  await start(page);
  const attempted: string[] = [];
  await page.route('https://**/*', (route) => {
    attempted.push(route.request().url());
    return route.abort();
  });
  const html = biographyOverviewHtml(
    'Queen',
    'zh',
    `
    <script>window.__detailsExecuted=true</script><img src="https://untrusted.example/a" onerror="window.__detailsExecuted=true">
    <iframe src="https://untrusted.example/b"></iframe>
    <li class="tag"><a href="/tag/rock">rock<script>danger</script><span hidden>secret</span></a></li>
    <li class="tag" hidden><a href="/tag/hidden">hidden</a></li>
    <li class="tag"><a href="https://evil.example/tag/evil">evil</a></li>
    <li class="tag"><a href="/tag/user">user:secret</a></li>
    <li class="tag"><a href="/tag/queen">Queen</a></li>
    <div><h4 class="header-metadata-tnew-title">坏计数</h4><abbr class="intabbr js-abbreviated-counter" title="1.2M">1.2M</abbr></div>
    <div><h4 class="header-metadata-tnew-title">听众</h4><abbr class="intabbr js-abbreviated-counter" title="1.234.567">1M</abbr></div>
    <h3 class="catalogue-overview-similar-artists-full-width-item-name"><a href="javascript:alert(1)">Bad</a></h3>
    <h3 class="catalogue-overview-similar-artists-full-width-item-name"><a href="https://evil.example/music/Bad">Bad</a></h3>
    <h3 class="catalogue-overview-similar-artists-full-width-item-name"><a href="/music/Other">Wrong</a></h3>
    <h3 class="catalogue-overview-similar-artists-full-width-item-name"><a href="/music/A%2BB">A+B</a></h3>`,
  );
  expect(await parse(page, html)).toEqual({
    kind: 'found',
    details: {
      tags: ['rock'],
      counters: [{ label: '听众', value: 1234567 }],
      similar: [{ artist: 'A+B', url: 'https://www.last.fm/zh/music/A%2BB' }],
      photo: null,
    },
  });
  expect(
    await parse(
      page,
      biographyHtml().replace(
        '</body>',
        `${FACTS}
    <li class="factbox-item" aria-hidden="true"><h4>Hidden</h4><p>secret</p></li></body>`,
      ),
      'parseBiography',
    ),
  ).toMatchObject({
    kind: 'found',
    document: {
      facts: [
        { label: '成立时间', value: '1970' },
        { label: '成立地点', value: 'London, England' },
      ],
    },
  });
  expect(await page.evaluate(() => Reflect.get(window, '__detailsExecuted'))).toBeUndefined();
  expect(attempted).toEqual([]);
  expect(await parse(page, '<html>Client Challenge</html>')).toEqual({ kind: 'invalid' });
  expect(await parse(page, biographyOverviewHtml('Other'))).toEqual({ kind: 'invalid' });
});

test('空附加资料不显示空块，没有正文时仍可显示可用主页资料', async ({ page }) => {
  const host = await start(
    page,
    biographyHtml('Queen', '<p>Queen is a British rock band.</p>'),
    biographyOverviewHtml('Queen', 'zh', ''),
  );
  await enable(page);
  await expect(refresh(page)).toBeEnabled();
  await expect(page.locator('[data-biography-details]')).toHaveCount(0);
  await expect(panel(page).getByText('标签', { exact: true })).toHaveCount(0);
  host.answer('http.get', (params) => ({
    success: true,
    status: String(params['url']).endsWith('/+wiki') ? 404 : 200,
    headers: {},
    body: biographyOverviewHtml('Queen', 'en'),
  }));
  await refresh(page).click();
  await expect(panel(page).getByText('未找到可用简介')).toBeVisible();
  await expandBiographyArticle(page);
  await expect(panel(page).getByText('相似艺人', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('CC BY-SA 3.0')).toHaveCount(0);
  await expect(refresh(page)).toBeEnabled();
  host.answer('http.get', (params) => ({
    success: true,
    status: String(params['url']).endsWith('/+wiki') ? 404 : 200,
    headers: {},
    body: biographyOverviewHtml('Queen', 'en').replace('1,234,567', '9,999'),
  }));
  await refresh(page).click();
  await expect(panel(page).locator('dd[title="9,999"]')).toHaveText('9,999');
});
