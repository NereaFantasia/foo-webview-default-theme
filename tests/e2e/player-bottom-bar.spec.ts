import { expect, test, type Page } from '@playwright/test';
import { VOLUME_MEMORY_MS } from '../../src/shell/player/volume/volumeControl.ts';
import { positionOf } from '../../src/playback/volumeScale.ts';
import { boxOf, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';

// 底部通栏（播放栏的缺省形态）：标题栏只剩 ⋯ 与三键；通栏横在窗口最下面，上一行时间与进度线，下一行
// 封面与曲名、居中的控制组、右边的几个键；按宽度收键；停止时整条收掉。观感只能实机看。

const bar = (page: Page) => page.locator('[data-player-bar]');
const barKey = (page: Page, name: string) => bar(page).locator(`[data-player-key="${name}"]`);
const keysIn = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-player-key]`)
    .evaluateAll((keys) => keys.map((key) => key.getAttribute('data-player-key')));
const slider = (page: Page) => bar(page).getByRole('slider', { name: '播放进度' });

test('缺省是底部通栏：标题栏 48 高、没有播放的件，通栏 88 高、贴着窗口底边铺满整宽', async ({
  page,
}) => {
  const { errors } = await openPlayer(page);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
  expect(await keysIn(page, 'header')).toEqual([]);
  await expect(page.locator('[data-now-playing]')).toHaveCount(0);
  await expect(page.locator('[data-player-capsule]')).toHaveCount(0);
  expect(await boxOf(page, '[data-player-bar]')).toEqual({
    x: 0,
    y: 800 - 88,
    width: 1280,
    height: 88,
  });
  // 侧边栏与内容区都止于通栏的上沿。
  const main = await boxOf(page, 'main');
  expect(main.y + main.height).toBe(800 - 88);
  const aside = await boxOf(page, 'aside');
  expect(aside.y + aside.height).toBe(800 - 88);
  expect(await keysIn(page, '[data-player-bar]')).toEqual([
    'seek',
    'cover',
    'order',
    'previous',
    'play',
    'next',
    'output',
    'mute',
    'volume-slider',
    'mini',
    'immersive',
  ]);
  expect(errors).toEqual([]);
});

test('控制组在窗口正中，播放键 40 见方；封面 48、曲名与艺人在左边', async ({ page }) => {
  const { errors } = await openPlayer(page);
  const group = await boxOf(page, '[data-player-bar] [role="group"][aria-label="播放控制"]');
  expect(Math.abs(group.x + group.width / 2 - 640)).toBeLessThanOrEqual(1);
  expect(await boxOf(page, '[data-player-bar] [data-player-key="play"]')).toMatchObject({
    width: 40,
    height: 40,
  });
  expect(await boxOf(page, '[data-player-bar] img')).toMatchObject({
    x: 16,
    width: 48,
    height: 48,
  });
  await expect(bar(page)).toContainText(PLAYING_TRACK.title);
  await expect(bar(page)).toContainText(PLAYING_TRACK.artist);
  expect(errors).toEqual([]);
});

test('键调到对应的命令，播放键的名字跟着宿主报的状态', async ({ page }) => {
  const { host, state, calls, errors } = await openPlayer(page);
  await expect(barKey(page, 'play')).toHaveAccessibleName('暂停');
  await barKey(page, 'previous').click();
  await expect.poll(() => calls('playback.previous').length).toBe(1);
  await barKey(page, 'next').click();
  await expect.poll(() => calls('playback.next').length).toBe(1);
  state.state = 'paused';
  await barKey(page, 'play').click();
  await expect.poll(() => calls('playback.playOrPause').length).toBe(1);
  await expect(barKey(page, 'play')).toHaveAccessibleName('播放');
  state.state = 'playing';
  await host.emit('playback:paused', { paused: false });
  await expect(barKey(page, 'play')).toHaveAccessibleName('暂停');
  await barKey(page, 'mute').click();
  await expect.poll(() => calls('playback.toggleMute').length).toBe(1);
  await expect(barKey(page, 'output')).toBeEnabled();
  await expect(barKey(page, 'output')).toHaveAccessibleName('输出设备');
  await expect(barKey(page, 'mini')).toBeEnabled();
  await expect(barKey(page, 'mini')).toHaveAccessibleName('迷你播放器');
  expect(errors).toEqual([]);
});

test('进度线两头写播到的时间与总长；点哪跳哪，时间先写点到的位置，再跟着宿主报的进度', async ({
  page,
}) => {
  const { host, calls, errors } = await openPlayer(page);
  const clocks = bar(page).locator('[data-seek-clock]');
  await expect(clocks).toHaveText(['0:42', '4:00']);
  const box = await slider(page).boundingBox();
  if (!box) throw new Error('进度线没画出来');
  await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2);
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(60, 0);
  await expect(clocks.first()).toHaveText('1:00');
  await host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 125 });
  await expect(clocks.first()).toHaveText('2:05');
  expect(errors).toEqual([]);
});

test('没有时长的流：不写总长、不画滑块；左边的时间进位时线不挪位', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page, {
    state: { track: { ...PLAYING_TRACK, duration: 0 }, canSeek: false },
  });
  const clocks = bar(page).locator('[data-seek-clock]');
  await expect(clocks).toHaveText(['0:42', '']);
  const long = { ...PLAYING_TRACK, path: 'file://E:/Music/long.flac', duration: 720 };
  state.track = long;
  state.canSeek = true;
  state.position = 599;
  await host.emit('playback:trackChanged', long);
  await expect(clocks).toHaveText(['9:59', '12:00']);
  const before = await slider(page).boundingBox();
  await host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 600 });
  await expect(clocks.first()).toHaveText('10:00');
  expect(await slider(page).boundingBox()).toEqual(before);
  expect(errors).toEqual([]);
});

test('通栏里的顺序键开同一份七选一菜单，选中按名字发命令', async ({ page }) => {
  const { calls, errors } = await openPlayer(page);
  await barKey(page, 'order').click();
  const menu = page.getByRole('menu', { name: '播放顺序' });
  await expect(menu.getByRole('menuitemradio')).toHaveCount(7);
  await menu.getByRole('menuitemradio', { name: '随机' }).click();
  await expect.poll(() => calls('playback.setPlaybackOrder')).toEqual([{ name: 'random' }]);
  expect(errors).toEqual([]);
});

for (const [width, keys] of [
  [900, ['seek', 'cover', 'order', 'previous', 'play', 'next', 'volume']],
  [390, ['seek', 'cover', 'previous', 'play', 'next', 'volume']],
] as const) {
  test(`${width} 宽：通栏照样在底部，按宽度收键，卡片不给胶囊让位`, async ({ page }) => {
    const { errors } = await openPlayer(page, { width });
    expect(await boxOf(page, '[data-player-bar]')).toMatchObject({
      y: 800 - 88,
      width,
      height: 88,
    });
    expect(await keysIn(page, '[data-player-bar]')).toEqual(keys);
    await expect(page.locator('[data-capsule]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('窄窗的音量键点开朝上的音量浮层', async ({ page }) => {
  const { calls, errors } = await openPlayer(page, { width: 900 });
  const volumeKey = barKey(page, 'volume');
  await volumeKey.click();
  const popover = page.locator('[data-volume-popover]');
  await expect(popover).toBeVisible();
  await popover.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  const keyBox = await boxOf(page, '[data-player-bar] [data-player-key="volume"]');
  const popBox = await boxOf(page, '[data-volume-popover]');
  expect(popBox.y + popBox.height).toBeLessThanOrEqual(keyBox.y);
  await popover.getByRole('button', { name: '静音' }).click();
  await expect.poll(() => calls('playback.toggleMute').length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(volumeKey).toBeFocused();
  expect(errors).toEqual([]);
});

test('音量的提示写数值：宽窗悬停音量条出当前值，滚轮时跟着调到的值；窄窗的音量键同样', async ({
  page,
}) => {
  const { calls, errors } = await openPlayer(page);
  const tooltip = page.getByRole('tooltip');
  const now = Math.round(positionOf(-20, 'perceptual'));
  await barKey(page, 'volume-slider').hover();
  await expect(tooltip).toHaveText(String(now));
  await page.mouse.wheel(0, -100);
  await expect.poll(() => calls('playback.setVolume').length).toBe(1);
  await expect(tooltip).toHaveText(String(now + 1));

  // 宿主的音量没动，隔过「连着滚」的记忆再到窄窗的音量键上：先写宿主报的值，往下滚一格写调到的值。
  await page.waitForTimeout(VOLUME_MEMORY_MS + 100);
  await page.setViewportSize({ width: 900, height: 800 });
  await barKey(page, 'volume').hover();
  await expect(tooltip).toHaveText(String(now));
  await page.mouse.wheel(0, 100);
  await expect.poll(() => calls('playback.setVolume').length).toBe(2);
  await expect(tooltip).toHaveText(String(now - 1));
  expect(errors).toEqual([]);
});

test('曲名与艺人放得下时不渐隐，只有真截断了才在右缘渐隐', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page);
  const maskOf = (text: string) =>
    bar(page)
      .locator('span')
      .filter({ hasText: text })
      .first()
      .evaluate((element) => getComputedStyle(element).maskImage);
  // 通栏左边一列有 500 多宽，这两行都放得下：字盒与字一样宽，末尾不该被淡掉。
  expect(await maskOf(PLAYING_TRACK.title)).toBe('none');
  expect(await maskOf(PLAYING_TRACK.artist)).toBe('none');

  const long = { ...PLAYING_TRACK, title: 'RAVE LAUNCHER MK.II '.repeat(8).trim() };
  state.track = long;
  await host.emit('playback:edited', long);
  await expect(bar(page)).toContainText('RAVE LAUNCHER MK.II');
  expect(await maskOf('RAVE LAUNCHER MK.II')).toContain('linear-gradient');
  expect(await maskOf(PLAYING_TRACK.artist)).toBe('none');
  expect(errors).toEqual([]);
});

test('停止时整条收掉，侧边栏与内容区伸到窗口底边；再起播时通栏回来', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page);
  state.state = 'stopped';
  state.track = null;
  await host.emit('playback:stopped', { reason: 'user' });
  await expect(bar(page)).toHaveCount(0);
  const main = await boxOf(page, 'main');
  expect(main.y + main.height).toBe(800);
  const aside = await boxOf(page, 'aside');
  expect(aside.y + aside.height).toBe(800);

  state.state = 'playing';
  state.track = PLAYING_TRACK;
  await host.emit('playback:trackChanged', PLAYING_TRACK);
  await expect(bar(page)).toContainText(PLAYING_TRACK.title);
  expect(await boxOf(page, '[data-player-bar]')).toMatchObject({ y: 800 - 88, height: 88 });
  expect(errors).toEqual([]);
});

test('没有当前曲目时启动：不出通栏，标题栏照旧只有 ⋯ 与导航键', async ({ page }) => {
  const { errors } = await openPlayer(page, { state: { state: 'stopped', track: null } });
  await expect(page.locator('[data-nav="back"]')).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  expect(await keysIn(page, 'header')).toEqual([]);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
  expect(errors).toEqual([]);
});

test('跨档时焦点跟到功能相同的件上：音量滑条与音量键互认，别的卸下的键落在播放键', async ({
  page,
}) => {
  const { errors } = await openPlayer(page);
  await barKey(page, 'volume-slider').focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(barKey(page, 'volume')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(barKey(page, 'volume-slider')).toBeFocused();

  // 沉浸键收掉时，进沉浸视图的还有封面。
  await barKey(page, 'immersive').focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(barKey(page, 'cover')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });

  await barKey(page, 'mini').focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(barKey(page, 'play')).toBeFocused();
  await page.setViewportSize({ width: 900, height: 800 });
  await barKey(page, 'order').focus();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(barKey(page, 'play')).toBeFocused();
  expect(errors).toEqual([]);
});

test('浮层开着时跨档：焦点从浮层跟到宽窗的同名件上', async ({ page }) => {
  const { errors } = await openPlayer(page, { width: 900 });
  await barKey(page, 'volume').click();
  const popover = page.locator('[data-volume-popover]');
  await expect(popover.getByRole('button', { name: '静音' })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(popover).toHaveCount(0);
  await expect(barKey(page, 'mute')).toBeFocused();

  await page.setViewportSize({ width: 900, height: 800 });
  await barKey(page, 'order').click();
  await expect(page.getByRole('menuitemradio').first()).toBeFocused();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(barKey(page, 'play')).toBeFocused();
  expect(errors).toEqual([]);
});

test('焦点在通栏里时播放停止，通栏收掉、焦点落在标题栏的 ⋯', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page);
  for (const name of ['seek', 'cover']) {
    state.state = 'playing';
    state.track = PLAYING_TRACK;
    await host.emit('playback:trackChanged', PLAYING_TRACK);
    await barKey(page, name).focus();
    state.state = 'stopped';
    state.track = null;
    await host.emit('playback:stopped', { reason: 'user' });
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator('header [data-menu="main"]')).toBeFocused();
  }
  expect(errors).toEqual([]);
});
