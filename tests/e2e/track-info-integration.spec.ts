import { expect, test, type Page } from '@playwright/test';
import type { Track } from 'foo-webview-sdk';
import { openSongs, SONG_TRACKS } from '../fixtures/songsPage.ts';
import { openPlaylist, albumTracks } from '../fixtures/playlistPage.ts';
import { answerTrackInfo } from '../fixtures/trackInfoAnswers.ts';
import { stringParam } from '../fixtures/hostAnswers.ts';
import type { PageHost } from '../fixtures/pageHost.ts';
import { makeTrack } from '../fixtures/tracks.ts';

function informationAnswers(host: PageHost, tracks: readonly Track[]) {
  answerTrackInfo(host);
  host.answer('metadata.read', (params) => {
    const path = stringParam(params, 'path');
    const track = tracks.find((row) => row.handle === path);
    return {
      success: true,
      path,
      tags: track
        ? {
            TITLE: track.title,
            ARTIST: track.artists,
            ALBUM: track.album,
          }
        : {},
      info: {
        duration: track?.duration ?? 0,
        codec: track?.codec ?? '',
        bitrate: track?.bitrate ?? 0,
        sampleRate: track?.sampleRate ?? 0,
        channels: track?.channels ?? 0,
      },
    };
  });
}

async function showInfo(page: Page) {
  if (!(await page.locator('[data-right-card]').isVisible())) {
    await page.locator('[data-right-card-key="queue"]').click();
  }
  await page.locator('[data-right-card-page="info"]').click();
  await expect(page.locator('[data-track-info]')).toBeVisible();
}

const head = (page: Page) => page.locator('[data-track-info] > div').first();

