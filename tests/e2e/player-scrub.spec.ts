import { expect, test, type Locator, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 进度条的悬停态（正在播放条与胶囊）：悬停 300 ms 或键盘聚焦进，线挪到正中、写两端时间、指针处的时间写在提示里，
// 封面以外的东西模糊变淡；离开收回。平时点细线直接跳，在细线上拖不进悬停态；触屏头一下只进悬停态。
// 线挪动的动效与模糊的观感只能实机看。

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

const lcd = (page: Page) => page.locator('[data-now-playing]');
const capsule = (page: Page) => page.locator('[data-player-capsule]');
const seekIn = (scope: Locator) => scope.getByRole('slider', { name: '播放进度' });
const clock = (scope: Locator, which: 'position' | 'duration') =>
  scope.locator(`[data-seek-clock="${which}"]`);

/** 从这段字往上到这一块为止，有没有哪一层带模糊。 */
function blurred(scope: Locator, text: string): Promise<boolean> {
  return scope
    .getByText(text)
    .first()
    .evaluate((element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).filter.includes('blur')) return true;
        if (node.matches('[data-now-playing], [data-player-capsule]')) return false;
      }
      return false;
    });
}

async function lineCenter(scope: Locator): Promise<{ x: number; y: number; width: number }> {
  const box = await seekIn(scope).boundingBox();
  if (!box) throw new Error('进度线没画出来');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
}

test('正在播放条：悬停进度线 300 ms 进悬停态，写两端时间、提示指针处的时间，曲名艺人模糊；离开收回', async ({
  page,
}) => {
  const { host, state, errors } = await openPlayer(page);
  const strip = lcd(page);
  const tip = page.getByRole('tooltip');
  await expect(clock(strip, 'position')).toBeHidden();
  const line = await lineCenter(strip);
  await page.mouse.move(line.x, line.y);
  await page.waitForTimeout(150);
  await expect(strip).not.toHaveAttribute('data-scrub', 'on');
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await expect(clock(strip, 'position')).toHaveText('0:42');
  await expect(clock(strip, 'duration')).toHaveText('4:00');
  await expect.poll(() => blurred(strip, PLAYING_TRACK.title)).toBe(true);
  await expect.poll(() => blurred(strip, PLAYING_TRACK.artist)).toBe(true);
  expect(await strip.locator('img').evaluate((img) => getComputedStyle(img).filter)).toBe('none');

  // 指针没动也出提示。悬停态里两端时间一样宽，这一块的正中就是 2:00；往左挪四分之一线宽是 1:00。
  await expect(tip).toHaveText('2:00');
  const scrubLine = await lineCenter(strip);
  await page.mouse.move(scrubLine.x - scrubLine.width / 4, scrubLine.y);
  await expect(tip).toHaveText('1:00');

  // 这一首变得不能跳转：线换成一句说明，提示跟着收起，不留旧时间。
  state.canSeek = false;
  await host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 42,
    duration: 240,
    canSeek: false,
  });
  await expect(strip).toContainText('此曲目不支持调整播放进度');
  await expect(tip).toBeHidden();

  await page.mouse.move(scrubLine.x, 300);
  await expect(strip).toHaveAttribute('data-scrub', 'off');
  await expect(clock(strip, 'position')).toBeHidden();
  await expect.poll(() => blurred(strip, PLAYING_TRACK.title)).toBe(false);
  expect(errors).toEqual([]);
});

test('用过悬停态之后停止再起播，新挂上的线不再放一次收回的动效', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page);
  const strip = lcd(page);
  const line = await lineCenter(strip);
  await page.mouse.move(line.x, line.y);
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await page.mouse.move(line.x, 300);
  await expect(strip).toHaveAttribute('data-scrub', 'off');

  state.state = 'stopped';
  state.track = null;
  await host.emit('playback:stopped', { reason: 'user' });
  await expect(strip).toHaveCount(0);
  state.state = 'playing';
  state.track = PLAYING_TRACK;
  await host.emit('playback:trackChanged', PLAYING_TRACK);
  await expect(seekIn(strip)).toBeVisible();
  const moving = await seekIn(strip).evaluate(
    (hit) => hit.closest('[data-form]')?.firstElementChild?.getAnimations().length ?? -1,
  );
  expect(moving).toBe(0);
  expect(errors).toEqual([]);
});

