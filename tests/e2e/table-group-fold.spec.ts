import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFolders } from '../fixtures/foldersPage.ts';
import { openGenres } from '../fixtures/genresPage.ts';
import { albumTracks, openPlaylist } from '../fixtures/playlistPage.ts';

test.use({ screenshot: 'off' });

async function closeGroup(page: Page, trigger: Locator, content: string) {
  const snapshot = await trigger.evaluate(async (element) => {
    if (!(element instanceof HTMLElement)) throw new Error('缺少折叠入口');
    element.click();
    await new Promise(requestAnimationFrame);
    const frame = document.querySelector<HTMLElement>('[data-table-fold-ghost]');
    if (!frame) throw new Error('分组收起没有播放动画');
    const animations = frame.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    return {
      inert: frame.inert,
      hidden: frame.getAttribute('aria-hidden'),
      text: frame.firstElementChild?.textContent,
      durations: animations.map((animation) => animation.effect?.getTiming().duration),
      layers: frame.firstElementChild?.querySelectorAll('[data-level="2"], [data-disc="true"]')
        .length,
    };
  });
  expect(snapshot.inert).toBe(true);
  expect(snapshot.hidden).toBe('true');
  expect(snapshot.text).toContain(content);
  expect(snapshot.durations).toEqual([167, 167]);
  await page.locator('[data-table-fold-ghost]').evaluate(async (frame) => {
    const animations = frame.getAnimations({ subtree: true });
    for (const animation of animations) animation.finish();
    await Promise.all(animations.map((animation) => animation.finished));
  });
  await expect(page.locator('[data-table-fold-ghost]')).toHaveCount(0);
  return snapshot;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`播放列表 ${colorScheme} 的箭头和组头点击均播放折叠，键盘可以展开`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const env = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
    const group = env.group('Album 1 | Artist 1');
    await expect(env.row('Mix 1')).toBeVisible();
    await closeGroup(page, group.getByRole('button', { name: '折叠', exact: true }), 'Mix 1');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await env.grid.focus();
    await page.keyboard.press('ArrowRight');
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-table-fold-ghost]')).toHaveCount(0);
    await expect(env.row('Mix 1')).toBeVisible();
    await closeGroup(page, group.locator('[data-playlist-group]'), 'Mix 1');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(env.errors).toEqual([]);
  });

  test(`流派 ${colorScheme} 的专辑和碟号均有折叠，父组保留子组状态与缩进`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const env = await openGenres(page);
    await env.view.getByRole('combobox', { name: '分组依据' }).click();
    await page.getByRole('option', { name: '专辑与碟号', exact: true }).click();
    const disc = env.grid.locator('[data-genre-group="第 1 碟"]');
    await expect(disc).toBeVisible();
    await closeGroup(page, disc.getByRole('button'), 'Workinonit');
    const album = env.grid.locator('[data-table-item-key]:has([data-genre-group="Donuts"])');
    const snapshot = await closeGroup(
      page,
      album.getByRole('button', { name: '展开或折叠分组', exact: true }),
      'Time',
    );
    expect(snapshot.layers).toBe(2);
    await expect(album).toHaveAttribute('aria-expanded', 'false');
    await env.grid.focus();
    await page.keyboard.press('ArrowRight');
    await expect(album).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-table-fold-ghost]')).toHaveCount(0);
    await expect(env.grid.getByText('Workinonit', { exact: true })).toHaveCount(0);
    await expect(env.grid.getByText('Time', { exact: true })).toBeVisible();
    await env.grid.locator('[data-genre-group="第 1 碟"]').click();
    await expect(page.locator('[data-table-fold-ghost]')).toHaveCount(1);
    await page.locator('[data-table-fold-ghost]').evaluate(async (frame) => {
      const animations = frame.getAnimations({ subtree: true });
      for (const animation of animations) animation.finish();
      await Promise.all(animations.map((animation) => animation.finished));
    });
    await expect(page.locator('[data-table-fold-ghost]')).toHaveCount(0);
    await album.locator('[data-genre-group]').click({ button: 'right' });
    await closeGroup(page, page.getByRole('menuitem', { name: '折叠本组', exact: true }), 'Time');
    await expect(album).toHaveAttribute('aria-expanded', 'false');
    expect(env.errors).toEqual([]);
  });

  test(`文件夹 ${colorScheme} 的目录组和本层曲目均有折叠`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const env = await openFolders(page);
    await env.folder('Alpha').click();
    await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
    const group = env.grid.getByRole('row').filter({
      has: page.getByRole('button', { name: 'Disc', exact: true }),
    });
    await closeGroup(page, group.getByRole('button', { name: '折叠目录', exact: true }), 'Amber');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await env.grid.focus();
    await page.keyboard.press('ArrowRight');
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-table-fold-ghost]')).toHaveCount(0);
    const own = env.grid.getByRole('row').filter({
      has: page.getByRole('button', { name: '本层曲目', exact: true }),
    });
    await closeGroup(page, own, 'Zebra');
    await expect(own).toHaveAttribute('aria-expanded', 'false');
    await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
    expect(env.errors).toEqual([]);
  });
}
