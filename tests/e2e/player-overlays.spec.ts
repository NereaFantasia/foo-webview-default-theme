import { expect, test, type Locator } from '@playwright/test';
import { libraryAnswers } from '../fixtures/albumLibrary.ts';
import { albumRow, albumTrackRow, trackRow } from '../fixtures/libraryRows.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';
import { choosePlayerBar, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { openSongs } from '../fixtures/songsPage.ts';
import { openHome } from '../fixtures/homePage.ts';

test.use({ screenshot: 'off' });

async function box(target: Locator) {
  const value = await target.boundingBox();
  if (!value) throw new Error('布局元素不存在');
  return { ...value, bottom: value.y + value.height };
}

test('首页聚焦胶囊遮挡区内的按钮时自动滚到可操作位置', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await choosePlayerBar(page, 'capsule');
  const home = await openHome(page, {
    configure(host) {
      host.answer('playback.getCurrentTrack', { success: true, found: true, track: PLAYING_TRACK });
      host.answer('playback.getState', {
        success: true,
        state: 'playing',
        canSeek: true,
        canPause: true,
      });
    },
  });
  const capsule = page.locator('[data-player-capsule]');
  await expect(capsule).toBeVisible();
  const target = home.view
    .locator('[data-home-section="explore"] [data-home-album]')
    .nth(1)
    .locator('button')
    .first();
  await target.evaluate((element) => {
    const scroll = element.closest<HTMLElement>('[data-page="home"]');
    if (!scroll) throw new Error('首页滚动容器不存在');
    scroll.scrollTop +=
      element.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom + 40;
  });
  const obstacle = await box(capsule);
  expect((await box(target)).bottom).toBeGreaterThan(obstacle.y);
  await target.focus();
  await expect(target).toBeFocused();
  await expect.poll(async () => (await box(target)).bottom).toBeLessThanOrEqual(obstacle.y);
  expect(home.errors).toEqual([]);
});

test('封面墙在胶囊出现后更新键盘定位的底部遮挡范围', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await choosePlayerBar(page, 'capsule');
  const albums = Array.from({ length: 90 }, (_, index) =>
    albumRow(`Album ${String(index).padStart(3, '0')}`, 'Artist'),
  );
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: libraryAnswers(albums) });
  await page.goto('/');
  const wall = page.locator('[data-album-wall]');
  await expect(wall.locator('[data-album-tile]').first()).toBeVisible();
  await wall.press('Home');
  host.answer('playback.getCurrentTrack', { success: true, found: true, track: PLAYING_TRACK });
  await host.waitForListener('playback:trackChanged');
  await host.emit('playback:trackChanged', PLAYING_TRACK);
  const capsule = page.locator('[data-player-capsule]');
  await expect(capsule).toBeVisible();
  await expect(wall).toHaveCSS('padding-bottom', '96px');
  await wall.press('End');
  const last = wall.locator('[data-album-tile]').filter({ hasText: 'Album 089' });
  await expect(last).toBeVisible();
  await expect
    .poll(async () => (await box(last)).bottom)
    .toBeLessThanOrEqual((await box(capsule)).y);
  expect(errors).toEqual([]);
});

