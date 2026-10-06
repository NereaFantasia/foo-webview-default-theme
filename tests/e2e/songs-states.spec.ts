import { expect, test } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openSongs } from '../fixtures/songsPage.ts';

test('空媒体库读完显示空态与 0 首，不停留在骨架或读取中', async ({ page }) => {
  const songs = await openSongs(page, {
    waitForRows: false,
    configure(host) {
      host.answer('library.getAll', { success: true, tracks: [], items: [], total: 0, offset: 0 });
      host.answer('library.query', { success: true, tracks: [], total: 0 });
    },
  });
  await expect(songs.view.locator('[data-songs-empty="empty"]')).toBeVisible();
  await expect(songs.subtitle).toHaveText('0 首');
  await expect(songs.grid).not.toHaveAttribute('aria-busy', 'true');
  await expect(songs.view.locator('[data-songs-play]')).toBeDisabled();
  expect(songs.errors).toEqual([]);
});

test('首次查询失败结束加载，重试恢复行与统计', async ({ page }) => {
  const songs = await openSongs(page, {
    waitForRows: false,
    configure: (host) => host.answer('library.query', hostFailure('OPERATION_FAILED')),
  });
  const notice = songs.view.locator('[data-songs-notice="rows"]');
  await expect(notice).toBeVisible();
  await expect(songs.subtitle).toHaveText('读取歌曲失败');
  await expect(songs.grid).not.toHaveAttribute('aria-busy', 'true');
  songs.host.answer('library.query', { success: true, tracks: [], total: 0 });
  await notice.getByRole('button', { name: '重试' }).click();
  await expect(notice).toHaveCount(0);
  await expect(songs.subtitle).toHaveText('0 首');
  expect(songs.errors).toEqual([]);
});

test('无匹配可以清空筛选回到整库，期间不允许起播', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('nothing-matches-this');
  const empty = songs.view.locator('[data-songs-empty="noMatch"]');
  await expect(empty).toContainText('nothing-matches-this');
  await expect(songs.view.locator('[data-songs-play]')).toBeDisabled();
  await empty.getByRole('button', { name: '清除全部筛选' }).click();
  await expect(songs.box).toHaveValue('');
  await expect(songs.subtitle).toHaveText(/^8 首/);
  expect(songs.errors).toEqual([]);
});

test('表格打字定位标题，回车从焦点行起播；多选不提供移除与撤销', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.grid.focus();
  await page.keyboard.type('tear');
  await expect(songs.row('Teardrop')).toHaveAttribute('data-row-focus', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => songs.host.callsTo('playlist.playTrack')).toHaveLength(1);
  expect(songs.host.callsTo('playlist.playTrack')[0]).toMatchObject({ index: 3 });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  expect(songs.host.callsTo('playlist.removeTracks')).toEqual([]);
  expect(songs.host.callsTo('playlist.undo')).toEqual([]);
  expect(songs.errors).toEqual([]);
});

test('去详情页再后退，过滤词、条件与焦点恢复，前进仍到同一专辑', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.box.fill('massive');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await songs.view.locator('[data-songs-facets-toggle]').click();
  await songs.view
    .locator('[data-songs-facet="genre"]')
    .getByRole('checkbox', { name: 'Trip-Hop' })
    .check();
  await songs.row('Teardrop').click();
  await songs.row('Teardrop').getByRole('button', { name: 'Mezzanine' }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(songs.box).toHaveValue('massive');
  await expect(songs.view.locator('[data-songs-condition="genre:Trip-Hop"]')).toBeVisible();
  await expect(songs.row('Teardrop')).toHaveAttribute('data-row-focus', 'true');
  await expect(songs.subtitle).toHaveText(/^2 首/);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  expect(songs.errors).toEqual([]);
});

test('曲目菜单命令失败在歌曲页可见并能关闭', async ({ page }) => {
  const songs = await openSongs(page);
  songs.host.answer('playlist.clear', hostFailure('OPERATION_FAILED'));
  await songs.row('Angel').click({ button: 'right' });
  await page.locator('[data-track-menu] [data-action="play"]').click();
  const notice = songs.view.locator('[data-songs-notice="menu"]');
  await expect(notice).toBeVisible();
  await notice.getByRole('button').click();
  await expect(notice).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

test('查询有误时保留上次结果，页头播放与整批操作等待有效查询', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.view.locator('[data-query-mode-toggle]').click();
  await songs.box.fill('%bitrate GREATER 900 AND');
  await expect(songs.view.locator('[data-songs-invalid]')).toBeVisible();
  await expect(songs.view.locator('[data-songs-play]')).toBeDisabled();
  await expect(songs.view.locator('[data-songs-shuffle]')).toBeDisabled();
  await songs.view.locator('[data-songs-more]').click();
  await expect(page.locator('[data-action="autoplaylist"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.locator('[data-action="send-to-new"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(await songs.titles()).toHaveLength(8);
  expect(songs.host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  expect(songs.errors).toEqual([]);
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme} 档的 1280、900、390 窗口：表格收列，条件溢出可从菜单去掉`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const songs = await openSongs(page);
    for (const width of [1280, 900, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(songs.grid.getByRole('columnheader', { name: '年份', exact: true })).toHaveCount(
        width === 1280 ? 1 : 0,
      );
      await expect(songs.grid.getByRole('columnheader', { name: '艺人', exact: true })).toHaveCount(
        width > 390 ? 1 : 0,
      );
      const heading = await songs.view.getByRole('heading', { name: '歌曲' }).boundingBox();
      const play = await songs.view.locator('[data-songs-play]').boundingBox();
      expect(heading && play && heading.x + heading.width <= play.x).toBeTruthy();
      const filter = await songs.box.boundingBox();
      expect(
        filter && filter.x >= 0 && filter.x + filter.width <= width,
        JSON.stringify({ width, filter }),
      ).toBeTruthy();
      await expect(songs.subtitle).toHaveText(width === 390 ? '8 首' : /^8 首 · \d+ 分钟$/);
      await expect(songs.subtitle).toHaveAttribute('title', /^8 首 · \d+ 分钟$/);
    }
    await songs.view.locator('[data-query-funnel]').click();
    const menu = page.locator('[data-query-menu]');
    for (const preset of ['highRated', 'lossless', 'hiRes', 'long', 'missingTags']) {
      await menu.locator(`[data-query-option="${preset}"]`).click();
    }
    await songs.box.press('Escape');
    const more = songs.view.locator('[data-songs-condition-overflow]');
    await expect(more).toBeVisible();
    await expect
      .poll(() => songs.view.locator('[data-songs-condition]:visible').count())
      .toBeLessThanOrEqual(3);
    await more.click();
    await page.getByRole('menuitem', { name: '移除「缺少标签」' }).click();
    await songs.view.getByRole('button', { name: '清除条件', exact: true }).click();
    await expect(songs.view.locator('[data-songs-conditions]')).toHaveCount(0);
    expect(songs.errors).toEqual([]);
  });
}