async function closeInfo(page: Page) {
  await page.getByRole('button', { name: '面板选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '关闭面板', exact: true }).click();
}

test('歌曲单击、键盘与跨页保留，关卡后选择在重新打开时生效；原队列仍跟随播放', async ({ page }) => {
  const playing = makeTrack({ title: '正在播放的曲目', path: 'file://E:/playing.flac' });
  const view = await openSongs(page, {
    configure: (host) => informationAnswers(host, [...SONG_TRACKS, playing]),
  });
  const { host } = view;
  await view.row('Feather').locator('[data-column-id="title"]').click();
  expect(host.callsTo('metadata.read')).toEqual([]);
  await showInfo(page);
  await expect(head(page)).toContainText('Feather');
  await expect(page.getByRole('button', { name: '信息来源' })).toHaveText('正在预览');
  await expect(head(page).locator('img').first()).toBeVisible();
  expect(
    await head(page)
      .locator('img')
      .first()
      .evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await view.row('Angel').locator('[data-column-id="title"]').click();
  await page.keyboard.press('ArrowDown');
  const focused = view.grid.locator('[data-row-focus="true"] [data-column-id="title"]');
  await expect(head(page)).toContainText((await focused.innerText()).trim());
  await view.row('Feather').locator('[data-column-id="title"]').click();
  await host.emit('playback:trackChanged', playing);
  await host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 0,
    duration: playing.duration,
    canSeek: true,
  });
  const nav = page.getByRole('navigation', { name: '侧边栏' });
  await nav.getByRole('button', { name: '专辑', exact: true }).click();
  await expect(head(page)).toContainText('Feather');
  await nav.getByRole('button', { name: '歌曲', exact: true }).click();
  await expect(head(page)).toContainText('Feather');
  await page.getByRole('button', { name: '信息来源' }).click();
  await page.getByRole('menuitemradio', { name: '正在播放', exact: true }).click();
  await expect(head(page)).toContainText('正在播放的曲目');
  await page.getByRole('button', { name: '信息来源' }).click();
  await page.getByRole('menuitemradio', { name: '正在预览', exact: true }).click();
  await expect(head(page)).toContainText('Feather');
  await page.locator('[data-right-card-page="queue"]').click();
  await expect(page.locator('[data-queue-current]')).toContainText('正在播放的曲目');
  const toolbar = page.locator('[data-right-card] > div').first();
  const tabs = page.locator('[data-right-card] [role="tablist"]');
  const more = page.getByRole('button', { name: '面板选项', exact: true });
  const queueToolbar = await toolbar.boundingBox();
  const queueTabs = await tabs.boundingBox();
  const queueMore = await more.boundingBox();
  await page.locator('[data-right-card-page="info"]').click();
  await expect(head(page)).toContainText('Feather');
  expect(await toolbar.boundingBox()).toEqual(queueToolbar);
  expect(await tabs.boundingBox()).toEqual(queueTabs);
  expect(await more.boundingBox()).toEqual(queueMore);
  await expect(toolbar).toHaveCSS('border-bottom-width', '0px');
  await closeInfo(page);
  await expect(page.locator('[data-track-info]')).not.toBeVisible();
  const readCount = host.callsTo('metadata.read').length;
  await view.row('Teardrop').locator('[data-column-id="title"]').click();
  expect(host.callsTo('metadata.read')).toHaveLength(readCount);
  await showInfo(page);
  await expect(head(page)).toContainText('Teardrop');
  expect(host.callsTo('playlist.playTrack')).toEqual([]);
  expect(host.callsTo('playback.play')).toEqual([]);
  expect(view.errors).toEqual([]);
});

test('播放列表定位与组头不覆盖预览，右键选择和分轨身份正确', async ({ page }) => {
  const tracks = albumTracks('Mix', 2, 4);
  const cue = makeTrack({ path: 'file://E:/album.flac', title: '分轨二', subsong: 2 });
  tracks[1] = { ...tracks[1], ...cue, index: 1 };
  const view = await openPlaylist(page, 'Mix', tracks);
  informationAnswers(view.host, tracks);
  await view.row('分轨二').locator('[data-column-id="title"]').click();
  await showInfo(page);
  await expect(head(page)).toContainText('分轨二');
  expect(view.host.callsTo('metadata.read').at(-1)?.['path']).toBe(cue.handle);
  await page.getByRole('button', { name: '文件与位置', exact: true }).click();
  await expect(page.getByText('源文件大小', { exact: true })).toBeVisible();
  expect(view.host.callsTo('file.getInfo').at(-1)?.['path']).toBe(cue.absolutePath);
  const list = view.lists.items.find((item) => item.guid === view.guid);
  if (!list) throw new Error('播放列表缺失');
  view.lists.content.played(list, 5);
  await view.host.emit('playback:trackChanged', tracks[5]);
  await view.host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 0,
    duration: tracks[5].duration,
    canSeek: true,
  });
  await view.grid.focus();
  await page.keyboard.press('F2');
  await expect(view.row('Mix 6')).toHaveAttribute('data-row-focus', 'true');
  await expect(head(page)).toContainText('分轨二');
  await view.group('Album 2 | Artist 2').click();
  await expect(head(page)).toContainText('分轨二');
  await view.row('Mix 3').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(head(page)).toContainText('Mix 3');
  expect(view.host.callsTo('playlist.playTrack')).toEqual([]);
  expect(view.errors).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme}：曲目头部更多与右键复用单曲菜单，保留分轨，换曲关闭旧菜单`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const cue = makeTrack({ path: 'file://E:/album.flac', title: '分轨二', subsong: 2 });
    const tracks = albumTracks('Mix', 1, 3);
    tracks[1] = { ...tracks[1], ...cue, index: 1 };
    const view = await openPlaylist(page, 'Mix', tracks);
    informationAnswers(view.host, tracks);
    await view.row('分轨二').locator('[data-column-id="title"]').click();
    await page.setViewportSize({ width: colorScheme === 'dark' ? 390 : 1280, height: 900 });
    await showInfo(page);
    const header = head(page);
    const more = header.getByRole('button', { name: '曲目选项', exact: true });
    const toggle = header.locator('[data-info-cover-toggle]');
    const arrowBounds = await toggle.boundingBox();
    const moreBounds = await more.boundingBox();
    expect(
      arrowBounds &&
        moreBounds &&
        moreBounds.x === arrowBounds.x &&
        moreBounds.y >= arrowBounds.y + arrowBounds.height,
    ).toBe(true);
    await more.click();
    const menu = page.locator('[data-track-menu]');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('分轨二');
    for (const action of ['play', 'play-next', 'enqueue', 'send-to', 'rating', 'properties'])
      await expect(menu.locator(`[data-action="${action}"]`)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(view.host.callsTo('menu.getContextMenu').at(-1)).toMatchObject({
      mode: 'handles',
      handles: [`${cue.path}|subsong:2`],
    });
    await menu.locator('[data-action="play-next"]').click();
    await expect
      .poll(() => view.host.callsTo('queue.insertNext').at(-1))
      .toMatchObject({
        paths: [`${cue.path}|subsong:2`],
      });
    await header.getByText('分轨二', { exact: true }).click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('分轨二');
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '信息来源' }).click();
    await page.getByRole('menuitemradio', { name: '正在播放', exact: true }).click();
    await view.host.emit('playback:trackChanged', cue);
    await expect(header).toContainText('分轨二');
    await more.click();
    await expect(menu).toBeVisible();
    await view.host.emit('playback:trackChanged', tracks[0]);
    await expect(menu).toHaveCount(0);
    await expect(header).toContainText(tracks[0].title);
    expect(view.host.callsTo('playlist.playTrack')).toEqual([]);
    expect(view.host.callsTo('playback.play')).toEqual([]);
    expect(view.errors).toEqual([]);
  });

  test(`${colorScheme} 窄窗信息浮层与来源菜单可操作，网络流不读文件或封面`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const view = await openSongs(page, {
      configure: (host) => informationAnswers(host, SONG_TRACKS),
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await view.row('Feather').locator('[data-column-id="title"]').click();
    await showInfo(page);
    await expect(head(page)).toContainText('Feather');
    await page.getByRole('button', { name: '信息来源' }).click();
    await page.getByRole('menuitemradio', { name: '正在播放', exact: true }).click();
    await expect(head(page)).toContainText('未选择曲目');
    const reads = view.host.callsTo('metadata.read').length;
    const formats = view.host.callsTo('titleformat.evalFields').length;
    const covers = view.host.callsTo('artwork.getFb2kUrlByPath').length;
    const stream = makeTrack({ path: 'https://radio.example/live', title: '直播' });
    await view.host.emit('playback:trackChanged', stream);
    await expect(head(page)).toContainText('直播');
    await expect(
      page.locator('[data-track-info]').getByText('不适用', { exact: true }).first(),
    ).toBeVisible();
    expect(view.host.callsTo('metadata.read')).toHaveLength(reads);
    // 播放栏会请求 512 像素封面；信息页收起的封面只使用 64 至 128 像素。
    expect(
      view.host
        .callsTo('artwork.getFb2kUrlByPath')
        .slice(covers)
        .filter((call) => call['path'] === stream.handle && Number(call['maxSize']) <= 128),
    ).toEqual([]);
    expect(view.host.callsTo('titleformat.evalFields')).toHaveLength(formats);
    const box = await page.locator('[data-track-info]').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy();
    await closeInfo(page);
    await expect(page.locator('[data-track-info]')).not.toBeVisible();
    expect(view.errors).toEqual([]);
  });
}
