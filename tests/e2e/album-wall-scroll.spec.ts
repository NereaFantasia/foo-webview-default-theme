import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { libraryAnswers, manyAlbums } from '../fixtures/albumLibrary.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 大库下的滚动开销：8000 张专辑，按流派分节。只画视口附近的几行，悬停键整张网格一对；
// 快速滚一遍，量样式重算、布局与 DOM 节点数，数字写进测试报告的附注。只对与机器快慢无关的数断言
// （同时在 DOM 的图块、文档元素、回收后的节点）；耗时随机器变，只记不断言。
// CDP 的 Nodes 连还没回收的游离节点一起数，先强制回收一次再读；文档里挂着的元素另数一份。

const COUNT = 8000;
const grid = (page: Page) => page.locator('[data-album-wall]');

type Metrics = Record<string, number>;

async function metrics(cdp: CDPSession): Promise<Metrics> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((item) => [item.name, item.value]));
}

/** 每帧滚 `step` 像素，一路滚到底；返回途中同时在 DOM 里的图块最多有几块。 */
function scrollThrough(page: Page, step: number): Promise<number> {
  return grid(page).evaluate(
    (element, pixels) =>
      new Promise<number>((resolve) => {
        let most = 0;
        const frame = () => {
          most = Math.max(most, element.querySelectorAll('[data-album-tile]').length);
          const bottom = element.scrollHeight - element.clientHeight;
          if (element.scrollTop >= bottom) {
            resolve(most);
            return;
          }
          element.scrollTop = Math.min(bottom, element.scrollTop + pixels);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    step,
  );
}

test('8000 张专辑下快速滚到底：只画视口附近的图块，文档元素与回收后的节点数有上限', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await installPageHost(page, {
    answers: libraryAnswers(manyAlbums(COUNT)),
    config: { 'defaultTheme.browser.dimension': 'genre' },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-album-tile]').first()).toBeVisible();
  // 指针停在网格上，悬停键挂上；滚动时图块从指针底下滑过。
  await page.locator('[data-album-tile]').first().hover();
  await expect(page.locator('[data-tile-keys]')).toHaveCount(1);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await metrics(cdp);
  const started = Date.now();
  const most = await scrollThrough(page, 2400);
  const elapsed = Date.now() - started;
  const after = await metrics(cdp);
  const delta = (name: string) => (after[name] ?? 0) - (before[name] ?? 0);
  const elements = await page.evaluate(() => document.querySelectorAll('*').length);
  const report = {
    tilesAtMost: most,
    elements,
    nodesBefore: before['Nodes'] ?? 0,
    nodes: after['Nodes'] ?? 0,
    recalcStyleCount: delta('RecalcStyleCount'),
    recalcStyleMs: Math.round(delta('RecalcStyleDuration') * 1000),
    layoutCount: delta('LayoutCount'),
    layoutMs: Math.round(delta('LayoutDuration') * 1000),
    scrollMs: elapsed,
  };
  test.info().annotations.push({ type: 'scroll-metrics', description: JSON.stringify(report) });
  console.log(`scroll-metrics ${JSON.stringify(report)}`);

  await expect.poll(() => grid(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(most).toBeLessThan(120);
  expect(elements).toBeLessThan(2000);
  expect(report.nodes).toBeLessThan(report.nodesBefore + 2000);
  expect(errors).toEqual([]);
});
