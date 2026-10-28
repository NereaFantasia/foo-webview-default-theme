import { expect, test, type Locator, type Page } from '@playwright/test';
import { amplitudeOf, dbOf, positionOf } from '../../src/playback/volumeScale.ts';
import { boxOf, choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 放在宽窗标题栏里的播放栏：四键与音量键、正在播放条（格式标记、进度线）、音量浮层（点开朝下、滚轮、静音、滑条）。
// 进度与音量的换算按 SDK 的线协议断言；观感与贴靠布局只能实机看。

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

const key = (page: Page, name: string) => page.locator(`header [data-player-key="${name}"]`);
const slider = (page: Page) => page.getByRole('slider', { name: '播放进度' });
const popover = (page: Page) => page.locator('[data-volume-popover]');
// 入场动效带一段位移，播完再量
const settled = (locator: Locator) =>
  locator.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );

test('标题栏里 ⋯ 之后是四键与音量键，正中是 540 × 52 的正在播放条，单独在窗口居中', async ({
  page,
}) => {
  const { errors } = await openPlayer(page);
  expect(await boxOf(page, 'header [data-menu="main"]')).toMatchObject({
    x: 8,
    width: 40,
    height: 32,
  });
  // 播放控制组离 ⋯ 28，组内键各宽 28、高 36，音量键离下一首 16
  const first = 8 + 40 + 28;
  for (const [index, name] of ['order', 'previous', 'play', 'next'].entries()) {
    expect(await boxOf(page, `header [data-player-key="${name}"]`)).toMatchObject({
      x: first + 28 * index,
      width: 28,
      height: 36,
    });
  }
  expect(await boxOf(page, 'header [data-player-key="volume"]')).toMatchObject({
    x: first + 28 * 4 + 16,
    width: 28,
    height: 36,
  });
  expect(await boxOf(page, '[data-now-playing]')).toEqual({
    x: (1280 - 540) / 2,
    y: 6,
    width: 540,
    height: 52,
  });
  expect(errors).toEqual([]);
});

test('署名放不下时艺人、专辑各自用省略号截断，名字始终可点，字不滚动', async ({ page }) => {
  const long = makeTrack({
    title: 'Probe',
    artist: 'Alpha, Beta',
    artists: ['Alpha', 'Beta'],
    album: 'a'.repeat(80),
  });
  const { errors } = await openPlayer(page, { state: { track: long } });
  const byline = page.locator('[data-now-playing] [class*="subRow"]');
  // 两位艺人各一个可点的名字；测试里的专辑没有可跳的去向，是纯文字
  const names = byline.locator('[class*="fui-Link"]');
  await expect(names).toHaveCount(2);
  // 署名不再套截断滚动的外壳；放不下的那一项出省略号，全文在它自己的 title 上
  await expect(byline.locator('[class*="clip"]')).toHaveCount(0);
  const album = byline.locator('[class*="value"]').last();
  expect(await album.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(await album.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(byline.locator('[title]').last()).toHaveAttribute('title', 'a'.repeat(80));
  // 宽度不管卡在哪，名字都一直可点，不随形态换来换去
  for (let at = 0; at < 10; at += 1) {
    await page.waitForTimeout(40);
    await expect(names).toHaveCount(2);
  }
  expect(errors).toEqual([]);
});

test('四键调到对应的命令；播放键的名字与图标跟着宿主报的状态', async ({ page }) => {
  const { host, state, calls, errors } = await openPlayer(page);
  await expect(key(page, 'play')).toHaveAccessibleName('暂停');
  await key(page, 'previous').click();
  await expect.poll(() => calls('playback.previous').length).toBe(1);
  await key(page, 'next').click();
  await expect.poll(() => calls('playback.next').length).toBe(1);
  state.state = 'paused';
  await key(page, 'play').click();
  await expect.poll(() => calls('playback.playOrPause').length).toBe(1);
  await expect(key(page, 'play')).toHaveAccessibleName('播放');
  state.state = 'playing';
  await host.emit('playback:paused', { paused: false });
  await expect(key(page, 'play')).toHaveAccessibleName('暂停');
  await expect(key(page, 'order')).toHaveAccessibleName('播放顺序：默认');
  expect(errors).toEqual([]);
});

test('正在播放条写曲名、艺人与格式标记；停止时整条收掉，标题栏高度不变，播放键照常可用', async ({
  page,
}) => {
  const { host, state, errors } = await openPlayer(page);
  const lcd = page.locator('[data-now-playing]');
  await expect(lcd).toContainText(PLAYING_TRACK.title);
  await expect(lcd).toContainText(PLAYING_TRACK.artist);
  await expect(lcd.locator('[data-format-badge]')).toHaveText('FLAC16/44.1');
  await expect(lcd.locator('img')).toHaveCount(1);

  state.state = 'stopped';
  state.track = null;
  await host.emit('playback:stopped', { reason: 'user' });
  await expect(lcd).toHaveCount(0);
  await expect(slider(page)).toHaveCount(0);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 64 });
  await expect(key(page, 'play')).toBeEnabled();
  await expect(key(page, 'volume')).toBeVisible();

  state.state = 'playing';
  state.track = PLAYING_TRACK;
  await host.emit('playback:trackChanged', PLAYING_TRACK);
  await expect(lcd).toContainText(PLAYING_TRACK.title);
  expect(errors).toEqual([]);
});

