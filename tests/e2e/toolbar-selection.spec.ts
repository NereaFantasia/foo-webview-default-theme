import { expect, test } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';
import { openSongs } from '../fixtures/songsPage.ts';

test('选区的 Esc 先关闭菜单，再取消选择并恢复搜索', async ({ page }) => {
  const songs = await openSongs(page);
  await songs.grid.getByRole('row').nth(1).click();
  await page.keyboard.press('Control+A');
  const bar = songs.view.locator('[data-command-bar="selection"]');
  await expect(bar.locator('[data-selection-count]')).toBeVisible();
  await bar.locator('[data-selection-action="send-to"]').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(songs.box).toBeVisible();
  await expect(songs.grid.locator('[aria-selected="true"]')).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} 选区栏各宽度单行且不越界，视图组贴右端`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const songs = await openSongs(page);
    await songs.grid.getByRole('row').nth(1).click();
    await page.keyboard.press('Control+A');
    for (const width of [1280, 1120, 1000, 900, 640, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const bar = songs.view.locator('[data-command-bar="selection"]');
      await expect
        .poll(() =>
          bar.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const buttons = [...element.querySelectorAll('button')]
              .map((button) => button.getBoundingClientRect())
              .filter((rect) => rect.width > 0);
            const last = buttons.at(-1);
            return (
              bounds.height === 40 &&
              buttons.every(
                (rect, index) =>
                  rect.x >= bounds.x - 1 &&
                  rect.right <= bounds.right + 1 &&
                  rect.y >= bounds.y - 1 &&
                  rect.bottom <= bounds.bottom + 1 &&
                  (index === 0 || rect.x >= (buttons[index - 1]?.right ?? 0) - 1),
              ) &&
              !!last &&
              Math.abs(last.right - bounds.right) <= 1
            );
          }),
        )
        .toBe(true);
    }
    expect(songs.errors).toEqual([]);
  });
}

test('播放列表大选区的播放与内联发送明确置灰，更多菜单仍可打开', async ({ page }) => {
  const tracks = Array.from({ length: 2001 }, (_, index) => makeRow('Mix', index));
  const env = await openPlaylist(page, 'Mix', tracks);
  await env.row('Mix 1').click();
  await page.keyboard.press('Control+A');
  const bar = env.view.locator('[data-command-bar="selection"]');
  await expect(bar.locator('[data-selection-count]')).toContainText('2001');
  await expect(bar.locator('[data-selection-action="play"]')).toBeDisabled();
  await expect(bar.locator('[data-selection-action="send-to"]')).toBeDisabled();
  await bar.locator('[data-selection-more]').click();
  await expect(page.locator('[data-playlist-track-menu]')).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('选区起播读取失败有提示，关闭后保留选择', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix');
  await env.row('Mix 1').click();
  await env.row('Mix 2').click({ modifiers: ['Control'] });
  env.host.answer('playlist.getTracks', hostFailure('OPERATION_FAILED'));
  await env.view.locator('[data-selection-action="play"]').click();
  const notice = env.view.locator('[data-playlist-notice="command"]');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(env.view.locator('[data-selection-count]')).toContainText('2');
  expect(env.errors).toEqual([]);
});

test('发送选中曲目时不列出当前播放列表，锁定目标不可用', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix');
  await env.row('Mix 1').click();
  await env.row('Mix 2').click({ modifiers: ['Control'] });
  await env.view.locator('[data-selection-action="send-to"]').click();
  await expect(page.getByRole('menuitem', { name: 'Mix', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Smart 锁定', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Default', exact: true }).click();
  await expect
    .poll(() => env.lists.tracksOf(env.lists.items[0]!).map((row) => row.path))
    .toEqual([
      ...Array.from({ length: 3 }, (_, index) => makeRow('Default', index).path),
      makeRow('Mix', 0).path,
      makeRow('Mix', 1).path,
    ]);
  expect(env.errors).toEqual([]);
});

test('选区起播读取期间列表内容变化，旧应答不播放，新内容仍能起播', async ({ page }) => {
  const env = await openPlaylist(page, 'Mix');
  await env.row('Mix 1').click();
  await env.row('Mix 2').click({ modifiers: ['Control'] });
  const read = env.host.hold('playlist.getTracks');
  await env.view.locator('[data-selection-action="play"]').click();
  await expect.poll(() => read.pending.length).toBeGreaterThan(0);
  const changed = Array.from({ length: 12 }, (_, index) => makeRow('Changed', index));
  env.lists.setTracks(env.guid, changed);
  await env.host.emit('playlist:itemsReplaced', {
    playlist: 1,
    playlistGuid: env.guid,
    count: 12,
    contentVersion: '1',
  });
  read.respond(0, {
    success: true,
    playlist: 1,
    start: 0,
    count: 2,
    total: 12,
    tracks: [makeRow('Mix', 0), makeRow('Mix', 1)],
  });
  read.release();
  await expect(env.row('Changed 1')).toBeVisible();
  await expect(env.view.locator('[data-selection-count]')).toContainText('2');
  await env.view.locator('[data-selection-action="play"]').click();
  await expect.poll(() => env.host.callsTo('playlist.playTrack').length).toBe(1);
  expect(env.host.callsTo('library.addToPlaylist').map((call) => call.paths)).toEqual([
    changed.slice(0, 2).map((row) => row.path),
  ]);
  expect(env.errors).toEqual([]);
});
