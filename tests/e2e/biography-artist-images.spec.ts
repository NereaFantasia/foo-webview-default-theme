import { expect, test, type Page } from '@playwright/test';
import { albumsAnswer } from '../fixtures/albumLibrary.ts';
import { biographyHtml, biographyOverviewHtml } from '../fixtures/biographySamples.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { withoutMusicbrainz } from '../fixtures/musicbrainzSamples.ts';
import {
  confirmBiographyExternal,
  expandBiographyArticle,
  openBiographyLink,
  openBiographySettings,
} from '../fixtures/biographyActions.ts';

const panel = (page: Page) => page.locator('[data-biography]');

async function start(page: Page, width: number) {
  const env = await openPlayer(page, {
    width,
    state: { track: makeTrack({ artist: 'Queen', artists: ['Queen'] }) },
  });
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('缺少图像上下文');
    context.fillStyle = '#159c7e';
    context.fillRect(0, 0, 32, 64);
    context.fillStyle = '#e44864';
    context.fillRect(32, 0, 32, 64);
    return canvas.toDataURL('image/png');
  });
  env.host.answer(
    'library.getAlbums',
    albumsAnswer([
      albumRow('Early', 'David Bowie', { year: '1970', firstTrackAbsolutePath: 'E:\\Early.flac' }),
      albumRow('Later', 'David Bowie', { year: '1980', firstTrackAbsolutePath: 'E:\\Later.flac' }),
      albumRow('Guest', 'Various Artists', {
        artist: 'The Beatles',
        firstTrackAbsolutePath: 'E:\\Guest.flac',
      }),
    ]),
  );
  env.host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: String(params['type']),
    path: String(params['path']),
    dataUrl: params['path'] === 'E:\\Later.flac' ? picture : 'data:image/png;base64,broken',
  }));
  env.host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  env.host.answer(
    'http.get',
    withoutMusicbrainz((params) => ({
      success: true,
      status: 200,
      headers: {},
      body: String(params['url']).endsWith('/+wiki') ? biographyHtml() : biographyOverviewHtml(),
    })),
  );
  await page.reload();
  await page.locator('[data-right-card-key="queue"]').click();
  await page.getByRole('tab', { name: '简介', exact: true }).click();
  await openBiographySettings(page);
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  if (width < 1008) {
    await page.locator('[data-right-card-key="queue"]').click();
    await page.getByRole('tab', { name: '简介', exact: true }).click();
  }
  await openBiographyLink(page);
  await panel(page).getByRole('button', { name: '确认艺人', exact: true }).click();
  await expect(panel(page).getByText('第一段简介。', { exact: true })).toBeVisible();
  await expandBiographyArticle(page);
  return env;
}

for (const [colorScheme, width] of [
  ['dark', 1280],
  ['light', 390],
] as const) {
  test(`${colorScheme} ${width}：相似艺人显示本地小头像，缺图和客串不补位，外链仍走 SDK`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const env = await start(page, width);
    const bowie = panel(page).getByRole('button', { name: 'David Bowie · Last.fm' });
    const image = bowie.locator('img');
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(
        (element) =>
          element instanceof HTMLImageElement && element.complete && element.naturalWidth === 64,
      ),
    ).toBe(true);
    expect((await image.boundingBox())?.width).toBe(20);
    expect((await image.boundingBox())?.height).toBe(20);
    await expect(image).toHaveCSS('object-fit', 'cover');
    await expect(
      panel(page).getByRole('button', { name: 'The Beatles · Last.fm' }).locator('img'),
    ).toHaveCount(0);
    expect(
      env.host.callsTo('artwork.getFb2kUrlByPath').filter((call) => call['type'] === 'artist'),
    ).toEqual([
      { path: 'E:\\Early.flac', type: 'artist', maxSize: 64 },
      { path: 'E:\\Later.flac', type: 'artist', maxSize: 64 },
    ]);
    env.host.answer('shell.openExternal', { success: true });
    await bowie.click();
    await confirmBiographyExternal(page);
    await expect
      .poll(() => env.host.callsTo('shell.openExternal').at(-1)?.['url'])
      .toBe('https://www.last.fm/zh/music/David%20Bowie');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(env.errors).toEqual([]);
  });
}

test('头像失效退回文字，刷新恢复，关闭在线后不继续读相似艺人照片', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await start(page, 1280);
  const bowie = panel(page).getByRole('button', { name: 'David Bowie · Last.fm' });
  await expect(bowie.locator('img')).toBeVisible();
  await bowie.locator('img').evaluate((element) => element.dispatchEvent(new Event('error')));
  await expect(bowie.locator('img')).toHaveCount(0);
  await expect(bowie).toBeVisible();
  await panel(page).getByRole('button', { name: '刷新简介' }).click();
  await expect(bowie.locator('img')).toBeVisible();
  await page.getByRole('switch', { name: '在线艺人简介' }).uncheck();
  await expect(bowie).toHaveCount(0);
  const reads = env.host
    .callsTo('artwork.getFb2kUrlByPath')
    .filter((call) => call['type'] === 'artist').length;
  env.host.emit('library:itemsModified', { count: 1, timestamp: Date.now() });
  await page.waitForTimeout(1500);
  expect(
    env.host.callsTo('artwork.getFb2kUrlByPath').filter((call) => call['type'] === 'artist'),
  ).toHaveLength(reads);
  expect(env.errors).toEqual([]);
});
