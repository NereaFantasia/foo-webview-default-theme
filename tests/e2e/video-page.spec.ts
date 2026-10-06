import { expect, test } from '@playwright/test';
import { openVideo } from '../fixtures/videoPage.ts';
import { choosePlayerBar } from '../fixtures/playerPage.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { makeTrack } from '../fixtures/tracks.ts';

test('播放栏视频键切换开关，Esc 先关闭菜单再返回且保留音频状态', async ({ page }) => {
  const fixture = await openVideo(page);
  const entry = page.locator('[data-video-entry]');
  const region = page.getByRole('region', { name: '视频', exact: true });
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await entry.click();
  await expect(region).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  await expect(entry).toHaveAttribute('aria-pressed', 'false');
  await entry.click();
  await expect(region).toBeVisible();
  await page.getByRole('button', { name: '画面适配', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: '填满', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitemradio', { name: '填满', exact: true })).toBeHidden();
  await expect(region).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(region).toHaveCount(0);
  expect(fixture.state.state).toBe('paused');
  expect(fixture.host.callsTo('playback.stop')).toEqual([]);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(region).toBeVisible();
  await page.getByRole('button', { name: '全窗口', exact: true }).click();
  await expect(page.locator('[data-expanded]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-expanded]')).toHaveCount(0);
  await expect(region).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(region).toHaveCount(0);
});

test('真实媒体加载、静音、比例与跳转命令', async ({ page }) => {
  const fixture = await openVideo(page);
  const video = page.locator('video');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThan(1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(320);
  expect(
    await video.evaluate((element: HTMLVideoElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 18;
      const context = canvas.getContext('2d');
      if (!context) return 0;
      context.drawImage(element, 0, 0, 32, 18);
      return new Set(context.getImageData(0, 0, 32, 18).data).size;
    }),
  ).toBeGreaterThan(10);
  await page.getByRole('button', { name: '画面适配', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '填满', exact: true }).click();
  await expect(video).toHaveAttribute('data-fit', 'cover');
  const seek = page.locator('[data-video-controls]').getByRole('slider');
  await page.getByRole('button', { name: '前进 5 秒', exact: true }).click();
  await expect.poll(() => fixture.state.position).toBe(10);
  await expect(seek).toHaveAttribute('aria-valuenow', '10');
  await page.getByRole('button', { name: '后退 5 秒', exact: true }).click();
  await expect.poll(() => fixture.state.position).toBe(5);
  await expect(seek).toHaveAttribute('aria-valuenow', '5');
  await page.getByRole('region', { name: '视频', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => fixture.state.position).toBe(10);
  await expect(seek).toHaveAttribute('aria-valuenow', '10');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => fixture.state.position).toBe(5);
  await expect(seek).toHaveAttribute('aria-valuenow', '5');
  await page.keyboard.press('ArrowLeft');
  await expect(seek).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => fixture.state.position).toBe(0);
});

test('播放画面前进，空闲隐藏但键盘焦点留在控件时不隐藏', async ({ page }) => {
  const fixture = await openVideo(page);
  const video = page.locator('video');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThan(1);
  fixture.state.state = 'playing';
  await fixture.host.emit('playback:stateChanged', {
    state: 'playing',
    position: 5,
    duration: 60,
    canSeek: true,
    hostTime: Date.now(),
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(5.3);
  const region = page.getByRole('region', { name: '视频', exact: true });
  await region.focus();
  await expect(page.locator('[data-video-controls]')).toBeHidden({ timeout: 6000 });
  await region.hover();
  const next = page.getByRole('button', { name: '前进 5 秒', exact: true });
  await page.keyboard.press('Tab');
  await next.focus();
  await page.waitForTimeout(3300);
  await expect(page.locator('[data-video-controls]')).toBeVisible();
  await page.getByRole('button', { name: '画面适配', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '填满', exact: true }).focus();
  await page.waitForTimeout(3300);
  await expect(page.locator('[data-video-controls]')).toBeVisible();
  await page.keyboard.press('Escape');
  await region.focus();
  await expect(page.locator('[data-video-controls]')).toBeHidden({ timeout: 6000 });
  await region.hover();
  await next.click();
  await expect(next).toBeFocused();
  await expect(page.locator('[data-video-controls]')).toBeHidden({ timeout: 6000 });
  await expect(region).toBeFocused();
});

test('解码失败保留音频控制、禁用画面操作并可重试', async ({ page }) => {
  await openVideo(page);
  await page.route('**/video-sample.webm', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'video/webm',
      body: 'invalid media',
    }),
  );
  await page.reload();
  await page.locator('[data-video-entry]').click();
  await expect(page.getByText('无法播放这种视频格式')).toBeVisible();
  await expect(page.getByRole('button', { name: '全窗口', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重新加载' })).toBeEnabled();
  await expect(
    page.locator('[data-video-controls]').getByRole('button', { name: '播放', exact: true }),
  ).toBeEnabled();
});

test('来源读取失败与播放失败分开提示，重试重新读取来源', async ({ page }) => {
  const fixture = await openVideo(page);
  fixture.host.answer('media.getContainerInfo', hostFailure('OPERATION_FAILED'));
  fixture.state.track = makeTrack({
    path: 'E:\\unavailable.webm',
    handle: 'E:\\unavailable.webm',
    subsong: 0,
  });
  await fixture.host.emit('playback:trackChanged', fixture.state.track);
  await expect(page.getByText('视频来源读取失败', { exact: true })).toBeVisible();
  await expect(page.getByText('视频播放失败', { exact: true })).toHaveCount(0);
  fixture.host.answer('media.getContainerInfo', {
    success: true,
    recognized: true,
    tracks: [],
    attachments: [],
  });
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('此曲目没有视频', { exact: true })).toBeVisible();
  await expect(page.getByText('视频来源读取失败', { exact: true })).toHaveCount(0);
});

test('全窗口和全屏退出不新增历史，离页释放视频', async ({ page }) => {
  const fixture = await openVideo(page);
  await page.getByRole('button', { name: '全窗口', exact: true }).click();
  await expect(page.locator('[data-expanded]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-expanded]')).toHaveCount(0);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(() => fixture.host.callsTo('window.enterFullscreen').length).toBe(1);
  await expect(page.locator('[data-expanded]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-expanded]')).toHaveCount(0);
  await expect.poll(() => fixture.host.callsTo('window.exitFullscreen').length).toBe(1);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('video')).toHaveCount(0);
});

test('390 胶囊入口与控件保持在视口内，子曲目不加载画面', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const fixture = await openVideo(page, 390, 2);
  await expect(page.getByText('暂不支持子曲目的视频')).toBeVisible();
  expect(fixture.host.callsTo('media.getStreamUrl')).toEqual([]);
  const controls = await page.locator('[data-video-controls]').boundingBox();
  expect(controls).not.toBeNull();
  expect(controls?.x).toBeGreaterThanOrEqual(0);
  expect((controls?.x ?? 0) + (controls?.width ?? 0)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: '全窗口', exact: true })).toBeDisabled();
});

