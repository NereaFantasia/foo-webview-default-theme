import { expect, test, type Locator, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import type { PageHost } from '../fixtures/pageHost.ts';

// 正在播放这一首的星级：底部通栏跟在曲名后面，正在播放条在第二行右端，胶囊跟在曲名后面、≤ 640 不放。
// 评过分的一直在，没评分的指针停在那一块上才出空星；点第 N 颗写 N 星，点当前那颗清零。网络流不画。

const rating = (scope: Locator) => scope.locator('[data-now-playing-rating]');
const star = (scope: Locator, value: string) => rating(scope).getByRole('radio', { name: value });
const bar = (page: Page) => page.locator('[data-player-bar]');

function answerRatingSet(host: PageHost): void {
  host.answer('rating.set', (params) => ({
    success: true,
    path: String(params['path']),
    rating: Number(params['rating']),
    storage: 'file',
  }));
}

test('底部通栏：评过分的星一直在；点第 N 颗写 N 星，点当前那颗清零', async ({ page }) => {
  const { host, calls, errors } = await openPlayer(page, {
    state: { track: { ...PLAYING_TRACK, rating: 3 } },
  });
  answerRatingSet(host);
  await page.mouse.move(640, 300);
  await expect(rating(bar(page))).toBeVisible();
  await expect(star(bar(page), '3')).toBeChecked();

  await star(bar(page), '5').click();
  await expect(star(bar(page), '5')).toBeChecked();
  await star(bar(page), '5').click();
  await expect(star(bar(page), '5')).not.toBeChecked();
  await expect
    .poll(() => calls('rating.set'))
    .toEqual([
      { path: PLAYING_TRACK.path, rating: 5, cueIndex: 0 },
      { path: PLAYING_TRACK.path, rating: 0, cueIndex: 0 },
    ]);
  expect(errors).toEqual([]);
});

test('没评分时空星只在指针停在那一块上、或焦点在里面时才露出来，位置一直占着', async ({ page }) => {
  const { errors } = await openPlayer(page);
  const stars = rating(bar(page));
  const opacity = () => stars.evaluate((element) => getComputedStyle(element).opacity);
  await page.mouse.move(640, 300);
  await expect.poll(opacity).toBe('0');
  const width = await stars.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(0);
  await bar(page).getByText(PLAYING_TRACK.title).first().hover();
  await expect.poll(opacity).toBe('1');
  await page.mouse.move(640, 300);
  await expect.poll(opacity).toBe('0');
  // 藏着的星照样能用键盘走到，焦点一进来就露出来。
  await star(bar(page), '1').focus();
  await expect.poll(opacity).toBe('1');
  expect(errors).toEqual([]);
});

test('双击一颗星只写一次；之后用方向键照样能改', async ({ page }) => {
  const { host, calls, errors } = await openPlayer(page, {
    state: { track: { ...PLAYING_TRACK, rating: 4 } },
  });
  answerRatingSet(host);
  await star(bar(page), '2').dblclick();
  await expect(star(bar(page), '2')).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(star(bar(page), '3')).toBeChecked();
  await expect
    .poll(() => calls('rating.set'))
    .toEqual([
      { path: PLAYING_TRACK.path, rating: 2, cueIndex: 0 },
      { path: PLAYING_TRACK.path, rating: 3, cueIndex: 0 },
    ]);
  expect(errors).toEqual([]);
});

test.describe('放在标题栏', () => {
  test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

  test('正在播放条的星在第二行右端，胶囊的跟在曲名后面，≤ 640 的胶囊不放', async ({ page }) => {
    const { errors } = await openPlayer(page, {
      state: { track: { ...PLAYING_TRACK, rating: 4 } },
    });
    const strip = page.locator('[data-now-playing]');
    await expect(star(strip, '4')).toBeChecked();
    const starsBox = await rating(strip).boundingBox();
    const artistBox = await strip.getByText(PLAYING_TRACK.artist).first().boundingBox();
    if (!starsBox || !artistBox) throw new Error('第二行没画出来');
    expect(
      Math.abs(starsBox.y + starsBox.height / 2 - (artistBox.y + artistBox.height / 2)),
    ).toBeLessThanOrEqual(2);
    expect(starsBox.x).toBeGreaterThan(artistBox.x + artistBox.width);

    await page.setViewportSize({ width: 900, height: 800 });
    const pill = page.locator('[data-player-capsule]');
    await expect(star(pill, '4')).toBeChecked();
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(pill).toBeVisible();
    await expect(rating(pill)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('网络流不能评分，哪一种形态都不画星', async ({ page }) => {
  const stream = makeTrack({ path: 'http://radio.example/live', title: 'Live Radio', duration: 0 });
  const { errors } = await openPlayer(page, { state: { track: stream, canSeek: false } });
  await bar(page).hover();
  await expect(bar(page)).toContainText('Live Radio');
  await expect(rating(bar(page))).toHaveCount(0);
  expect(errors).toEqual([]);
});