for (const scenario of [
  { width: 1280, scheme: 'dark' },
  { width: 390, scheme: 'light' },
] as const) {
  test(`AM 专辑详情页首让位、滚动穿过导航、采样背景固定：${scenario.width}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scenario.scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: scenario.width, height: 720 });
    await choosePlayerBar(page, 'titlebar');
    const errors = collectPageErrors(page);
    const album = albumRow('Overlay Album', 'Artist');
    const tracks = Array.from({ length: 100 }, (_, index) =>
      albumTrackRow(album.name, album.albumArtist, `Song ${index}`, { trackNumber: index + 1 }),
    );
    const host = await installPageHost(page, { answers: libraryAnswers([album]) });
    host.answer('library.getAlbumTracks', {
      success: true,
      album: album.name,
      albumArtist: album.albumArtist,
      tracks,
      items: tracks,
      total: tracks.length,
    });
    await page.goto('/');
    await page
      .locator('[data-album-tile]')
      .filter({ hasText: album.name })
      .click({ button: 'right' });
    await page.locator('[data-album-menu] [data-action="open-detail"]').click();
    const view = page.locator('[data-page="album"]');
    await expect(view.getByRole('heading', { level: 1 })).toHaveText(album.name);
    const scroller = view.locator('[data-detail-scroller]');
    const intro = view.locator('[data-detail-intro]');
    const glow = view.locator(':scope > [data-cover-glow]');
    const navigation = page.locator('[data-nav-row]');
    const navBox = await box(navigation);
    const initialIntro = await box(intro);
    const initialGlow = await box(glow);
    expect((await box(scroller)).y).toBeCloseTo((await box(view)).y, 0);
    expect(initialGlow.y).toBeCloseTo(navBox.y, 0);
    expect(initialIntro.y).toBeGreaterThan(navBox.bottom);

    await scroller.evaluate((element) => {
      element.scrollTop = 160;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(160);
    expect((await box(intro)).y).toBeCloseTo(initialIntro.y - 160, 0);
    expect((await box(intro)).y).toBeLessThan(navBox.bottom);
    expect(await box(navigation)).toEqual(navBox);
    expect(await box(glow)).toEqual(initialGlow);
    const middleIsPage = await navigation.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 12);
      return hit !== null && !element.contains(hit);
    });
    expect(middleIsPage).toBe(true);
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await box(glow)).toEqual(initialGlow);
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(async () => (await box(intro)).y).toBeCloseTo(initialIntro.y, 0);
    expect(errors).toEqual([]);
  });
}

for (const width of [1280, 900]) {
  test(`歌曲固定工具栏不随曲目滚动升降：${width}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 720 });
    await choosePlayerBar(page, 'titlebar');
    const tracks = Array.from({ length: 160 }, (_, index) =>
      trackRow('Album', `Track ${index}`, { index }),
    );
    const songs = await openSongs(page, {
      configure(host) {
        host.answer('library.getAll', {
          success: true,
          tracks,
          items: tracks,
          total: tracks.length,
          offset: 0,
        });
        host.answer('library.query', {
          success: true,
          tracks: tracks.map(({ handle, index }) => ({ handle, index })),
          total: tracks.length,
        });
      },
    });
    const scroller = songs.grid.locator('> div[tabindex="-1"]');
    const original = await box(songs.box);
    const navigation = page.locator('[data-nav-row]');
    const navBox = await box(navigation);
    expect(original.y).toBeGreaterThanOrEqual(navBox.bottom);
    await scroller.evaluate((element) => {
      element.scrollTop = 400;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(400);
    expect(await box(songs.box)).toEqual(original);
    expect(await box(navigation)).toEqual(navBox);
    await songs.box.focus();
    await expect(songs.box).toBeFocused();
    expect(await box(songs.box)).toEqual(original);
    expect(songs.errors).toEqual([]);
  });
}

for (const width of [1280, 900]) {
  test(`胶囊下方绘制播放列表，末行能滚出遮挡：${width}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await choosePlayerBar(page, 'capsule');
    const tracks = Array.from({ length: 120 }, (_, index) => makeRow('Mix', index));
    const playlist = await openPlaylist(page, 'Mix', tracks);
    await page.setViewportSize({ width, height: 720 });
    playlist.host.answer('playback.getCurrentTrack', {
      success: true,
      found: true,
      track: PLAYING_TRACK,
    });
    await playlist.host.waitForListener('playback:trackChanged');
    await playlist.host.emit('playback:trackChanged', PLAYING_TRACK);
    const capsule = page.locator('[data-player-capsule]');
    await expect(capsule).toBeVisible();
    const scroller = playlist.grid.locator('> div[tabindex="-1"]');
    const viewport = scroller.locator('[role="rowgroup"] > [role="none"]');
    expect((await box(playlist.view)).bottom - (await box(scroller)).bottom).toBeCloseTo(16, 0);
    const capsuleBox = await box(capsule);
    expect((await box(viewport)).bottom).toBeGreaterThanOrEqual(capsuleBox.bottom);
    expect(
      await playlist.grid.locator('[role="row"][aria-selected]').evaluateAll(
        (rows, y) =>
          rows.some((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top <= y && rect.bottom > y;
          }),
        capsuleBox.y + capsuleBox.height / 2,
      ),
    ).toBe(true);
    await playlist.grid.press('End');
    const last = playlist.row('Mix 120');
    await expect(last).toHaveAttribute('data-row-focus', 'true');
    await expect.poll(async () => (await box(last)).bottom).toBeLessThanOrEqual(capsuleBox.y);
    expect(playlist.errors).toEqual([]);
  });
}