test('正在播放条的曲名放不下时定时滚动一遍，放得下的不滚；减弱动效时只截断', async ({ page }) => {
  const long =
    'RAVE LAUNCHER MK.II (Extended Mix) with a Title Far Too Long for the Now Playing Strip';
  const { host, state, errors } = await openPlayer(page, {
    state: { track: { ...PLAYING_TRACK, title: long } },
  });
  const lcd = page.locator('[data-now-playing]');
  const timedIn = (text: string) =>
    lcd
      .locator('span')
      .filter({ hasText: text })
      .first()
      .evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.timeline instanceof DocumentTimeline).length,
      );
  // 先停 3 s 才滚，停着时没有动画。
  expect(await timedIn(long)).toBe(0);
  await expect.poll(() => timedIn(long), { timeout: 8000 }).toBe(2);
  expect(await timedIn(PLAYING_TRACK.artist)).toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => timedIn(long)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => timedIn(long), { timeout: 8000 }).toBe(2);

  const short = { ...PLAYING_TRACK, path: 'file://E:/Music/short.flac', title: 'Short' };
  state.track = short;
  await host.emit('playback:trackChanged', short);
  await expect(lcd).toContainText('Short');
  await expect.poll(() => timedIn('Short')).toBe(0);

  state.track = { ...PLAYING_TRACK, title: long };
  await host.emit('playback:trackChanged', state.track);
  await expect.poll(() => timedIn(long), { timeout: 8000 }).toBe(2);
  const animations = await lcd
    .locator('span')
    .filter({ hasText: long })
    .first()
    .evaluateHandle((element) =>
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.timeline instanceof DocumentTimeline),
    );
  state.state = 'stopped';
  state.track = null;
  await host.emit('playback:stopped', { reason: 'user' });
  await expect(lcd).toHaveCount(0);
  await expect
    .poll(() => animations.evaluate((items) => items.map((animation) => animation.playState)))
    .toEqual(['idle', 'idle']);
  await animations.dispose();
  expect(errors).toEqual([]);
});

test('有损的曲目写比特率；位深取不到只写采样率', async ({ page }) => {
  const { host, state, errors } = await openPlayer(page, { state: { format: 'lossy|16' } });
  const badge = page.locator('[data-format-badge]');
  const mp3 = { ...PLAYING_TRACK, path: 'file://E:/Music/x.mp3', codec: 'MP3', bitrate: 320 };
  state.track = mp3;
  await host.emit('playback:trackChanged', mp3);
  await expect(badge).toHaveText('MP3320k');
  state.format = 'lossless|';
  const flac = { ...PLAYING_TRACK, path: 'file://E:/Music/y.flac', sampleRate: 96000 };
  state.track = flac;
  await host.emit('playback:trackChanged', flac);
  await expect(badge).toHaveText('FLAC96');
  expect(errors).toEqual([]);
});

