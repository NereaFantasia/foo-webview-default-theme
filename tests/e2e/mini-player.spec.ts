import { expect, test, type Page } from '@playwright/test';
import { openPlayer, PLAYING_TRACK, type OpenPlayerOptions } from '../fixtures/playerPage.ts';

test('完整窗口的播放栏底边不超出可见区域', async ({ page }) => {
  await openPlayer(page);
  await page
    .locator('main')
    .first()
    .evaluate((node) => {
      const content = document.createElement('div');
      content.style.height = '1400px';
      node.append(content);
    });
  const bar = page.locator('[data-player-bar]');
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(800);
  await expect(page.locator('[data-full-window]')).toHaveCSS('height', '800px');
});

const LONG: OpenPlayerOptions = {
  state: {
    track: {
      ...PLAYING_TRACK,
      title: 'Luv (sic) Part 3 [feat. Shing02] (Extended Album Version)',
      artist: 'Nujabes feat. Shing02 and Hydeout Productions',
      album: 'Modal Soul Extended Edition',
    },
  },
};

async function openMini(page: Page, options: OpenPlayerOptions = {}, via: 'menu' | 'bar' = 'menu') {
  const player = await openPlayer(page, options);
  let bounds = { x: 180, y: 120, width: 1280, height: 800 };
  let min = { width: 640, height: 400 };
  let max = { width: 0, height: 0 };
  player.host.answer('window.getMode', {
    success: true,
    mode: 'standalone',
    panelMode: false,
    windowId: 'main',
  });
  player.host.answer('window.getBounds', () => ({ success: true, ...bounds }));
  player.host.answer('window.getMinSize', () => ({ success: true, ...min, windowId: 'main' }));
  player.host.answer('window.getMaxSize', () => ({ success: true, ...max, windowId: 'main' }));
  player.host.answer('window.isResizable', { success: true, resizable: true, windowId: 'main' });
  player.host.answer('window.getState', () => ({
    success: true,
    ...bounds,
    maximized: false,
    minimized: false,
    fullscreen: false,
    alwaysOnTop: false,
    focused: true,
    isMaximized: false,
    isMinimized: false,
    isFullscreen: false,
    isAlwaysOnTop: false,
    isFocused: true,
  }));
  player.host.answer('window.setMinSize', (params) => {
    min = { width: Number(params['width']), height: Number(params['height']) };
    return { success: true, ...min, windowId: 'main' };
  });
  player.host.answer('window.setMaxSize', (params) => {
    max = { width: Number(params['width']), height: Number(params['height']) };
    return { success: true, ...max, windowId: 'main' };
  });
  player.host.answer('window.setResizable', (params) => ({
    success: true,
    resizable: params['resizable'] === true,
    windowId: 'main',
  }));
  player.host.answer('window.setBounds', async (params) => {
    bounds = {
      x: Number(params['x'] ?? bounds.x),
      y: Number(params['y'] ?? bounds.y),
      width: Number(params['width'] ?? bounds.width),
      height: Number(params['height'] ?? bounds.height),
    };
    await page.setViewportSize({ width: bounds.width, height: bounds.height });
    return { success: true };
  });
  player.host.answer('window.setFullscreen', (params) => ({
    success: true,
    fullscreen: params['enabled'] === true,
    windowId: 'main',
  }));
  player.host.answer('window.setAlwaysOnTop', { success: true });
  player.host.answer('window.startDrag', { success: true });
  player.host.answer('rating.set', (params) => ({
    success: true,
    path: String(params['path']),
    rating: Number(params['rating']),
    storage: 'stats',
  }));
  await page
    .locator('[data-menu="main"]')
    .evaluate((node) => node.setAttribute('data-retained', 'yes'));
  if (via === 'bar') {
    await page.locator('[data-player-bar] [data-player-key="mini"]').click();
  } else {
    await page.locator('[data-menu="main"]').click();
    await page.getByRole('menuitem', { name: '迷你播放器', exact: true }).click();
  }
  const root = page.locator('[data-mini-player]');
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => bounds.width).toBe(333);
  return { ...player, root, bounds: () => bounds };
}

