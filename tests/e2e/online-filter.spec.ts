import { expect, test, type Page } from '@playwright/test';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';
import { collectPageErrors } from '../fixtures/pageHost.ts';

// 在线音乐单曲分类的检索范围与客户端二次筛选验证环境说明。
// 测试场景共 45 首曲目、分页步进 20 首，查询词与艺人均为 Nujabes，专辑为 Modal Soul；
// 第 1、4、7 等索引项（每隔 2 首）最高音质档位为无损。虚拟化列表的 DOM 行数不代表实际加载量，
// 结果数量以筛选浮层底栏的「显示几首 · 已取到几首」统计文案为准

test.use({ screenshot: 'off' });

const rows = (page: Page) => page.locator('[data-online-results] [data-online-track]');
const scope = (page: Page) => page.locator('[data-search-scope]');
const filterToggle = (page: Page) => page.locator('[data-filter-toggle]');
const conditions = (page: Page) => page.locator('[data-facet-conditions]');
const result = (page: Page, shown: string, loaded: string) =>
  page.getByText(new RegExp(`^显示 ${shown} 首 · 已取到 ${loaded} 首`));

const trackSearches = async (page: Page) =>
  (await onlineLog(page)).filter(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      Reflect.get(entry, 'kind') === 'search' &&
      Reflect.get(entry, 'type') === 'track',
  );

test('字段▾和筛选只在「曲目」分类出现，「全部」里没有', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page);
  await expect(page.getByRole('tab', { name: /^曲目/ })).toBeVisible();
  await expect(scope(page)).toHaveCount(0);
  await expect(filterToggle(page)).toHaveCount(0);
  await page.getByRole('tab', { name: /^曲目/ }).click();
  await expect(scope(page)).toHaveAttribute('aria-label', '搜索范围: 任意字段');
  await expect(filterToggle(page)).toBeVisible();
  await expect(conditions(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('勾「无损」只剩无损曲目，不够一屏就接着取下一页；条件行出芯片，移除后恢复', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(rows(page).first()).toContainText('Track 01');
  await filterToggle(page).click();
  await page.locator('[data-preset="lossless"]').click();
  // 首屏仅匹配到 7 首无损曲目，未填满可视区域，列表自动续页至全部 45 首加载完毕（无损共 15 首）
  await expect(result(page, '15', '45')).toBeVisible();
  await expect(rows(page).nth(1)).toContainText('Track 04');
  await expect(rows(page).nth(14)).toContainText('Track 43');
  await expect(filterToggle(page)).toHaveAccessibleName('筛选，1 项生效');
  await page.keyboard.press('Escape');
  await expect(conditions(page)).toContainText('无损');
  await page.getByRole('button', { name: '移除 无损' }).click();
  await expect(conditions(page)).toHaveCount(0);
  await expect(rows(page).nth(1)).toContainText('Track 02');
  await filterToggle(page).click();
  await expect(result(page, '45', '45')).toBeVisible();
  expect(errors).toEqual([]);
});

test('勾艺人分面：条件行写艺人名；清除条件后条件行收走', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(rows(page).first()).toContainText('Track 01');
  await filterToggle(page).click();
  await page.getByRole('checkbox', { name: /Nujabes/ }).check();
  await expect(conditions(page)).toContainText('Nujabes');
  // 结果集全部命中目标艺人，激活分面后匹配总数保持不变
  await expect(page.getByText(/^显示 (\d+) 首 · 已取到 \1 首/)).toBeVisible();
  await page.getByRole('button', { name: '清除条件' }).click();
  await expect(conditions(page)).toHaveCount(0);
});

