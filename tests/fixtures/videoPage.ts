import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openPlayer } from './playerPage.ts';
import { makeTrack } from './tracks.ts';

/** 把夹具里的媒体当作 video-sample.webm 这个地址回出去，认单段 Range；后注册的路由优先 */
export async function routeVideoSample(page: Page, name: string, contentType: string) {
  const media = await readFile(new URL(`./${name}`, import.meta.url));
  await page.route('**/video-sample.webm', (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType,
      headers: {
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
      },
      body: media.subarray(start, end + 1),
    });
  });
  return media.length;
}

interface Chapter {
  readonly start: number;
  readonly end: number;
  readonly subsong: number;
}

export async function openVideo(
  page: Page,
  width = 1280,
  subsong = 0,
  chapters?: readonly Chapter[],
) {
  const size = await routeVideoSample(page, 'video.webm', 'video/webm');
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
    handle: subsong === 0 ? 'E:\\video.webm' : `E:\\video.webm|subsong:${subsong}`,
    subsong,
    duration: 60,
  });
  fixture.host.answer('media.getContainerInfo', {
    success: true,
    recognized: true,
    container: 'webm',
    tracks: [{ id: '1', type: 'video', codec: 'V_VP8', width: 320, height: 180 }],
    attachments: [],
    ...(chapters ? { chapters: [...chapters] } : {}),
  });
  fixture.host.answer('media.getStreamUrl', {
    success: true,
    url: new URL('/video-sample.webm', page.url()).href,
    mimeType: 'video/webm',
    size,
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