test('点进度线跳到那一处；键盘 ← / → 各 5 秒，Home 回到开头', async ({ page }) => {
  const { calls, errors } = await openPlayer(page);
  const box = await slider(page).boundingBox();
  if (!box) throw new Error('进度线没画出来');
  await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2);
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(60, 0);
  await expect(slider(page)).toBeFocused();
  await expect(slider(page)).toHaveAttribute('aria-valuetext', '1:00 / 4:00');

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => calls('playback.setPosition').length).toBe(2);
  expect(Number(calls('playback.setPosition')[1]?.['position'])).toBeCloseTo(65, 0);
  await page.keyboard.press('Home');
  await expect.poll(() => calls('playback.setPosition').length).toBe(3);
  expect(Number(calls('playback.setPosition')[2]?.['position'])).toBe(0);
  expect(errors).toEqual([]);
});

test('拖动中显示拖到的位置，宿主的进度事件拉不回去；松手才 seek，Esc 或右键放弃', async ({
  page,
}) => {
  const { host, calls, errors } = await openPlayer(page);
  const box = await slider(page).boundingBox();
  if (!box) throw new Error('进度线没画出来');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
  await host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 43 });
  await host.emit('playback:time', { position: 44 });
  await expect(slider(page)).toHaveAttribute('aria-valuenow', '144');
  expect(calls('playback.setPosition')).toEqual([]);
  await page.mouse.up();
  await expect.poll(() => calls('playback.setPosition').length).toBe(1);
  expect(Number(calls('playback.setPosition')[0]?.['position'])).toBeCloseTo(144, 0);

  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 2 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(calls('playback.setPosition')).toHaveLength(1);

  // 右键取消时随后那次右键菜单被吞掉；取消之后在进度线上右键，菜单事件照常到页面。
  await page.evaluate(() => {
    document.body.dataset['menus'] = '0';
    document.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      document.body.dataset['menus'] = String(Number(document.body.dataset['menus']) + 1);
    });
  });
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 2 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.up();
  await expect(slider(page)).not.toHaveAttribute('data-dragging');
  await page.waitForTimeout(200);
  expect(calls('playback.setPosition')).toHaveLength(1);
  await expect(page.locator('body')).toHaveAttribute('data-menus', '0');
  await page.mouse.click(box.x + box.width * 0.5, y, { button: 'right' });
  await expect(page.locator('body')).toHaveAttribute('data-menus', '1');
  expect(errors).toEqual([]);
});

test('宿主说这一首不能 seek 时进度线不接点击、拖动与按键', async ({ page }) => {
  const { host, state, calls, errors } = await openPlayer(page, { state: { canSeek: false } });
  await expect(slider(page)).toHaveAttribute('aria-disabled', 'true');
  const box = await slider(page).boundingBox();
  if (!box) throw new Error('进度线没画出来');
  const y = box.y + box.height / 2;
  await page.mouse.click(box.x + box.width / 2, y);
  await page.mouse.move(box.x + 10, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, y, { steps: 3 });
  await page.mouse.up();
  await slider(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  expect(calls('playback.setPosition')).toEqual([]);

  state.canSeek = true;
  await host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 42,
    duration: 240,
    canSeek: true,
  });
  await expect(slider(page)).not.toHaveAttribute('aria-disabled');
  expect(errors).toEqual([]);
});

test('标题栏的音量键点开朝下的浮层：左缘对齐音量键、整个落在标题栏下面；悬停只出数值，Esc 收起、焦点回到音量键', async ({
  page,
}) => {
  const { errors } = await openPlayer(page);
  const square = key(page, 'volume');
  await square.hover();
  await page.waitForTimeout(400);
  await expect(popover(page)).toHaveCount(0);
  await square.click();
  await expect(popover(page)).toBeVisible();
  await settled(popover(page));
  const popBox = await boxOf(page, '[data-volume-popover]');
  const keyBox = await boxOf(page, 'header [data-player-key="volume"]');
  const header = await boxOf(page, 'header');
  expect(Math.abs(popBox.x - keyBox.x)).toBeLessThanOrEqual(1);
  expect(popBox.y).toBeGreaterThanOrEqual(header.y + header.height);
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(square).toBeFocused();
  expect(errors).toEqual([]);
});