test('同窗进入、常显评分，指针在播放器上才出窗口键，关闭回到完整界面', async ({ page }) => {
  const x = await openMini(page);
  await expect(x.root.getByText('foobar2000', { exact: true })).toHaveCount(0);
  await expect(x.root.locator('[data-now-playing-rating]')).toBeVisible();
  const captions = x.root.getByRole('group', { name: '窗口控制' });
  await page.mouse.move(600, 400);
  await expect(captions).toHaveCSS('opacity', '0');
  await page.mouse.move(10, 60);
  await expect(captions).toHaveCSS('opacity', '1');
  await expect(captions.getByRole('button')).toHaveCount(3);
  await expect(x.root.getByRole('button', { name: '返回完整界面' })).toHaveCount(0);
  await x.root.getByRole('button', { name: '关闭迷你播放器' }).click();
  await expect(x.root).toHaveCount(0);
  await expect.poll(() => x.bounds()).toEqual({ x: 180, y: 120, width: 1280, height: 800 });
  await expect(page.locator('[data-menu="main"]')).toBeVisible();
  const bar = await page.locator('[data-player-bar]').boundingBox();
  expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBeLessThanOrEqual(800);
  expect(x.calls('window.createPopup')).toEqual([]);
  expect(x.errors).toEqual([]);
});

test('播放、音量、进度与评分继续使用已有宿主命令', async ({ page }) => {
  const x = await openMini(page);
  await x.root.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => x.calls('playback.playOrPause').length).toBe(1);
  await x.root.getByRole('button', { name: '下一首', exact: true }).click();
  await expect.poll(() => x.calls('playback.next').length).toBe(1);
  const seek = x.root.getByRole('slider', { name: '播放进度' });
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => x.calls('playback.setPosition').length).toBe(1);
  const volume = x.root.getByRole('button', { name: '静音', exact: true });
  await volume.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/^\d+$/);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => x.calls('playback.setVolume').length).toBeGreaterThan(0);
  await volume.click();
  await expect.poll(() => x.calls('playback.toggleMute').length).toBe(1);
  await x.root.getByRole('radio', { name: '4', exact: true }).click();
  await expect.poll(() => x.calls('rating.set').length).toBe(1);
  await expect(x.root.getByRole('radio', { name: '4', exact: true })).toBeChecked();
  expect(x.errors).toEqual([]);
});

