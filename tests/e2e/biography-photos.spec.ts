import { expect, test, type Page } from '@playwright/test';
import { albumsAnswer } from '../fixtures/albumLibrary.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { lastfmCalls } from '../fixtures/musicbrainzSamples.ts';

async function start(page: Page, count = 2) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const player = await openPlayer(page, {
    state: { track: makeTrack({ artist: 'Queen', artists: ['Queen'], title: 'One' }) },
  });
  const pictures = await page.evaluate(() =>
    ['#159c7e', '#e44864'].map((color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 320;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('缺少图像上下文');
      context.fillStyle = color;
      context.fillRect(0, 0, 240, 320);
      return canvas.toDataURL('image/png');
    }),
  );
  const { host } = player;
  host.answer(
    'library.getAlbums',
    albumsAnswer([
      albumRow('Early', 'Queen', { year: '1970', firstTrackAbsolutePath: 'E:\\Early.flac' }),
      ...(count > 1
        ? [
            albumRow('Copy', 'Queen', { year: '1975', firstTrackAbsolutePath: 'E:\\Copy.flac' }),
            albumRow('Later', 'Queen', { year: '1980', firstTrackAbsolutePath: 'E:\\Later.flac' }),
          ]
        : []),
      albumRow('Guest', 'Various Artists', { artist: 'Queen' }),
    ]),
  );
  const picture = (path: unknown) => pictures[String(path).includes('Later') ? 1 : 0] ?? '';
  host.answer('artwork.getForTrack', (params) => ({
    success: true,
    available: true,
    type: 'artist',
    path: String(params['path']),
    dataUrl: picture(params['path']),
  }));
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'artist',
    path: String(params['path']),
    dataUrl: picture(params['path']),
  }));
  await page.reload();
  await page.locator('[data-right-card-key="queue"]').click();
  await page.getByRole('tab', { name: '简介', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开艺人照片' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '正在读取本地照片' })).toHaveCount(0);
  return player;
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme}：关闭在线仍有本地图，去重、键盘换图、焦点返回且不换地点`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const { host, errors } = await start(page);
    const dots = page.locator('[data-biography-photos] button[aria-pressed]');
    await expect(dots).toHaveCount(2);
    await expect(page.getByText('在线简介未开启')).toBeVisible();
    expect(lastfmCalls(host.callsTo('http.get'))).toEqual([]);
    const trigger = page.getByRole('button', { name: '打开艺人照片' });
    await trigger.click();
    const viewer = page.getByRole('dialog', { name: 'Queen' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('本地艺人图片 · Early')).toBeVisible();
    const image = viewer.locator('img').first();
    expect(
      await image.evaluate(
        (element) => element instanceof HTMLImageElement && element.naturalWidth > 0,
      ),
    ).toBe(true);
    await expect(image).toHaveCSS('object-fit', 'contain');
    expect((await viewer.boundingBox())?.y).toBe(48);
    await page.keyboard.press('End');
    await expect(viewer.getByText('本地艺人图片 · Later')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(viewer.getByText('本地艺人图片 · Early')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(viewer.getByText('本地艺人图片 · Later')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(dots.last()).toHaveAttribute('aria-pressed', 'true');
    await trigger.click();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '简介', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(errors).toEqual([]);
  });
}

test('窄窗照片完整显示，缩略条隐藏，焦点不落到遮挡内容', async ({ page }) => {
  await start(page);
  await page.setViewportSize({ width: 390, height: 740 });
  await page.locator('[data-right-card-key="queue"]').click();
  await page.getByRole('tab', { name: '简介', exact: true }).click();
  await page.getByRole('button', { name: '打开艺人照片' }).click();
  const viewer = page.getByRole('dialog', { name: 'Queen' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('button', { name: '照片 1 / 2', exact: true })).toBeHidden();
  await expect(viewer.getByText('照片 1 / 2', { exact: true })).toBeVisible();
  for (let at = 0; at < 10; at += 1) {
    await page.keyboard.press('Tab');
    expect(await viewer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await viewer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect(await viewer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('只有一张时不出切换键，图片失效显示占位，关闭回到照片入口', async ({ page }) => {
  await start(page, 1);
  await expect(page.locator('[data-biography-photos] button[aria-pressed]')).toHaveCount(0);
  await page.getByRole('button', { name: '打开艺人照片' }).click();
  const viewer = page.getByRole('dialog', { name: 'Queen' });
  await expect(viewer.getByRole('button', { name: '下一张照片' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: '上一张照片' })).toHaveCount(0);
  await viewer
    .locator('img')
    .first()
    .evaluate((element) => element.dispatchEvent(new Event('error')));
  await expect(viewer.getByRole('img', { name: '照片加载失败' })).toBeVisible();
  await viewer.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.getByRole('button', { name: '打开艺人照片' })).toBeFocused();
});