test('音量键上滚轮调音量，一格一个位置；浮层里的静音键调 toggleMute，图标与名字跟着变', async ({
  page,
}) => {
  const { host, state, calls, errors } = await openPlayer(page);
  const square = key(page, 'volume');
  await square.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => calls('playback.setVolume').length).toBe(1);
  const expected = amplitudeOf(dbOf(positionOf(-20, 'perceptual') + 1, 'perceptual'));
  expect(Number(calls('playback.setVolume')[0]?.['volume'])).toBeCloseTo(expected, 3);

  const icon = () => square.locator('svg').evaluate((svg) => svg.innerHTML);
  const unmutedIcon = await icon();
  await square.click();
  await expect(popover(page)).toBeVisible();
  state.muted = true;
  await popover(page).getByRole('button', { name: '静音' }).click();
  await expect.poll(() => calls('playback.toggleMute').length).toBe(1);
  await expect(popover(page).getByRole('button', { name: '取消静音' })).toBeVisible();
  await expect.poll(icon).not.toBe(unmutedIcon);

  state.muted = false;
  await host.emit('playback:volumeChanged', {
    volume: 10,
    volumeDb: -20,
    muted: false,
    isMuted: false,
  });
  await expect(popover(page).getByRole('button', { name: '静音' })).toBeVisible();
  await expect.poll(icon).toBe(unmutedIcon);
  expect(errors).toEqual([]);
});

test('拖音量滑条实时提交、松手回读；拖动中指针移出浮层也不收，松手后浮层留着', async ({ page }) => {
  const { calls, errors } = await openPlayer(page);
  await key(page, 'volume').click();
  await settled(popover(page));
  const volume = popover(page).getByRole('slider', { name: '音量' });
  const box = await volume.boundingBox();
  if (!box) throw new Error('音量滑条没画出来');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y + 200, { steps: 4 });
  await page.waitForTimeout(800);
  await expect(popover(page)).toBeVisible();
  await expect(volume).toHaveAttribute('aria-valuenow', '80');
  // 拖动中的实时提交一律不回读。
  const reads = calls('playback.getVolume').length;
  expect(calls('playback.setVolume').length).toBeGreaterThan(1);
  await page.mouse.up();
  await expect
    .poll(() => Number(calls('playback.setVolume').at(-1)?.['volume']))
    .toBeCloseTo(amplitudeOf(dbOf(80, 'perceptual')), 3);
  await expect.poll(() => calls('playback.getVolume').length).toBe(reads + 1);
  await expect(popover(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('键盘：Tab 顺序是四键、音量键、正在播放条、⋯；音量键上 Enter 打开浮层，滑条用方向键调；Esc 收起、焦点回到音量键', async ({
  page,
}) => {
  const { calls, errors } = await openPlayer(page);
  await key(page, 'next').focus();
  // 下一首键之后是音量键，再是正在播放条里的封面、星（没评分时也走得到）与进度线，最后到 ⋯。
  await page.keyboard.press('Tab');
  await expect(key(page, 'volume')).toBeFocused();
  await expect(popover(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(key(page, 'cover')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.locator('[data-now-playing] [data-now-playing-rating] input').first(),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(slider(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(key(page, 'more')).toBeFocused();
  await key(page, 'volume').focus();
  await page.keyboard.press('Enter');
  await expect(popover(page)).toBeVisible();
  const volume = popover(page).getByRole('slider', { name: '音量' });
  await volume.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => calls('playback.setVolume').length).toBe(1);
  await page.waitForTimeout(700);
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(key(page, 'volume')).toBeFocused();
  expect(errors).toEqual([]);
});