test('字段选「标题」：查询词不在标题里，一首都不留；不自动往下取，清除后恢复', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(rows(page).first()).toContainText('Track 01');
  await scope(page).click();
  await expect(page.getByRole('menuitemradio', { name: '任意字段' })).toBeChecked();
  await page.getByRole('menuitemradio', { name: '标题' }).click();
  await expect(scope(page)).toHaveAttribute('aria-label', '搜索范围: 标题');
  const empty = page.locator('[data-online-empty="filtered"]');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('没有符合筛选的曲目');
  const detail = (await empty.textContent()) ?? '';
  const loaded = Number(/已取到 (\d+) 首/.exec(detail)?.[1]);
  expect(loaded).toBeGreaterThanOrEqual(20);
  // 匹配结果为空时终止自动分页加载，不产生多余检索请求，转由手动触发
  const before = (await trackSearches(page)).length;
  await page.waitForTimeout(600);
  expect((await trackSearches(page)).length).toBe(before);
  const more = page.locator('[data-online-more] button');
  await more.click();
  await expect(empty).toContainText(`已取到 ${loaded + 20 > 45 ? 45 : loaded + 20} 首`);
  await page.getByRole('button', { name: '清除全部筛选' }).click();
  await expect(empty).toHaveCount(0);
  await expect(scope(page)).toHaveAttribute('aria-label', '搜索范围: 任意字段');
  await expect(rows(page).first()).toContainText('Track 01');
  expect(errors).toEqual([]);
});

test('字段选「艺人」：查询词在艺人里，全部留着', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(rows(page).first()).toContainText('Track 01');
  await scope(page).click();
  await page.getByRole('menuitemradio', { name: '艺人' }).click();
  await expect(scope(page)).toHaveAttribute('aria-label', '搜索范围: 艺人');
  await expect(rows(page).first()).toContainText('Track 01');
  await filterToggle(page).click();
  await expect(page.getByText(/^显示 (\d+) 首 · 已取到 \1 首/)).toBeVisible();
});

test('筛选可嵌入页面：嵌入后面板留在分类行下，收起只剩键，刷新后仍是嵌入；改为浮层再弹出', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(rows(page).first()).toContainText('Track 01');
  const surface = page.locator('[data-filter-surface]');
  await filterToggle(page).click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'popover');
  await surface.locator('[data-filter-dock]').click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'docked');
  // 停靠状态下面板保持常驻，结果统计信息转至面板下方呈现
  await page.locator('[data-preset="lossless"]').click();
  await expect(surface).toBeVisible();
  await expect(result(page, '15', '45')).toBeVisible();
  await surface.locator('[data-filter-collapse]').click();
  await expect(surface).toHaveCount(0);
  await expect(filterToggle(page)).toHaveAttribute('aria-expanded', 'false');
  // 刷新后保持停靠形态持久化偏好，再次展开时呈现为停靠面板而非浮层
  await page.reload();
  await page.locator('[data-online-harness]').waitFor();
  await expect(rows(page).first()).toContainText('Track 01');
  await filterToggle(page).click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'docked');
  await surface.locator('[data-filter-undock]').click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'popover');
  expect(errors).toEqual([]);
});

test('嵌入过的筛选在窄窗口里仍只弹出，不嵌入', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { category: 'tracks' });
  await expect(rows(page).first()).toContainText('Track 01');
  const surface = page.locator('[data-filter-surface]');
  await filterToggle(page).click();
  await surface.locator('[data-filter-dock]').click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'docked');
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(filterToggle(page)).toBeVisible();
  await filterToggle(page).click();
  await expect(surface).toHaveAttribute('data-filter-surface', 'popover');
  await expect(surface.locator('[data-filter-dock]')).toHaveCount(0);
});

test('窄窗口下命令只留图标，不溢出分类行', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 800 });
  await openOnlineHarness(page, { category: 'tracks', lx: 'hosted' });
  await expect(rows(page).first()).toBeVisible();
  await expect(scope(page)).toHaveText('');
  const toggle = await filterToggle(page).boundingBox();
  const row = await page.locator('[data-online-controls]').boundingBox();
  expect(toggle && row && toggle.x >= row.x && toggle.x + toggle.width <= row.x + row.width).toBe(
    true,
  );
  const overflow = await page
    .locator('[data-online-controls]')
    .evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(false);
});