test('封面展开与同窗菜单，关闭菜单恢复尺寸', async ({ page }) => {
  const x = await openMini(page);
  await x.root.getByRole('button', { name: '展开封面' }).click();
  // 先淡出再改尺寸：点下去的当下窗口还是紧凑态的高度，内容正在淡出。
  expect(x.bounds().height).toBe(133);
  expect(
    await x.root.locator('[data-mini-backdrop]').evaluate((node) => node.getAnimations().length),
  ).toBeGreaterThan(0);
  await expect(x.root).toHaveAttribute('data-mini-player', 'cover');
  await expect.poll(() => x.bounds()).toMatchObject({ width: 280, height: 399 });
  await x.root.getByRole('button', { name: '更多', exact: true }).click();
  await expect(x.root.locator('[data-mini-menu]')).toBeVisible();
  await expect(x.root.locator('[data-mini-cover]')).toHaveCount(0);
  expect(x.bounds().height).toBe(399);
  await page.keyboard.press('Escape');
  await expect(x.root.locator('[data-mini-menu]')).toHaveCount(0);
  await x.root.getByRole('button', { name: '收起封面' }).click();
  await expect.poll(() => x.bounds()).toMatchObject({ width: 333, height: 133 });
  await x.root.getByRole('button', { name: '更多', exact: true }).click();
  await expect(x.root.locator('[data-mini-menu]')).toBeVisible();
  await expect.poll(() => x.bounds().height).toBe(256);
  expect(
    await x.root.locator('[data-mini-menu]').evaluate((node) => node.getAnimations().length),
  ).toBeGreaterThan(0);
  await expect(x.root.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect(x.root.getByRole('button', { name: '音量', exact: true })).toHaveCount(0);
  await x.root.getByRole('button', { name: /^播放顺序/ }).click();
  await expect(x.root.getByRole('button', { name: '随机', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(x.root.getByRole('button', { name: /^播放顺序/ })).toBeFocused();
  await x.root.getByRole('button', { name: /^播放顺序/ }).click();
  await x.root.getByRole('button', { name: '随机', exact: true }).click();
  await expect.poll(() => x.calls('playback.setPlaybackOrder').length).toBe(1);
  await expect.poll(() => x.bounds().height).toBe(133);
  await expect(x.root.getByRole('button', { name: '更多', exact: true })).toBeFocused();
  expect(x.errors).toEqual([]);
});

test('长标题往返，悬停暂停，评分保持位置', async ({ page }) => {
  const x = await openMini(page, LONG);
  const title = x.root.locator('[data-primary]');
  const rating = x.root.locator('[data-now-playing-rating]');
  const before = await rating.boundingBox();
  await page.mouse.move(10, 60);
  await expect
    .poll(() => title.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(1);
  await title.evaluate((node) => {
    const animation = node.getAnimations({ subtree: true })[0];
    if (animation) animation.currentTime = 2800;
  });
  await expect
    .poll(() =>
      title
        .locator('span')
        .evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41),
    )
    .toBeLessThan(0);
  expect(await rating.boundingBox()).toEqual(before);
  await title.hover();
  await expect
    .poll(() => title.evaluate((node) => node.getAnimations({ subtree: true })[0]?.playState))
    .toBe('paused');
  await page.mouse.move(10, 60);
  await expect
    .poll(() => title.evaluate((node) => node.getAnimations({ subtree: true })[0]?.playState))
    .toBe('running');
  expect(x.errors).toEqual([]);
});

test('减弱动效不自动滚动，键盘能走到窗口键并显示出来', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const x = await openMini(page, LONG);
  expect(
    await x.root
      .locator('[data-primary]')
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  const restore = x.root.getByRole('button', { name: '关闭迷你播放器' });
  await page.mouse.move(600, 400);
  await restore.focus();
  await expect(x.root.getByRole('group', { name: '窗口控制' })).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(x.root).toHaveCount(0);
  expect(x.errors).toEqual([]);
});

test('完整视图保留 DOM，迷你模式不响应页面历史和全屏快捷键', async ({ page }) => {
  const x = await openMini(page);
  await page.keyboard.press('F11');
  await page.keyboard.press('Alt+ArrowLeft');
  expect(x.calls('window.toggleFullscreen')).toEqual([]);
  await x.root.getByRole('button', { name: '关闭迷你播放器' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-menu="main"]')).toBeVisible();
  await expect(page.locator('[data-menu="main"]')).toHaveAttribute('data-retained', 'yes');
  expect(x.errors).toEqual([]);
});

test('界面与窗口同比缩小，封面与按键按缩放后的尺寸排', async ({ page }) => {
  const x = await openMini(page);
  await expect.poll(() => x.bounds()).toMatchObject({ width: 333, height: 133 });
  const root = await x.root.boundingBox();
  expect(root).toMatchObject({ x: 0, y: 0, width: 333, height: 133 });
  const cover = await x.root.locator('[data-mini-cover]').boundingBox();
  expect(cover?.width).toBeCloseTo(87.5, 0);
  const more = await x.root.getByRole('button', { name: '更多', exact: true }).boundingBox();
  expect(more?.width).toBeCloseTo(28, 0);
  expect((more?.x ?? 0) + (more?.width ?? 0)).toBeCloseTo(333 - 10.5, 0);
  expect(x.errors).toEqual([]);
});

test('停止时只留标题与播放控制，网络流以直播标记代替进度', async ({ page }) => {
  const stopped = await openMini(page, { state: { state: 'stopped', track: null } });
  await expect(stopped.root.getByText('未在播放', { exact: true })).toBeVisible();
  await expect(stopped.root.getByRole('slider', { name: '播放进度' })).toHaveCount(0);
  await expect(stopped.root.locator('[data-now-playing-rating]')).toHaveCount(0);
  await expect(stopped.root.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect(stopped.errors).toEqual([]);
});

test('网络流显示网络广播与正在直播，不画进度', async ({ page }) => {
  const x = await openMini(page, {
    state: {
      track: {
        ...PLAYING_TRACK,
        title: 'SomaFM · Groove Salad',
        artist: '',
        album: '',
        duration: 0,
      },
    },
  });
  await expect(x.root.getByText('网络广播', { exact: true })).toBeVisible();
  await expect(x.root.getByText('正在直播', { exact: true })).toBeVisible();
  await expect(x.root.getByRole('slider', { name: '播放进度' })).toHaveCount(0);
  expect(x.errors).toEqual([]);
});

test('底部通栏的迷你键进入迷你模式', async ({ page }) => {
  const x = await openMini(page, {}, 'bar');
  await expect(x.root).toHaveAttribute('data-mini-player', 'compact');
  expect(x.errors).toEqual([]);
});

test('按在封面或空白处拖动窗口，按在按键上不拖', async ({ page }) => {
  const x = await openMini(page);
  await x.root.getByRole('button', { name: '下一首', exact: true }).click();
  expect(x.calls('window.startDrag')).toEqual([]);
  await x.root.locator('[data-mini-cover]').hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => x.calls('window.startDrag').length).toBe(1);
  expect(x.errors).toEqual([]);
});
