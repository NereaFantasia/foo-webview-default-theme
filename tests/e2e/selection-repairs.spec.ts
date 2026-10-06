import { expect, test, type Page } from '@playwright/test';
import { albumTracksAnswer, libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { installFakeQueue, queueTracks } from '../fixtures/fakeQueue.ts';
import { openLargeQueue } from '../fixtures/rightCardPage.ts';

test.use({ screenshot: 'off' });

async function openDropdown(page: Page) {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('[data-album-tile]').filter({ hasText: 'Blue Train' }).click();
  const list = page.locator('[data-dropdown-tracks]');
  const rows = list.getByRole('option');
  await expect(rows).toHaveCount(2);
  return { host, errors, list, rows, selected: list.locator('[aria-selected="true"]') };
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`下拉曲目多选、取消、键盘扩选与批量发送（${colorScheme}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const env = await openDropdown(page);
    const { rows, list, selected, host } = env;
    await rows.first().click();
    await rows.last().click({ modifiers: ['Control'] });
    await expect(selected).toHaveCount(2);
    await rows.last().click({ button: 'right' });
    await expect(page.locator('[data-album-menu] [data-menu-caption]')).toContainText('2 首');
    await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
    await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
    await expect
      .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
      .toEqual([
        'file://E:\\Music\\Blue Train\\Blue Train 1.flac',
        'file://E:\\Music\\Blue Train\\Blue Train 2.flac',
      ]);
    await rows.first().click({ modifiers: ['Control'] });
    await rows.last().click({ modifiers: ['Control'] });
    await expect(selected).toHaveCount(0);
    await list.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(selected).toHaveCount(2);
    await rows.last().click();
    await page.keyboard.press('Control+a');
    await expect(selected).toHaveCount(2);
    await rows.first().click();
    await rows.last().click({ button: 'right' });
    await expect(selected).toHaveCount(1);
    await expect(page.locator('[data-album-menu] [data-menu-caption]')).toContainText(
      'Blue Train 2',
    );
    expect(env.errors).toEqual([]);
  });
}

test('下拉曲序刷新保留曲目身份，移除焦点曲目后不留下失效焦点', async ({ page }) => {
  const { host, rows, list, selected, errors } = await openDropdown(page);
  await rows.first().click();
  host.answer('library.getAlbumTracks', (params) => {
    const answer = albumTracksAnswer(params);
    if (answer.success === false) return answer;
    const tracks = answer.tracks.map((track) => ({ ...track, trackNumber: 3 - track.trackNumber }));
    return { ...answer, tracks, items: tracks };
  });
  await host.waitForListener('library:itemsModified');
  await host.emit('library:itemsModified', { count: 2, timestamp: 1 });
  await expect(rows.first()).toContainText('Blue Train 2');
  await expect(selected).toContainText('Blue Train 1');
  host.answer('library.getAlbumTracks', (params) => {
    const answer = albumTracksAnswer(params);
    if (answer.success === false) return answer;
    const tracks = answer.tracks.slice(1);
    return { ...answer, tracks, items: tracks, total: 1 };
  });
  await host.emit('library:itemsRemoved', { count: 1, timestamp: 2 });
  await expect(rows).toHaveCount(1);
  await expect(selected).toHaveCount(0);
  await expect(list).not.toHaveAttribute('aria-activedescendant');
  await list.focus();
  await page.keyboard.press('Enter');
  expect(host.callsTo('playlist.playTrack')).toHaveLength(0);
  await page.keyboard.press('Home');
  await expect(selected).toContainText('Blue Train 2');
  expect(errors).toEqual([]);
});

test('艺人焦点被过滤后，菜单键和回车不能操作隐藏对象', async ({ page }) => {
  const env = await openArtists(page);
  await env.artist('Nujabes').click();
  await env.view.getByRole('textbox').fill('Fat Jon');
  await expect(env.artist('Nujabes')).toHaveCount(0);
  await env.list.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Enter');
  expect(env.host.callsTo('playlist.playTrack')).toHaveLength(0);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: '复制名称', exact: true }).click();
  await expect.poll(() => env.host.callsTo('clipboard.write').at(-1)).toEqual({ text: 'Fat Jon' });
  expect(env.errors).toEqual([]);
});

test('队列 Ctrl+A 选中当前段全部曲目，Delete 移除后可撤销', async ({ page }) => {
  const { host, errors } = await openPlayer(page);
  const queue = installFakeQueue(host, queueTracks('First', 'Second', 'Third'));
  await host.waitForListener('playback:queueChanged');
  await host.emit('playback:queueChanged', { origin: 'user_added', count: 3 });
  await page.locator('[data-right-card-key="queue"]').click();
  const rows = page.locator('[data-queue-section="queued"] [data-queue-row]');
  await expect(rows).toHaveCount(3);
  await rows.first().click();
  await page.keyboard.press('Control+a');
  await expect(page.locator('[data-queue-section="queued"] [aria-selected="true"]')).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect.poll(() => queue.titles()).toEqual([]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => queue.titles()).toEqual(['First', 'Second', 'Third']);
  expect(errors).toEqual([]);
});

test('接下来全选包含离屏未加载曲目，不带上手动队列', async ({ page }) => {
  const { host, errors } = await openLargeQueue(page, 120);
  installFakeQueue(host, queueTracks('Queued'));
  await host.emit('playback:queueChanged', { origin: 'user_added', count: 1 });
  const queued = page.locator('[data-queue-section="queued"] [data-queue-row]');
  await expect(queued).toHaveCount(1);
  await queued.click();
  await page.keyboard.press('Control+a');
  const next = page.locator('[data-kind="upnext"]').first();
  await next.click();
  await page.keyboard.press('Control+a');
  await expect(queued).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-queue-menu="upnext"] [data-menu-caption]')).toContainText('120');
  await page.getByRole('menuitem', { name: '发送到', exact: true }).hover();
  await page.getByRole('menuitem', { name: '发送到新播放列表', exact: true }).click();
  await expect
    .poll(() => host.callsTo('library.addToPlaylist').at(-1)?.['paths'])
    .toHaveLength(120);
  expect(errors).toEqual([]);
});
