import { expect, test, type Page } from '@playwright/test';
import { boxOf, choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';

// 播放栏放在标题栏时，窄窗（< 1008）的胶囊：四个宽度下标题栏与胶囊的形态、键的去留；胶囊里的键与进度；
// 音量浮层；卡片给页面的 --player-inset；跨过 1008 时焦点跟到另一套里同名的件上；停止时收掉。观感只能实机看。

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

const capsule = (page: Page) => page.locator('[data-player-capsule]');
const capsuleKey = (page: Page, name: string) =>
  capsule(page).locator(`[data-player-key="${name}"]`);
const headerKey = (page: Page, name: string) => page.locator(`header [data-player-key="${name}"]`);
const keysIn = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-player-key]`)
    .evaluateAll((keys) => keys.map((key) => key.getAttribute('data-player-key')));

// 进度线也是一个件，排在最后。
for (const [width, keys] of [
  [1000, ['cover', 'order', 'previous', 'play', 'next', 'volume', 'more', 'seek']],
  [900, ['cover', 'order', 'previous', 'play', 'next', 'volume', 'more', 'seek']],
  [640, ['cover', 'previous', 'play', 'next', 'more', 'seek']],
  [390, ['cover', 'previous', 'play', 'next', 'more', 'seek']],
] as const) {
  test(`${width} 宽：标题栏 48 高、只有 ⋯ 与三键，胶囊高 64、离卡底 16、在卡片里水平居中`, async ({
    page,
  }) => {
    const { errors } = await openPlayer(page, { width });
    expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
    expect(await keysIn(page, 'header')).toEqual([]);
    await expect(page.locator('header [data-now-playing]')).toHaveCount(0);
    expect(await keysIn(page, '[data-player-capsule]')).toEqual(keys);

    const card = await boxOf(page, '[data-capsule]');
    const pill = await boxOf(page, '[data-player-capsule]');
    // 卡片有 1 像素的描边，胶囊按描边内侧定位。
    const inner = card.width - 2;
    expect(pill.height).toBe(64);
    expect(card.y + card.height - 1 - (pill.y + pill.height)).toBe(16);
    expect(Math.abs(pill.x + pill.width / 2 - (card.x + card.width / 2))).toBeLessThanOrEqual(1);
    expect(pill.width).toBe(width <= 640 ? inner - 32 : Math.min(600, inner - 32));
    expect(await boxOf(page, '[data-player-capsule] img')).toMatchObject({ width: 48, height: 48 });
    expect(errors).toEqual([]);
  });
}

test('胶囊的键调到与宽窗相同的命令；进度线跟着宿主的进度，点细线直接跳', async ({ page }) => {
  const { host, state, calls, errors } = await openPlayer(page, { width: 900 });
  await capsuleKey(page, 'previous').click();
  await expect.poll(() => calls('playback.previous').length).toBe(1);
  await capsuleKey(page, 'next').click();
  await expect.poll(() => calls('playback.next').length).toBe(1);
  await expect(capsuleKey(page, 'play')).toHaveAccessibleName('暂停');
  state.state = 'paused';
  await capsuleKey(page, 'play').click();
  await expect(capsuleKey(page, 'play')).toHaveAccessibleName('播放');
  await expect(capsuleKey(page, 'order')).toHaveAccessibleName('播放顺序：默认');

  const fill = capsule(page).locator('[style*="scaleX"]');
  await expect(fill).toHaveAttribute('style', /scaleX\(0\.175\)/);
  await host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 120 });
  await expect(fill).toHaveAttribute('style', /scaleX\(0\.5\)/);
  const box = await capsule(page).getByRole('slider', { name: '播放进度' }).boundingBox();
  if (!box) throw new Error('进度线没画出来');
  await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2);
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(60, 0);
  expect(errors).toEqual([]);
});

test('胶囊形态的宽窗：宽 680；封面离外缘 8，键组离右缘 14，进度线离外缘左 64、右 32、下 3', async ({
  page,
}) => {
  await choosePlayerBar(page, 'capsule');
  const { errors } = await openPlayer(page);
  const pill = await boxOf(page, '[data-player-capsule]');
  expect(pill).toMatchObject({ width: 680, height: 64 });
  const cover = await boxOf(page, '[data-player-capsule] img');
  expect(cover.x - pill.x).toBe(8);
  const menu = await boxOf(page, '[data-player-capsule] [data-player-key="more"]');
  expect(pill.x + pill.width - (menu.x + menu.width)).toBe(14);
  const line = await capsule(page)
    .locator('[style*="scaleX"]')
    .evaluate((fill) => {
      const box = (fill.parentElement ?? fill).getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
      };
    });
  expect(line.left - pill.x).toBe(64);
  expect(pill.x + pill.width - line.right).toBe(32);
  expect(pill.y + pill.height - line.bottom).toBe(3);
  expect(errors).toEqual([]);
});

test('胶囊的音量键点开朝上的浮层：静音键、滑条与数值；方向键调音量，Esc 收起、焦点回到音量键', async ({
  page,
}) => {
  const { calls, errors } = await openPlayer(page, { width: 900 });
  const volumeKey = capsuleKey(page, 'volume');
  await volumeKey.click();
  const popover = page.locator('[data-volume-popover]');
  await expect(popover).toBeVisible();
  // 入场动效带一段位移，播完再量。
  await popover.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  const keyBox = await boxOf(page, '[data-player-capsule] [data-player-key="volume"]');
  const popBox = await boxOf(page, '[data-volume-popover]');
  expect(popBox.y + popBox.height).toBeLessThanOrEqual(keyBox.y);
  await expect(popover.getByRole('button', { name: '静音' })).toBeVisible();
  const slider = popover.getByRole('slider', { name: '音量' });
  const value = await slider.getAttribute('aria-valuenow');
  await expect(popover).toContainText(value ?? '');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => calls('playback.setVolume').length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(volumeKey).toBeFocused();

  await volumeKey.hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => calls('playback.setVolume').length).toBe(2);
  expect(errors).toEqual([]);
});

test('卡片按有没有胶囊给出 --player-inset：宽窗 0，窄窗是胶囊高 64 加离底 16', async ({ page }) => {
  const { errors } = await openPlayer(page);
  const card = page.locator('[data-with-nav-row]');
  // 放一个高为 --player-inset 的探针量出来，不认计算值的写法。
  const inset = () =>
    card.evaluate((element) => {
      const probe = document.createElement('div');
      probe.style.height = 'var(--player-inset)';
      element.append(probe);
      const { height } = probe.getBoundingClientRect();
      probe.remove();
      return height;
    });
  await expect(card).not.toHaveAttribute('data-capsule');
  expect(await inset()).toBe(0);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(capsule(page)).toBeVisible();
  await expect(card).toHaveAttribute('data-capsule');
  expect(await inset()).toBe(80);
  expect(errors).toEqual([]);
});

test('跨过 1008 时焦点跟到另一套里同名的件上；对面没有的件落在播放键上', async ({ page }) => {
  const { errors } = await openPlayer(page);
  await headerKey(page, 'next').focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(capsuleKey(page, 'next')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(headerKey(page, 'next')).toBeFocused();

  await page.getByRole('slider', { name: '播放进度' }).focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(capsuleKey(page, 'seek')).toBeFocused();

  await capsuleKey(page, 'volume').focus();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(capsuleKey(page, 'play')).toBeFocused();
  expect(errors).toEqual([]);
});

test('减弱动效下胶囊的文字只截断、不滚动；放得下的不渐隐', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const long = 'RAVE LAUNCHER MK.II (Extended Mix) with a Title Far Too Long to Fit';
  const { host, state, errors } = await openPlayer(page, {
    width: 390,
    state: { track: { ...PLAYING_TRACK, title: long } },
  });
  // 渐隐挂在以文字自己的滚动为时间线的动画上，不算动效；按时间走的动画（滚动一遍之类）一条都不该有。
  const styleOf = (text: string) =>
    capsule(page)
      .locator('span')
      .filter({ hasText: text })
      .first()
      .evaluate((element) => ({
        overflow: getComputedStyle(element).overflow,
        mask: getComputedStyle(element).maskImage,
        timed: element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.timeline instanceof DocumentTimeline).length,
      }));
  const truncated = await styleOf(long);
  expect(truncated).toMatchObject({ overflow: 'hidden', timed: 0 });
  expect(truncated.mask).toContain('linear-gradient');

  const short = { ...PLAYING_TRACK, path: 'file://E:/Music/short.flac', title: 'Short' };
  state.track = short;
  await host.emit('playback:trackChanged', short);
  await expect(capsule(page)).toContainText('Short');
  expect(await styleOf('Short')).toMatchObject({ mask: 'none', timed: 0 });
  expect(errors).toEqual([]);
});

test('停止时胶囊收掉、卡片不再让位，焦点在胶囊里的落到 ⋯；再起播时胶囊回来', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const { host, state, errors } = await openPlayer(page);
  await expect(page.locator('[data-capsule]')).toHaveCount(1);
  await capsuleKey(page, 'cover').focus();
  state.state = 'stopped';
  state.track = null;
  await host.emit('playback:stopped', { reason: 'user' });
  await expect(capsule(page)).toHaveCount(0);
  await expect(page.locator('[data-capsule]')).toHaveCount(0);
  await expect(page.locator('header [data-menu="main"]')).toBeFocused();

  state.state = 'playing';
  state.track = PLAYING_TRACK;
  await host.emit('playback:trackChanged', PLAYING_TRACK);
  await expect(capsule(page)).toContainText(PLAYING_TRACK.title);
  await expect(page.locator('[data-capsule]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
