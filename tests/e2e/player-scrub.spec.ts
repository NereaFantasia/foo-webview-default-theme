import { expect, test, type Locator, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 紧凑进度条的命中区不动，显示层轻抬加粗，时间位于两端上方；悬停显示竖条，起拖立即显示目标时间。
// 加粗与模糊的观感由实机判断，几何、操作与取消行为在浏览器核对。

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

test('正在播放条：短悬停轻抬加粗，两端时间在上方，竖条与提示跟随指针；离开收回', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { host, state, errors } = await openPlayer(page);
  const strip = lcd(page);
  const tip = page.getByRole('tooltip');
  await expect(clock(strip, 'position')).toBeHidden();
  const line = await lineCenter(strip);
  const restingTrack = await strip.locator('[data-seek-track]').boundingBox();
  if (!restingTrack) throw new Error('进度线没有显示');
  await page.mouse.move(line.x, line.y);
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  expect(await lineCenter(strip)).toEqual(line);
  await expect
    .poll(async () => (await strip.locator('[data-seek-track]').boundingBox())?.height)
    .toBeCloseTo(6);
  const trackBox = await strip.locator('[data-seek-track]').boundingBox();
  const positionBox = await clock(strip, 'position').boundingBox();
  const durationBox = await clock(strip, 'duration').boundingBox();
  if (!trackBox || !positionBox || !durationBox) throw new Error('时间与轨道没有显示');
  expect(trackBox.y + trackBox.height / 2).toBeCloseTo(
    restingTrack.y + restingTrack.height / 2 - 4,
  );
  expect(positionBox.x).toBeCloseTo(trackBox.x);
  expect(durationBox.x + durationBox.width).toBeCloseTo(trackBox.x + trackBox.width);
  expect(positionBox.y + positionBox.height).toBeLessThan(trackBox.y);
  expect(durationBox.y + durationBox.height).toBeLessThan(trackBox.y);
  await expect(clock(strip, 'position')).toHaveText('0:42');
  await expect(clock(strip, 'duration')).toHaveText('4:00');
  await expect.poll(() => blurred(strip, PLAYING_TRACK.title)).toBe(true);
  await expect.poll(() => blurred(strip, PLAYING_TRACK.artist)).toBe(true);
  expect(await strip.locator('img').evaluate((img) => getComputedStyle(img).filter)).toBe('none');

  // 指针不动也显示预览，时间出现后轨道没有缩短，正中仍是 2:00。
  await expect(tip).toHaveText('2:00');
  const scrubLine = await lineCenter(strip);
  await page.mouse.move(scrubLine.x - scrubLine.width / 4, scrubLine.y);
  await expect(tip).toHaveText('1:00');
  const marker = strip.locator('[data-seek-preview]');
  await expect(marker).toHaveCSS('opacity', '1');
  const markerBox = await marker.boundingBox();
  if (!markerBox) throw new Error('预览竖条没有显示');
  expect(markerBox.x + markerBox.width / 2).toBeCloseTo(scrubLine.x - scrubLine.width / 4);
  expect(markerBox.height).toBeGreaterThan(markerBox.width);

  // 变成不能跳转后显示说明，轨道置灰，预览提示与竖条收起。
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
  await expect(marker).toHaveCSS('opacity', '0');

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

test('细线直接起拖显示目标时间和竖条，命中区不挪位，移出后仍跟手且松手才提交', async ({ page }) => {
  const { calls, errors } = await openPlayer(page);
  const strip = lcd(page);
  const line = await lineCenter(strip);
  await page.mouse.click(line.x - line.width / 4, line.y);
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(60, 0);
  // 点完指针仍在轨道上，保留操作态；点击引起的聚焦不阻止随后收回。
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await page.mouse.move(line.x, 300);
  await expect(strip).toHaveAttribute('data-scrub', 'off');
  await expect(clock(strip, 'position')).toBeHidden();
  expect(await lineCenter(strip)).toEqual(line);

  await page.mouse.move(line.x, line.y);
  await page.mouse.down();
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await page.mouse.move(line.x + 40, line.y, { steps: 4 });
  const target = 120 + (40 / line.width) * 240;
  expect(Number(await seekIn(strip).getAttribute('aria-valuenow'))).toBeCloseTo(target, 0);
  await expect(clock(strip, 'position')).toBeVisible();
  await expect(strip.locator('[data-seek-preview]')).toHaveCSS('opacity', '1');
  expect(calls('playback.setPosition')).toHaveLength(1);
  expect(await lineCenter(strip)).toEqual(line);
  await page.mouse.move(line.x + 40, line.y + 100);
  await expect(strip).toHaveAttribute('data-scrub', 'on');
  await page.mouse.up();
  await expect.poll(() => calls('playback.setPosition').length).toBe(2);
  expect(Number(calls('playback.setPosition')[1]?.['position'])).toBeCloseTo(target, 0);
  await expect(strip).toHaveAttribute('data-scrub', 'off');
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

test('胶囊：深色窄布局轻抬加粗，时间在上方，命中区不扩展到播放按钮', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const { calls, errors } = await openPlayer(page, { width: 900 });
  const pill = capsule(page);
  const line = await lineCenter(pill);
  await page.mouse.move(line.x, line.y);
  await expect(pill).toHaveAttribute('data-scrub', 'on');
  expect(await lineCenter(pill)).toEqual(line);
  await expect(clock(pill, 'position')).toHaveText('0:42');
  await expect.poll(() => blurred(pill, PLAYING_TRACK.title)).toBe(true);
  expect(await pill.locator('img').evaluate((img) => getComputedStyle(img).filter)).toBe('none');

  const positionBox = await clock(pill, 'position').boundingBox();
  const trackBox = await pill.locator('[data-seek-track]').boundingBox();
  if (!positionBox || !trackBox) throw new Error('时间与轨道没有显示');
  expect(positionBox.y + positionBox.height).toBeLessThan(trackBox.y);
  // 移向下一首按钮会离开进度条，等收回后按钮恢复原来的操作。
  const next = await pill.locator('[data-player-key="next"]').boundingBox();
  if (!next) throw new Error('下一首键没画出来');
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
  await expect(pill).toHaveAttribute('data-scrub', 'off');
  await expect.poll(() => blurred(pill, PLAYING_TRACK.title)).toBe(false);
  await pill.locator('[data-player-key="next"]').click();
  await expect.poll(() => calls('playback.next').length).toBe(1);
  expect(calls('playback.setPosition')).toEqual([]);
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