test('平时点细线直接跳；按在细线上拖动期间不进悬停态，松手时还在线上就重新计时', async ({
  page,
}) => {
  const { calls, errors } = await openPlayer(page);
  const strip = lcd(page);
  const line = await lineCenter(strip);
  await page.mouse.click(line.x - line.width / 4, line.y);
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(60, 0);
  // 点完指针还停在线上，照常 300 ms 后进悬停态；这一下点击引起的聚焦不按住它。
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await page.mouse.move(line.x, 300);
  await expect(strip).toHaveAttribute('data-scrub', 'off');
  // 线挪回贴底有一段动效，回到原处再按。
  await expect.poll(async () => (await lineCenter(strip)).y).toBeCloseTo(line.y, 0);

  await page.mouse.move(line.x, line.y);
  await page.mouse.down();
  await page.mouse.move(line.x + 40, line.y, { steps: 4 });
  await page.waitForTimeout(450);
  await expect(strip).not.toHaveAttribute('data-scrub', 'on');
  await page.mouse.up();
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  expect(errors).toEqual([]);
});

test('键盘聚焦到进度线直接进悬停态，焦点离开收回', async ({ page }) => {
  const { errors } = await openPlayer(page);
  const strip = lcd(page);
  await page.locator('header [data-player-key="next"]').focus();
  await seekIn(strip).focus();
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await page.locator('header [data-player-key="next"]').focus();
  await expect(strip).toHaveAttribute('data-scrub', 'off');
  expect(errors).toEqual([]);
});

test('网络流：悬停态里只写已播与「直播 · 不能跳转」，不写总长', async ({ page }) => {
  const stream = makeTrack({ path: 'http://radio.example/live', title: 'Live Radio', duration: 0 });
  const { errors } = await openPlayer(page, { state: { track: stream, canSeek: false } });
  const strip = lcd(page);
  const line = await lineCenter(strip);
  await page.mouse.move(line.x, line.y);
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await expect(strip).toContainText('直播 · 不支持调整进度');
  await expect(clock(strip, 'position')).toHaveText('0:42');
  await expect(clock(strip, 'duration')).toHaveText('');
  expect(errors).toEqual([]);
});

test('胶囊：悬停进度线进悬停态，封面以外模糊、键被盖住点不到；离开收回', async ({ page }) => {
  const { calls, errors } = await openPlayer(page, { width: 900 });
  const pill = capsule(page);
  const line = await lineCenter(pill);
  await page.mouse.move(line.x, line.y);
  await expect(pill).toHaveAttribute('data-scrub', 'on');
  await expect(clock(pill, 'position')).toHaveText('0:42');
  await expect.poll(() => blurred(pill, PLAYING_TRACK.title)).toBe(true);
  expect(await pill.locator('img').evaluate((img) => getComputedStyle(img).filter)).toBe('none');

  // 悬停态撑满胶囊（封面除外）：点在下一首键的位置上落到进度线，跳而不切歌。
  const next = await pill.locator('[data-player-key="next"]').boundingBox();
  if (!next) throw new Error('下一首键没画出来');
  await page.mouse.click(next.x + next.width / 2, next.y + next.height / 2);
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(calls('playback.next')).toEqual([]);

  await page.mouse.move(line.x, 20);
  await expect(pill).toHaveAttribute('data-scrub', 'off');
  await expect.poll(() => blurred(pill, PLAYING_TRACK.title)).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('触屏', () => {
  test.use({ hasTouch: true });

  test('头一下只进悬停态、不跳；之后点哪跳哪', async ({ page }) => {
    const { calls, errors } = await openPlayer(page, { width: 900 });
    const pill = capsule(page);
    const line = await lineCenter(pill);
    await page.touchscreen.tap(line.x, line.y);
    await expect(pill).toHaveAttribute('data-scrub', 'on');
    await page.waitForTimeout(200);
    expect(calls('playback.setPosition')).toEqual([]);

    const scrubLine = await lineCenter(pill);
    await page.touchscreen.tap(scrubLine.x - scrubLine.width / 4, scrubLine.y);
    await expect.poll(() => calls('playback.setPosition').length).toBe(1);
    expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(60, -1);
    await expect(pill).toHaveAttribute('data-scrub', 'on');
    expect(errors).toEqual([]);
  });
});
