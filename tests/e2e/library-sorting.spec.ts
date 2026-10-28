import { expect, test } from '@playwright/test';
import { libraryAnswers } from '../fixtures/albumLibrary.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

test.use({ screenshot: 'off' });

for (const colorScheme of ['light', 'dark'] as const) {
  test(`专辑两种形态共用字段与方向菜单，设置分别保留：${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const errors = collectPageErrors(page);
    const albums = [
      albumRow('Old', 'Artist', { year: '1990' }),
      albumRow('New', 'Artist', { year: '2020' }),
      albumRow('Unknown', 'Artist'),
    ];
    await installPageHost(page, {
      answers: libraryAnswers(albums),
      config: { 'defaultTheme.browser.sort': 'year' },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const sort = page.locator('[data-album-tool="sort"]');
    const tiles = page.locator('[data-album-tile]');
    await expect(tiles).toHaveCount(3);
    const order = () =>
      tiles.evaluateAll((elements) =>
        elements
          .map((element) => ({
            name: element.getAttribute('aria-label') ?? element.textContent,
            x: element.getBoundingClientRect().x,
          }))
          .sort((a, b) => a.x - b.x)
          .map((item) => item.name),
      );
    await sort.click();
    await expect(page.locator('[data-sort-field]')).toHaveCount(17);
    await page.getByRole('menuitemradio', { name: '升序', exact: true }).click();
    await expect
      .poll(order)
      .toEqual([
        expect.stringContaining('Old'),
        expect.stringContaining('New'),
        expect.stringContaining('Unknown'),
      ]);
    await sort.click();
    await page.getByRole('menuitemradio', { name: '降序', exact: true }).click();
    await expect
      .poll(order)
      .toEqual([
        expect.stringContaining('New'),
        expect.stringContaining('Old'),
        expect.stringContaining('Unknown'),
      ]);
    await page.locator('[data-album-tool="view"]').click();
    await page.getByRole('tab', { name: '列表', exact: true }).click();
    await page.keyboard.press('Escape');
    await sort.click();
    await expect(page.locator('[data-sort-field]')).toHaveCount(17);
    await expect(page.locator('[data-sort-field="rating"]')).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.locator('[data-album-tool="view"]').click();
    await page.getByRole('tab', { name: '封面墙', exact: true }).click();
    await page.keyboard.press('Escape');
    await sort.click();
    await expect(page.getByRole('menuitemradio', { name: '降序', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('menuitemradio', { name: '升序', exact: true }).click();
    await page.reload();
    await expect(tiles).toHaveCount(3);
    await sort.click();
    await expect(page.getByRole('menuitemradio', { name: '升序', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(errors).toEqual([]);
  });
}

test('封面墙统计探测和读取失败均可重试，恢复后按播放次数重排', async ({ page }) => {
  const errors = collectPageErrors(page);
  const albums = [albumRow('New', 'Artist'), albumRow('Old', 'Artist')];
  const host = await installPageHost(page, {
    answers: {
      ...libraryAnswers(albums),
      config: { getComponents: hostFailure('OPERATION_FAILED') },
      titleformat: { evalBatch: hostFailure('OPERATION_FAILED') },
    },
    config: { 'defaultTheme.browser.wallSort.v1': { field: 'playCount', descending: true } },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const notice = page.locator('[data-album-notice="stats"]');
  await expect(notice).toContainText('播放统计组件检查失败');
  host.answer('config.getComponents', {
    success: true,
    count: 1,
    components: [{ name: 'Playback Statistics', filename: 'foo_playcount.dll', version: '3.1' }],
  });
  await notice.getByRole('button', { name: '重试' }).click();
  await expect(notice).toContainText('播放统计信息读取失败');
  host.answer('titleformat.evalBatch', (params) => {
    const paths = Array.isArray(params['paths'])
      ? params['paths'].filter((path): path is string => typeof path === 'string')
      : [];
    const results = paths.map((path) => ({
      path,
      success: true,
      result: `2024-01-01 00:00:00|||${path.includes('Old') ? 10 : 1}`,
    }));
    return {
      success: true,
      pattern: String(params['pattern']),
      results,
      total: results.length,
      successCount: results.length,
      errorCount: 0,
    };
  });
  await notice.getByRole('button', { name: '重试' }).click();
  await expect(notice).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('[data-album-tile]').evaluateAll((tiles) =>
        tiles
          .map((tile) => ({ text: tile.textContent, x: tile.getBoundingClientRect().x }))
          .sort((a, b) => a.x - b.x)
          .map((tile) => tile.text),
      ),
    )
    .toEqual([expect.stringContaining('Old'), expect.stringContaining('New')]);
  expect(errors).toEqual([]);
});
