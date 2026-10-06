import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openPlayer } from './playerPage.ts';
import { makeTrack } from './tracks.ts';

export async function openVideo(page: Page, width = 1280, subsong = 0) {
  const media = await readFile(new URL('./video.webm', import.meta.url));
  await page.route('**/video-sample.webm', (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/webm',
      headers: {
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
      },
      body: media.subarray(start, end + 1),
    });
  });
  const fixture = await openPlayer(page, {
    width,
    state: {
      state: 'paused',
      position: 5,
      track: null,
    },
  });
  fixture.state.track = makeTrack({
    title: 'Video sample',
    path: 'E:\\video.webm',
    handle: 'E:\\video.webm',
    subsong,
    duration: 60,
  });
  fixture.host.answer('media.getContainerInfo', {
    success: true,
    recognized: true,
    container: 'webm',
    tracks: [{ id: '1', type: 'video', codec: 'V_VP8', width: 320, height: 180 }],
    attachments: [],
  });
  fixture.host.answer('media.getStreamUrl', {
    success: true,
    url: new URL('/video-sample.webm', page.url()).href,
    mimeType: 'video/webm',
    size: media.length,
  });
  fixture.host.answer('playback.getPosition', () => ({
    success: true,
    position: fixture.state.position,
    duration: 60,
    path: 'E:\\video.webm',
    subsong,
    hostTime: Date.now(),
  }));
  fixture.host.answer('window.isFullscreen', {
    success: true,
    isFullscreen: false,
    fullscreen: false,
    windowId: 'main',
  });
  fixture.host.answer('window.enterFullscreen', { success: true, isFullscreen: true });
  fixture.host.answer('window.exitFullscreen', { success: true, isFullscreen: false });
  await page.reload();
  await expect(page.locator('[data-video-entry]')).toBeVisible();
  await page.locator('[data-video-entry]').click();
  await expect(page.getByRole('region', { name: '视频', exact: true })).toBeVisible();
  return fixture;
}