test('窄窗单行控件、溢出菜单与宽窗恢复', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const fixture = await openVideo(page, 390);
  const controls = page.locator('[data-video-controls]');
  const more = controls.getByRole('button', { name: '视频选项', exact: true });
  await expect(more).toBeVisible();
  for (const width of [390, 600]) {
    await page.setViewportSize({ width, height: 800 });
    const boxes = await controls
      .locator('button:visible, [role="slider"]:visible')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, center: y + height / 2 };
        }),
      );
    expect(boxes).toHaveLength(5);
    expect(
      Math.max(...boxes.map((box) => box.center)) - Math.min(...boxes.map((box) => box.center)),
    ).toBeLessThan(2);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.width).toBeGreaterThan(20);
    }
  }
  await more.click();
  await page.getByRole('menuitem', { name: '前进 5 秒', exact: true }).click();
  await expect.poll(() => fixture.state.position).toBe(10);
  await more.click();
  await page.getByRole('menuitem', { name: '画面适配', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '填满', exact: true }).click();
  await expect(page.locator('video')).toHaveAttribute('data-fit', 'cover');
  await controls.getByRole('slider').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => fixture.state.position).toBe(0);
  await controls.getByRole('button', { name: '全窗口', exact: true }).click();
  await expect(page.locator('[data-expanded]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-expanded]')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(more).toBeHidden();
  await expect(controls.getByRole('button', { name: '画面适配', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '前进 5 秒', exact: true })).toBeVisible();
});

test('深浅主题下视频浮层有底色、工具栏模糊及按钮位置正确', async ({ page }) => {
  await openVideo(page);
  const controls = page.locator('[data-video-controls]');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    const fit = controls.getByRole('button', { name: '画面适配', exact: true });
    const volume = controls.locator('[data-player-key="volume"]');
    const fitBox = await fit.boundingBox();
    const volumeBox = await volume.boundingBox();
    expect(fitBox).not.toBeNull();
    expect(volumeBox).not.toBeNull();
    expect(fitBox!.x).toBeLessThan(volumeBox!.x);
    expect(await controls.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('blur(24px)');
    await volume.click();
    const surface = page.locator('[data-volume-popover]');
    await expect(surface).toBeVisible();
    const colors = await surface.evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--colorNeutralBackground1)';
      el.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: style.backgroundColor, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    expect(colors.actual).not.toBe('rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => controls.evaluate((el) => getComputedStyle(el.parentElement!).transitionDuration))
    .toBe('0.001s, 0.001s, 0s');
});
