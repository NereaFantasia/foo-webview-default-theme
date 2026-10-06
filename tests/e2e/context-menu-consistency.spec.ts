import { expect, test } from '@playwright/test';
import { albumsAnswer, albumTracksAnswer } from '../fixtures/albumLibrary.ts';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { openFolders } from '../fixtures/foldersPage.ts';
import { GENRES_TRACKS, openGenres } from '../fixtures/genresPage.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';

test('播放列表多选按右键曲目转到专辑，而不是按选区第一首', async ({ page }) => {
  const tracks = ['First', 'Second'].map((album, index) =>
    makeRow('Mix', index, { album, albumArtist: 'Artist', albumArtists: ['Artist'] }),
  );
  const { host, row } = await openPlaylist(page, 'Mix', tracks);
  host.answer(
    'library.getAlbums',
    albumsAnswer([albumRow('First', 'Artist'), albumRow('Second', 'Artist')]),
  );
  host.answer('library.getAlbumTracks', albumTracksAnswer);
  await host.emit('library:itemsModified', { count: 1, timestamp: 1 });
  await row('Mix 1').click();
  await row('Mix 2').click({ modifiers: ['Control'] });
  await row('Mix 2').click({ button: 'right' });
  const menu = page.locator('[data-playlist-track-menu]');
  await expect(menu).toContainText('曲目：Mix 2');
  const action = menu.locator('[data-action="go-to-album"]');
  await expect(action).not.toHaveAttribute('aria-disabled', 'true');
  await action.click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  expect(host.callsTo('library.getAlbumTracks').at(-1)).toMatchObject({
    album: 'Second',
    albumArtist: 'Artist',
  });
  const detailTrack = page.locator('[data-page="album"] [data-column-id="title"]').filter({
    hasText: /^Second 1$/,
  });
  await detailTrack.click({ button: 'right' });
  await expect(page.locator('[data-track-menu] [data-action="go-to-album"]')).toHaveCount(0);
});

test('宿主扩展失败仍可直接评分；混合评分不勾选，重开与表格共享值', async ({ page }) => {
  const { host, row } = await openPlaylist(page, 'Mix', [
    makeRow('Mix', 0, { rating: 2 }),
    makeRow('Mix', 1, { rating: 4 }),
  ]);
  host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
  host.answer('rating.set', (params) => ({
    success: true,
    path: String(params.path),
    rating: Number(params.rating),
    storage: 'stats',
  }));
  await row('Mix 1').click();
  await row('Mix 2').click({ modifiers: ['Control'] });
  await row('Mix 2').click({ button: 'right' });
  await page.locator('[data-playlist-track-menu] [data-action="rating"]').click();
  await expect(page.getByRole('status').filter({ hasText: '评分不同' })).toBeVisible();
  await page.locator('[data-action="rating:5"]').click();
  await expect.poll(() => host.callsTo('rating.set').length).toBe(2);
  expect(host.callsTo('menu.runContextCommandById')).toEqual([]);
  await row('Mix 2').click({ button: 'right' });
  await page.locator('[data-playlist-track-menu] [data-action="rating"]').click();
  await expect(page.locator('[data-action="rating:5"]')).toHaveAttribute('aria-checked', 'true');
});

test('未加载选区读取失败可以重试，完整读回后评分，写入失败即停止', async ({ page }) => {
  const tracks = Array.from({ length: 1200 }, (_, index) => makeRow('Mix', index));
  const { host, row } = await openPlaylist(page, 'Mix', tracks);
  const held = host.hold('playlist.getTracks');
  await row('Mix 1').click();
  await page.keyboard.press('Control+a');
  await row('Mix 1').click({ button: 'right' });
  await expect.poll(() => held.pending.length).toBeGreaterThan(0);
  held.respond(0, hostFailure('OPERATION_FAILED'));
  held.release();
  const menu = page.locator('[data-playlist-track-menu]');
  await menu.locator('[data-action="rating"]').click();
  await expect(page.getByRole('status').filter({ hasText: '所选曲目读取失败' })).toBeVisible();
  await page.locator('[data-action="rating-retry"]').click();
  await expect(page.locator('[data-action="rating:4"]')).toBeVisible();
  host.answer('rating.set', hostFailure('OPERATION_FAILED'));
  await page.locator('[data-action="rating:4"]').click();
  await expect.poll(() => host.callsTo('rating.set').length).toBe(1);
  expect(
    host.callsTo('playlist.getTracks').some((call) => call.start === 1000 && call.count === 200),
  ).toBe(true);
  await expect(page.getByText('评分保存失败', { exact: true })).toBeVisible();
  expect(host.callsTo('rating.set')).toHaveLength(1);
});

test('流派分组只操作筛选命中，专辑名菜单仍操作整张专辑', async ({ page }) => {
  const env = await openGenres(page);
  await env.genre('Trip-Hop').click();
  const group = env.grid.locator('[data-genre-group="Donuts"]');
  await group.getByText('1 首', { exact: true }).click({ button: 'right' });
  const menu = page.locator('[data-track-menu]');
  await expect(menu.locator('[data-action="play"]')).toContainText('播放本组');
  await expect(menu.locator('[data-action="go-to-album"]')).toHaveCount(0);
  await menu.locator('[data-action="play"]').click();
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual([GENRES_TRACKS.find((track) => track.title === 'Both')!.path]);
  expect(env.host.callsTo('library.getAlbumTracks')).toEqual([]);
  await group.getByRole('button', { name: 'Donuts', exact: true }).click({ button: 'right' });
  await expect(page.locator('[data-album-menu]')).toBeVisible();
  await expect.poll(() => env.host.callsTo('library.getAlbumTracks').at(-1)?.album).toBe('Donuts');
});

test('碟分组与艺人分组都有菜单，折叠后仍按原组范围操作', async ({ page }) => {
  const env = await openGenres(page);
  await env.view.getByRole('combobox', { name: '分组依据' }).click();
  await page.getByRole('option', { name: '专辑与碟号', exact: true }).click();
  const disc = env.grid.locator('[data-genre-group="第 2 碟"]');
  await disc.getByText('2 首', { exact: true }).click({ button: 'right' });
  await page.locator('[data-track-menu] [data-action="toggle-group"]').click();
  await expect(
    env.grid.locator('[data-column-id="title"]').filter({ hasText: /^Both$/ }),
  ).toHaveCount(0);
  await disc.getByText('2 首', { exact: true }).click({ button: 'right' });
  await page.locator('[data-track-menu] [data-action="play"]').click();
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual(
      ['Time', 'Both'].map((title) => GENRES_TRACKS.find((track) => track.title === title)!.path),
    );
  await env.view.getByRole('combobox', { name: '分组依据' }).click();
  await page.getByRole('option', { name: '艺人', exact: true }).click();
  const artist = env.grid.locator('[data-genre-group]').first();
  await artist.getByText('首', { exact: false }).click({ button: 'right' });
  await expect(page.locator('[data-track-menu] [data-action="play"]')).toContainText('播放本组');
});

test('文件夹单曲菜单显示曲名，专辑导航与评分不依赖宿主扩展', async ({ page }) => {
  const env = await openFolders(page);
  env.host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
  await env.folder('Alpha').click();
  await env.grid.getByText('Zebra', { exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Zebra', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="go-to-album"]')).toBeVisible();
  await expect(menu.locator('[data-action="rating"]')).not.toHaveAttribute('aria-disabled', 'true');
});
