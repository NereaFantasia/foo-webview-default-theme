import { expect, test, type Locator, type Page } from '@playwright/test';
import { openHome } from '../fixtures/homePage.ts';
import { albumsAnswer, allTracksAnswer, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { stringParam } from '../fixtures/hostAnswers.ts';

async function openColoredHome(
  page: Page,
  mode: 'gray' | 'missing' | 'unreadable' | 'delayed' = 'gray',
) {
  const images = await page.evaluate(() =>
    ['#cc2255', '#2255dd', '#808080'].map((color) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建封面');
      context.fillStyle = color;
      context.fillRect(0, 0, 64, 64);
      return canvas.toDataURL();
    }),
  );
  const albums = SAMPLE_ALBUMS.slice(0, 3);
  const analysis: number[] = [];
  let releaseRed = () => {};
  const redReady = new Promise<void>((resolve) => {
    releaseRed = resolve;
  });
  await page.route('**/home-color-*.png', async (route) => {
    const index = Number(/home-color-(\d)/.exec(route.request().url())?.[1]);
    if (route.request().resourceType() === 'fetch') {
      analysis.push(index);
      if (mode === 'delayed' && index === 0) await redReady;
      if (mode === 'unreadable' && index === 2) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: 'invalid image' });
        return;
      }
    }
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(images[index]!.split(',')[1]!, 'base64'),
    });
  });
  const home = await openHome(page, {
    configure(host) {
      host.answer('library.getAlbums', albumsAnswer(albums));
      host.answer('library.getAll', allTracksAnswer(albums));
      host.answer('artwork.getFb2kUrlByPath', (params) => {
        const path = stringParam(params, 'path');
        const index = albums.findIndex((album) => album.firstTrackPath === path);
        return {
          success: true,
          available: !(mode === 'missing' && index === 2),
          type: 'front',
          path,
          dataUrl: `/home-color-${Math.max(0, index)}.png`,
        };
      });
    },
  });
  const section = (name: string) => home.view.getByRole('region', { name, exact: true });
  const card = (name: string, index: number) =>
    section(name).locator('[data-home-album]').nth(index);
  return { ...home, analysis, card, releaseRed };
}

function playOf(card: Locator) {
  return card.getByRole('button', { name: '播放', exact: true });
}

function moreOf(card: Locator) {
  return card.getByRole('button', { name: '更多', exact: true });
}

function playColor(button: Locator) {
  return button.evaluate((node) => node.style.getPropertyValue('--play-button-bg'));
}

function brandColor(button: Locator) {
  return button.evaluate((node) =>
    getComputedStyle(node).getPropertyValue('--colorBrandBackground'),
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`首页三个专辑区的局部取色与全局隔离 ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const { view, card, analysis, errors } = await openColoredHome(page);
    const shuffle = view.getByRole('button', { name: '全库随机', exact: true });
    const basePlay = await playColor(shuffle);
    const baseBrand = await brandColor(shuffle);
    expect(analysis).toEqual([]);
    for (const section of ['探索音乐', '最近添加', '最近听过']) {
      const red = card(section, 0);
      const blue = card(section, 1);
      await red.hover();
      await expect.poll(() => playColor(playOf(red))).not.toBe(basePlay);
      await expect.poll(() => brandColor(moreOf(red))).not.toBe(baseBrand);
      const redPlay = await playColor(playOf(red));
      const redBrand = await brandColor(moreOf(red));
      expect(await playColor(playOf(blue))).toBe(basePlay);
      await blue.hover();
      await expect.poll(() => playColor(playOf(blue))).not.toBe(basePlay);
      expect(await playColor(playOf(blue))).not.toBe(redPlay);
      expect(await brandColor(moreOf(blue))).not.toBe(redBrand);
      await expect.poll(() => playColor(playOf(red))).toBe(basePlay);
      expect(await playColor(shuffle)).toBe(basePlay);
      expect(await brandColor(shuffle)).toBe(baseBrand);
    }
    expect(errors).toEqual([]);
  });
}

test('键盘焦点与菜单保持当前卡片取色，关闭后正确释放', async ({ page }) => {
  const { view, card } = await openColoredHome(page);
  const red = card('探索音乐', 0);
  const duplicate = card('最近添加', 0);
  const shuffle = view.getByRole('button', { name: '全库随机', exact: true });
  const base = await playColor(shuffle);
  await page.mouse.move(0, 0);
  await red.getByRole('button', { name: 'Abbey Road', exact: true }).first().focus();
  await page.keyboard.press('Tab');
  await expect(playOf(red)).toBeFocused();
  await expect.poll(() => playColor(playOf(red))).not.toBe(base);
  const color = await playColor(playOf(red));
  const brand = await brandColor(moreOf(red));
  await page.keyboard.press('Tab');
  await expect(moreOf(red)).toBeFocused();
  expect(await playColor(playOf(red))).toBe(color);
  await page.keyboard.press('Enter');
  const menu = page.locator('[data-album-menu]');
  await expect(menu).toBeVisible();
  await expect.poll(() => brandColor(menu)).toBe(brand);
  expect(await playColor(playOf(red))).toBe(color);
  expect(await playColor(playOf(duplicate))).toBe(base);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(moreOf(red)).toBeFocused();
  expect(await playColor(playOf(red))).toBe(color);
  await shuffle.focus();
  await expect.poll(() => playColor(playOf(red))).toBe(base);
});

for (const mode of ['gray', 'missing', 'unreadable'] as const) {
  test(`灰图、缺图与分析失败不借用上一张的颜色 ${mode}`, async ({ page }) => {
    const { view, card, analysis } = await openColoredHome(page, mode);
    const base = await playColor(view.getByRole('button', { name: '全库随机', exact: true }));
    await card('探索音乐', 0).hover();
    await expect.poll(() => playColor(playOf(card('探索音乐', 0)))).not.toBe(base);
    const fallback = card('探索音乐', 2);
    await fallback.hover();
    if (mode !== 'missing') {
      await expect.poll(() => analysis.includes(2)).toBe(true);
      await page.evaluate(async () => {
        const url = '/src/covers/coverAnalysis.ts';
        const { coverAnalysis }: typeof import('../../src/covers/coverAnalysis.ts') = await import(
          url
        );
        await coverAnalysis.read('/home-color-2.png').catch(() => null);
      });
    }
    await expect.poll(() => playColor(playOf(fallback))).toBe(base);
    await expect.poll(() => playColor(playOf(card('探索音乐', 0)))).toBe(base);
    await expect(view.getByRole('button', { name: '全库随机', exact: true })).toBeEnabled();
  });
}

test('快速划过时迟到分析不染回旧卡片，也不覆盖新卡片', async ({ page }) => {
  const { view, card, analysis, releaseRed } = await openColoredHome(page, 'delayed');
  const base = await playColor(view.getByRole('button', { name: '全库随机', exact: true }));
  const red = card('探索音乐', 0);
  const blue = card('探索音乐', 1);
  try {
    await red.hover();
    await expect.poll(() => analysis.includes(0)).toBe(true);
    await blue.hover();
    expect(await playColor(playOf(red))).toBe(base);
  } finally {
    releaseRed();
  }
  await expect.poll(() => playColor(playOf(blue))).not.toBe(base);
  const blueColor = await playColor(playOf(blue));
  expect(await playColor(playOf(red))).toBe(base);
  await red.hover();
  await expect.poll(() => playColor(playOf(red))).not.toBe(base);
  expect(await playColor(playOf(red))).not.toBe(blueColor);
  await expect.poll(() => playColor(playOf(blue))).toBe(base);
});
