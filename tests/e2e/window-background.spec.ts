import { expect, test, type Page } from '@playwright/test';
import { openSettings, enterSettings } from '../fixtures/settingsPage.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import type { PageHost } from '../fixtures/pageHost.ts';

async function focusWindow(host: PageHost, focused: boolean, minimized = false): Promise<void> {
  host.answer('window.getState', {
    success: true,
    focused,
    isFocused: focused,
    maximized: false,
    isMaximized: false,
    minimized,
    isMinimized: minimized,
    fullscreen: false,
    isFullscreen: false,
    alwaysOnTop: false,
    isAlwaysOnTop: false,
    width: 1280,
    height: 800,
    x: 0,
    y: 0,
  });
  // 广播载荷故意与本窗口快照相反，只能由当前窗口回读决定活动状态。
  await host.emit('window:stateChanged', {
    windowId: 'other-window',
    active: !focused,
    isActive: !focused,
    maximized: false,
    isMaximized: false,
    minimized: false,
    isMinimized: false,
    fullscreen: false,
    isFullscreen: false,
  });
}

async function imageData(page: Page, color: string): Promise<string> {
  return page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.fillStyle = fill;
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL();
  }, color);
}

for (const platformVersion of ['13.0.0', null]) {
  test(`按系统检测决定材质是否生效并保留选择：${platformVersion}`, async ({ page }) => {
    await page.addInitScript((version) => {
      localStorage.setItem('default-theme.backdrop.v1', 'acrylic');
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value:
          version === null
            ? undefined
            : {
                platform: 'Windows',
                getHighEntropyValues: async () => ({ platformVersion: version }),
              },
      });
    }, platformVersion);
    const settings = await openSettings(page);
    await expect(settings.select('窗口背景')).toHaveText(
      platformVersion ? 'Acrylic' : '主题色背景',
    );
    await expect(page.locator('[data-window-background="solid"]')).toHaveCount(
      platformVersion ? 0 : 1,
    );
    expect(
      settings.host.callsTo('window.setBackdropPolicy').at(-1)?.['backdropPolicy'],
    ).toMatchObject({
      activeEffect: platformVersion ? 'acrylic' : 'none',
    });
    expect(await page.evaluate(() => localStorage.getItem('default-theme.backdrop.v1'))).toBe(
      'acrylic',
    );
    expect(settings.errors).toEqual([]);
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`Windows 10 禁用窗口材质并保留背景偏好：${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(() => {
      localStorage.setItem('default-theme.backdrop.v1', 'acrylic');
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value: {
          platform: 'Windows',
          getHighEntropyValues: async () => ({ platformVersion: '10.0.0' }),
        },
      });
    });
    const settings = await openSettings(page);
    await expect(settings.card('窗口背景')).toContainText('Windows 10 使用主题色背景');
    await expect(settings.select('窗口背景')).toHaveText('主题色背景');
    await settings.select('窗口背景').click();
    for (const name of ['Acrylic', 'Mica', 'Mica Alt']) {
      await expect(page.getByRole('option', { name, exact: true })).toBeDisabled();
    }
    await page.keyboard.press('Escape');
    const background = page.locator('[data-window-background="solid"]');
    await expect(background).toBeVisible();
    const root = page.locator('#root > .fui-FluentProvider');
    const expected = await root.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.getPropertyValue('--colorNeutralBackground2').trim(),
        pane: style.getPropertyValue('--colorNeutralBackgroundAlpha2').trim(),
        paneRole: style.getPropertyValue('--bg-pane').trim(),
      };
    });
    expect(expected.paneRole).toBe(expected.pane);
    const actual = await background.evaluate((element) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--theme-background-color)';
      element.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { color, background: getComputedStyle(element).backgroundColor };
    });
    expect(actual.background).toBe(actual.color);
    expect(actual.background).not.toBe('rgba(0, 0, 0, 0)');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await background.boundingBox()).toEqual({ x: 0, y: 0, width, height: 800 });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(settings.host.callsTo('window.setBackdropPolicy')).not.toHaveLength(0);
    for (const call of settings.host.callsTo('window.setBackdropPolicy')) {
      expect(call['backdropPolicy']).toMatchObject({
        activeEffect: 'none',
        inactiveEffect: 'inherit',
      });
    }
    expect(await page.evaluate(() => localStorage.getItem('default-theme.backdrop.v1'))).toBe(
      'acrylic',
    );
    await settings.choose('窗口背景', '正在播放的封面');
    await expect(page.locator('[data-window-background="cover"]')).toBeVisible();
    await expect(background).toHaveCount(0);
    await settings.choose('窗口背景', '主题色背景');
    await expect(background).toBeVisible();
    await expect(settings.select('窗口背景')).toHaveText('主题色背景');
    expect(settings.errors).toEqual([]);
  });

  test(`整窗背景、深浅参数与窄窗：${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const settings = await openSettings(page);
    await settings.choose('窗口背景', '正在播放的封面');
    // 子行从无到有，卡随即展开。
    await expect(settings.expander('窗口背景').locator('[data-settings-toggle]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const background = page.locator('[data-window-background]');
    await expect(background).toHaveAttribute('data-window-background', 'cover');
    await expect(background.locator('img')).toHaveCount(0);
    const opaque = await background.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(opaque).toMatch(/^rgb\(/);
    for (const width of [1280, 900, 390]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await background.boundingBox()).toEqual({ x: 0, y: 0, width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    const shade = page.getByRole('slider', { name: '背景遮罩', exact: true });
    await expect(shade).toHaveValue(scheme === 'dark' ? '25' : '65');
    await shade.focus();
    await shade.press('Home');
    await shade.press('ArrowRight');
    await expect(shade).toHaveValue('1');
    await page.setViewportSize({ width: 1280, height: 800 });
    await settings.choose('颜色模式', scheme === 'dark' ? '浅色' : '深色');
    await expect(shade).toHaveValue(scheme === 'dark' ? '65' : '25');
    await settings.choose('颜色模式', scheme === 'dark' ? '深色' : '浅色');
    await expect(shade).toHaveValue('1');
    await focusWindow(settings.host, false);
    await expect(background.locator('[data-background-inactive]')).toHaveCSS(
      'opacity',
      scheme === 'dark' ? '0.18' : '0.06',
    );
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toHaveCSS(
      'opacity',
      '1',
    );
    await page.reload();
    await enterSettings(page);
    await expect(settings.select('窗口背景')).toHaveText('正在播放的封面');
    await settings.expand('窗口背景');
    await expect(shade).toHaveValue('1');
    await settings.choose('窗口背景', 'Mica');
    await expect(background).toHaveCount(0);
    // 材质没有可调的项：没有箭头，也没有子行。
    await expect(settings.expander('窗口背景').locator('[data-settings-toggle]')).toHaveCount(0);
    await expect(shade).toHaveCount(0);
  });
}

test('宿主未激活但网页仍有焦点时淡化背景，重新激活恢复', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({ source: 'cover', dark: { inactive: 100 } }),
    );
  });
  const settings = await openSettings(page);
  const inactive = page.locator('[data-background-inactive]');
  await expect(inactive).toHaveCSS('opacity', '0');
  await focusWindow(settings.host, false);
  expect(await page.evaluate(() => document.hasFocus())).toBe(true);
  await expect(inactive).toHaveCSS('opacity', '1');
  await focusWindow(settings.host, true);
  await expect(inactive).toHaveCSS('opacity', '0');
  expect(settings.errors).toEqual([]);
});

test('整窗失焦淡化连续过渡，快速恢复不跳变，减弱动效直接完成', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({ source: 'cover', dark: { inactive: 100 } }),
    );
  });
  const settings = await openSettings(page);
  const inactive = page.locator('[data-background-inactive]');
  await focusWindow(settings.host, true);
  await expect(inactive).toHaveCSS('opacity', '0');
  await expect(inactive).toHaveCSS('transition-duration', '0.167s');
  const pendingSample = inactive.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        const sample = () => {
          const animation = element.getAnimations()[0];
          if (!animation) return void requestAnimationFrame(sample);
          animation.pause();
          animation.currentTime = 80;
          resolve(Number(getComputedStyle(element).opacity));
        };
        requestAnimationFrame(sample);
      }),
  );
  await focusWindow(settings.host, false);
  const middle = await pendingSample;
  expect(middle).toBeGreaterThan(0);
  expect(middle).toBeLessThan(1);
  await focusWindow(settings.host, true);
  const reversed = await inactive.evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(reversed).toBeLessThanOrEqual(middle);
  await expect(inactive).toHaveCSS('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(inactive).toHaveCSS('transition-duration', '0.001s');
  await focusWindow(settings.host, false);
  await expect(inactive).toHaveCSS('opacity', '1');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toHaveCSS('opacity', '1');
  expect(settings.errors).toEqual([]);
});

test('封面背景换曲、缺图与停止回退不改来源；色场暂停缓动、减弱动效静止', async ({ page }) => {
  await page.addInitScript(() => {
    let time = 0;
    const uniform = WebGL2RenderingContext.prototype.uniform4f;
    WebGL2RenderingContext.prototype.uniform4f = function (location, x, y, z, w) {
      if (
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.hasAttribute('data-palette-field')
      )
        time = x;
      uniform.call(this, location, x, y, z, w);
    };
    Reflect.set(window, '__flowTime', () => time);
  });
  const player = await openPlayer(page);
  await enterSettings(page);
  const choose = async (option: string) => {
    await page.getByRole('combobox', { name: '窗口背景', exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const url = await imageData(page, '#b52658');
  player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: url,
  }));
  const track = makeTrack({ path: 'file://E:/Music/Background/new.flac', title: 'Background' });
  player.state.track = track;
  await player.host.emit('playback:trackChanged', track);
  await choose('正在播放的封面');
  const image = page.locator('[data-window-background] [data-background-image]');
  await expect(image).toHaveAttribute('src', url);
  await choose('流动色场');
  const field = page.locator('[data-palette-field]');
  const pixels = () =>
    field.evaluate(
      (canvas: HTMLCanvasElement) =>
        new Promise<string>((resolve) => requestAnimationFrame(() => resolve(canvas.toDataURL()))),
    );
  await focusWindow(player.host, true);
  const first = await pixels();
  await expect.poll(pixels).not.toBe(first);
  player.state.state = 'paused';
  await player.host.emit('playback:paused', { paused: true });
  await page.waitForTimeout(150);
  const paused = await pixels();
  await expect.poll(pixels).not.toBe(paused);
  const motionTime = () =>
    page.evaluate(() => {
      const read = Reflect.get(window, '__flowTime');
      return typeof read === 'function' ? Number(read()) : 0;
    });
  const before = await motionTime();
  await page.waitForTimeout(1000);
  const elapsed = (await motionTime()) - before;
  expect(elapsed).toBeGreaterThan(0);
  expect(elapsed).toBeLessThan(0.2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  player.state.state = 'playing';
  await player.host.emit('playback:paused', { paused: false });
  await page.waitForTimeout(100);
  const reduced = await pixels();
  await page.waitForTimeout(250);
  expect(await pixels()).toBe(reduced);
  await choose('正在播放的封面');
  player.state.state = 'stopped';
  player.state.track = null;
  await player.host.emit('playback:stopped', { reason: 'user' });
  await expect(image).toHaveCount(0);
  await expect(page.locator('[data-window-background]')).toHaveAttribute(
    'data-window-background',
    'cover',
  );
});

test('流动色场深色压暗高亮，浅色直接呈现明亮底并保护次要文字', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({ source: 'palette' }),
    );
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
      draw.call(this, mode, first, count);
      if (
        !(this.canvas instanceof HTMLCanvasElement) ||
        !this.canvas.hasAttribute('data-palette-field') ||
        this.getParameter(this.FRAMEBUFFER_BINDING) !== null
      )
        return;
      const pixels = new Uint8Array(8 * 8 * 4);
      this.readPixels(240, 240, 8, 8, this.RGBA, this.UNSIGNED_BYTE, pixels);
      const sums = [0, 0, 0];
      for (let at = 0; at < pixels.length; at += 4)
        for (let c = 0; c < 3; c++) sums[c] += pixels[at + c] / 64;
      Reflect.set(window, '__flowSample', sums);
    };
  });
  const player = await openPlayer(page);
  await enterSettings(page);
  const sample = () =>
    page.evaluate(() => {
      const value: unknown = Reflect.get(window, '__flowSample');
      return Array.isArray(value) && value.every((channel: unknown) => typeof channel === 'number')
        ? value
        : [0, 0, 0];
    });
  let previous = 65;
  for (const level of [128, 200, 255]) {
    const url = await imageData(page, `rgb(${level},${level},${level})`);
    player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: 'front',
      path: String(params['path']),
      dataUrl: url,
    }));
    const track = makeTrack({ path: `file://E:/Music/Background/gray-${level}.flac` });
    player.state.track = track;
    await player.host.emit('playback:trackChanged', track);
    if (level === 128)
      await expect.poll(async () => (await sample())[0]).toBeGreaterThan(previous + 1);
    else await expect.poll(async () => (await sample())[0]).toBeLessThan(previous - 1);
    const channels = await sample();
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(2);
    previous = channels[0];
  }
  expect(previous).toBeLessThan(2);
  const dark = await sample();
  await page.getByRole('combobox', { name: '颜色模式', exact: true }).click();
  await page.getByRole('option', { name: '浅色', exact: true }).click();
  await expect.poll(async () => Math.min(...(await sample()))).toBeGreaterThan(240);
  const background = page.locator('[data-window-background="palette"]');
  const shade = background.locator('[data-background-shade]');
  await expect(shade).toHaveCSS('opacity', '0');
  await expect(shade).toHaveCSS('transition-duration', '0.001s');
  const contrast = await shade.evaluate(
    (element, background) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法计算背景覆盖层');
      context.fillStyle = style.getPropertyValue('--text-secondary');
      context.fillRect(0, 0, 1, 1);
      const foreground = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
      const luminance = (rgb: ArrayLike<number>) =>
        Array.from(rgb).reduce((sum, value, index) => {
          const s = value / 255;
          return (
            sum +
            (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]
          );
        }, 0);
      return (luminance(background) + 0.05) / (luminance(foreground) + 0.05);
    },
    await sample(),
  );
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('combobox', { name: '颜色模式', exact: true }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await expect.poll(sample).toEqual(dark);
  expect(player.errors).toEqual([]);
});

test('固定流动色场忽略旧背景参数，深浅同源，反复隐藏释放全部纹理', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({
        source: 'palette',
        light: { shade: 100, blur: 120, inactive: 100 },
        dark: { shade: 100, blur: 120, inactive: 100 },
      }),
    );
    localStorage.setItem(
      'default-theme.background-appearance.v1',
      JSON.stringify({
        light: { saturation: 0, brightness: 20 },
        dark: { saturation: 0, brightness: 20 },
      }),
    );
    let visible = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
    Reflect.set(window, '__flowVisibility', (next: boolean) => {
      visible = next;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const textures = new Set<WebGLTexture>();
    const create = WebGL2RenderingContext.prototype.createTexture;
    const remove = WebGL2RenderingContext.prototype.deleteTexture;
    WebGL2RenderingContext.prototype.createTexture = function () {
      const result = create.call(this);
      if (
        result &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.hasAttribute('data-palette-field')
      )
        textures.add(result);
      return result;
    };
    WebGL2RenderingContext.prototype.deleteTexture = function (texture) {
      if (texture) textures.delete(texture);
      remove.call(this, texture);
    };
    Reflect.set(window, '__flowTextures', () => textures.size);
  });
  const player = await openPlayer(page);
  await enterSettings(page);
  const field = page.locator('[data-palette-field]');
  await expect(field).toHaveAttribute('data-flow-backend', 'webgl2');
  const resources = () =>
    page.evaluate(() => {
      const read = Reflect.get(window, '__flowTextures');
      return typeof read === 'function' ? read() : -1;
    });
  expect(await resources()).toBe(8);
  const background = page.locator('[data-window-background="palette"]');
  await expect(background.locator(':scope > div').first()).toHaveCSS('filter', 'none');
  await expect(background.locator('[data-background-shade]')).toHaveCSS('opacity', '0');
  await expect(background.locator('[data-background-inactive]')).toHaveCSS('display', 'none');
  const expander = page
    .locator('[data-settings-expander]')
    .filter({ has: page.getByRole('combobox', { name: '窗口背景', exact: true }) });
  const toggle = expander.locator('[data-settings-toggle]');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(page.getByRole('slider', { name: '背景遮罩', exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: '背景模糊', exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: '内容区域不透明度', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: '背景饱和度', exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: '背景亮度', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '颜色模式', exact: true }).click();
  await page.getByRole('option', { name: '浅色', exact: true }).click();
  await expect(background.locator(':scope > div').first()).toHaveCSS('filter', 'none');
  await focusWindow(player.host, true, true);
  await expect(field).toHaveCount(0);
  expect(await resources()).toBe(0);
  await focusWindow(player.host, true);
  await expect(field).toHaveCount(1);
  await expect.poll(resources).toBe(8);
  for (let i = 0; i < 20; i++) {
    await page.evaluate((value) => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(value);
    }, false);
    await expect(field).toHaveCount(0);
    expect(await resources()).toBe(0);
    await page.evaluate((value) => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(value);
    }, true);
    await expect(field).toHaveCount(1);
    await expect.poll(resources).toBe(8);
  }
  expect(player.errors).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} 封面背景的阅读面与三种播放栏分层，切回材质恢复原样`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem(
        'default-theme.window-background.v1',
        JSON.stringify({ source: 'cover' }),
      );
    });
    const player = await openPlayer(page);
    const url = await imageData(page, scheme === 'dark' ? '#ffffff' : '#000000');
    player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: 'front',
      path: String(params['path']),
      dataUrl: url,
    }));
    const track = makeTrack({ path: 'file://E:/Music/Background/surface.flac' });
    player.state.track = track;
    await player.host.emit('playback:trackChanged', track);
    await enterSettings(page);
    const background = page.locator('[data-window-background]');
    await expect(background.locator('[data-background-image]')).toHaveAttribute('src', url);
    const pane = page.locator('main [data-reading-fill]').first();
    const edge = page.locator('main [data-reading-edge]').first();
    const sidebar = page.locator('[data-sidebar] > aside');
    const splitter = page.getByRole('separator', { name: '调整侧边栏宽度', exact: true });
    const checkBackgroundRegions = async () => {
      for (const area of [
        page.getByRole('banner'),
        sidebar,
        splitter,
        page.locator('[data-sidebar]'),
        page.locator('main'),
        page.locator('main > div:last-child'),
      ]) {
        await expect(area).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(area).toHaveCSS('backdrop-filter', 'none');
        expect(
          await area.evaluate((element) => getComputedStyle(element, '::before').content),
        ).toBe('none');
      }
    };
    await checkBackgroundRegions();
    const previousWidth = await splitter.getAttribute('aria-valuenow');
    await splitter.focus();
    await splitter.press('ArrowRight');
    await expect(splitter).not.toHaveAttribute('aria-valuenow', previousWidth ?? '');
    await checkBackgroundRegions();
    await expect(edge).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(pane).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.1)');
    expect(
      await pane.evaluate((element) => getComputedStyle(element, '::before').pointerEvents),
    ).toBe('none');
    expect(
      Number(await pane.evaluate((element) => getComputedStyle(element, '::before').opacity)),
    ).toBeGreaterThan(0);
    await page.locator('[data-right-card-key="queue"]').click();
    const right = page.locator('[data-form="docked"]');
    await expect(right).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(right).toHaveCSS('box-shadow', 'none');
    await expect(right.locator('[data-reading-surface]')).toHaveCount(0);

    const rightSplitter = page.getByRole('separator', { name: '调整面板宽度', exact: true });
    await expect(rightSplitter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const focused of [true, false]) {
      await focusWindow(player.host, focused);
      await expect(background.locator('[data-background-inactive]')).toHaveCSS(
        'opacity',
        focused ? '0' : scheme === 'dark' ? '0.18' : '0.06',
      );
      const contrast = await background.evaluate((element) => {
        const art = element.firstElementChild;
        const image = art?.querySelector('img');
        if (!art || !image) throw new Error('封面背景未就绪');
        const style = getComputedStyle(element);
        const artStyle = getComputedStyle(art);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法合成背景');
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        context.globalAlpha = Number(artStyle.opacity);
        // 纯色输入去掉模糊，避免一像素边界改变采样。
        context.filter = artStyle.filter.replace(/blur\([^)]*\)/g, '').trim() || 'none';
        context.drawImage(image, 0, 0, 1, 1);
        context.filter = 'none';
        for (const layer of element.querySelectorAll(
          '[data-background-shade], [data-background-inactive]',
        )) {
          const overlay = getComputedStyle(layer);
          context.globalAlpha = Number(overlay.opacity);
          context.fillStyle = overlay.backgroundColor;
          context.fillRect(0, 0, 1, 1);
        }
        const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        context.globalAlpha = 1;
        context.fillStyle = style.getPropertyValue('--text-secondary');
        context.fillRect(0, 0, 1, 1);
        const foreground = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        const luminance = (rgb: number[]) =>
          rgb.reduce((sum, channel, index) => {
            const c = channel / 255;
            return (
              sum +
              (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
                [0.2126, 0.7152, 0.0722][index]
            );
          }, 0);
        const a = luminance(background);
        const b = luminance(foreground);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await checkBackgroundRegions();
    }

    const choosePlayer = async (label: string) => {
      await page.getByRole('combobox', { name: '播放栏位置', exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
    };
    for (const [style, selector] of [
      ['窗口底部', '[data-player-bar]'],
      ['胶囊', '[data-player-capsule]'],
      ['标题栏', 'header [data-now-playing]'],
    ] as const) {
      await choosePlayer(style);
      const bar = page.locator(selector);
      await expect(bar).toBeVisible();
      await expect(bar).toHaveCSS(
        'backdrop-filter',
        style === '胶囊' ? 'blur(24px) saturate(1.1)' : 'none',
      );
      const alpha = await bar.evaluate((element) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法读取表面颜色');
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3] / 255;
      });
      if (style === '胶囊') {
        expect(alpha).toBeCloseTo(0.45, 2);
      } else if (style === '标题栏') {
        expect(alpha).toBeCloseTo(0.65, 2);
      } else expect(alpha).toBe(0);
    }
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator('[data-player-capsule]')).toHaveCSS(
      'backdrop-filter',
      'blur(24px) saturate(1.1)',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('combobox', { name: '窗口背景', exact: true }).click();
    await page.getByRole('option', { name: 'Mica', exact: true }).click();
    await expect(background).toHaveCount(0);
    await expect(pane).toHaveCSS('backdrop-filter', 'none');
    await expect(edge).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('header [data-now-playing]')).toHaveCSS('backdrop-filter', 'none');
    await choosePlayer('窗口底部');
    await expect(page.locator('[data-player-bar]')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    expect(player.errors).toEqual([]);
  });
}

test('图片经 SDK 原子保存，刷新恢复；读取失败保留来源与不透明底', async ({ page }) => {
  const settings = await openSettings(page);
  const url = await imageData(page, '#3466b8');
  const content = url.split(',')[1] ?? '';
  settings.host.answer('dialog.openFile', {
    success: true,
    filePaths: ['D:\\Pictures\\background.png'],
    canceled: false,
  });
  settings.host.answer('file.read', {
    success: true,
    content,
    size: content.length,
    encoding: 'base64',
  });
  settings.host.answer('file.write', { success: true, bytesWritten: content.length });
  await settings.choose('窗口背景', '图片');
  await expect(page.getByRole('button', { name: '选择背景图片', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '选择背景图片', exact: true }).click();
  const image = page.locator('[data-background-image]');
  await expect(image).toHaveCount(1);
  await expect(settings.row('背景图片')).toContainText('background.png');
  expect(settings.host.callsTo('file.write').at(-1)).toMatchObject({
    encoding: 'binary',
    atomic: true,
  });
  await page.reload();
  await expect(image).toHaveCount(1);
  await enterSettings(page);
  await expect(settings.select('窗口背景')).toHaveText('图片');
  await settings.expand('窗口背景');
  settings.host.answer('file.read', hostFailure('NOT_FOUND'));
  await page.getByRole('button', { name: '重新读取背景图片', exact: true }).click();
  await expect(image).toHaveCount(0);
  await expect(settings.row('背景图片')).toContainText('背景图片读取失败');
  await expect(settings.expander('窗口背景').locator(':scope > :first-child')).toContainText(
    '背景图片读取失败',
  );
  await expect(settings.select('窗口背景')).toHaveText('图片');
  expect(
    await page
      .locator('[data-window-background]')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toMatch(/^rgb\(/);
});

test('浅色保留封面染色，连续滑条按层调节，刷新和复位保留分档', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (!localStorage.getItem('default-theme.window-background.v1'))
      localStorage.setItem(
        'default-theme.window-background.v1',
        JSON.stringify({ source: 'cover' }),
      );
  });
  const player = await openPlayer(page);
  await enterSettings(page);
  const choose = async (name: string, option: string) => {
    await page.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('窗口背景', '流动色场');
  await choose('窗口背景', '正在播放的封面');
  const pane = page.locator('main [data-reading-fill]').first();
  const paneColor = () =>
    pane.evaluate((element) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法读取表面颜色');
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
  const colors: number[][] = [];
  for (const fill of ['#0000ff', '#ff0000']) {
    const before = await paneColor();
    const url = await imageData(page, fill);
    player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: 'front',
      path: String(params['path']),
      dataUrl: url,
    }));
    const track = makeTrack({ path: `file://E:/Music/Background/${colors.length}.flac` });
    player.state.track = track;
    await player.host.emit('playback:trackChanged', track);
    await expect.poll(paneColor).not.toEqual(before);
    colors.push(await paneColor());
  }
  expect(
    Math.max(...colors[0].map((channel, index) => Math.abs(channel - colors[1][index]))),
  ).toBeGreaterThan(10);
  const toggle = page
    .locator('[data-settings-expander]')
    .filter({ has: page.getByRole('combobox', { name: '窗口背景', exact: true }) })
    .locator('[data-settings-toggle]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const rails = page.locator('.fui-Slider__rail');
  await expect(rails).toHaveCount(9);
  expect(
    await rails.evaluateAll((elements) =>
      elements.every(
        (element) =>
          getComputedStyle(element, '::before').display === 'none' &&
          getComputedStyle(element).backgroundImage.includes('linear-gradient'),
      ),
    ),
  ).toBe(true);

  const setValue = async (name: string, end: 'Home' | 'End', arrows = 0) => {
    const slider = page.getByRole('slider', { name, exact: true });
    await slider.focus();
    await slider.press(end);
    for (let at = 0; at < arrows; at += 1) await slider.press('ArrowRight');
  };
  await setValue('背景饱和度', 'Home', 1);
  await expect(page.getByRole('slider', { name: '背景饱和度', exact: true })).toHaveValue('1');
  await expect(page.locator('[data-window-background] > div:first-child')).toHaveCSS(
    'filter',
    /saturate\(0\.01\)/,
  );
  await setValue('磨砂模糊', 'End');
  await expect(pane).toHaveCSS('backdrop-filter', 'blur(60px) saturate(1.1)');
  await setValue('磨砂颗粒', 'Home');
  expect(await pane.evaluate((element) => getComputedStyle(element, '::before').opacity)).toBe('0');
  await expect(page.getByRole('slider', { name: '胶囊播放栏不透明度', exact: true })).toHaveCount(
    0,
  );
  await choose('播放栏位置', '胶囊');
  const capsule = page.locator('[data-player-capsule]');
  await expect(capsule).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.1)');
  expect(await capsule.evaluate((element) => getComputedStyle(element, '::before').opacity)).toBe(
    '0.02',
  );
  await choose('颜色模式', '深色');
  await expect(page.getByRole('slider', { name: '背景饱和度', exact: true })).toHaveValue('110');
  await setValue('背景饱和度', 'End');
  await choose('颜色模式', '浅色');
  await expect(page.getByRole('slider', { name: '背景饱和度', exact: true })).toHaveValue('1');
  await page.reload();
  await enterSettings(page);
  await page
    .locator('[data-settings-expander]')
    .filter({ has: page.getByRole('combobox', { name: '窗口背景', exact: true }) })
    .locator('[data-settings-toggle]')
    .click();
  await expect(page.getByRole('slider', { name: '磨砂模糊', exact: true })).toHaveValue('60');
  await page.getByRole('button', { name: '恢复当前模式默认值', exact: true }).click();
  await expect(page.getByRole('slider', { name: '背景饱和度', exact: true })).toHaveValue('130');
  await expect(page.getByRole('slider', { name: '磨砂模糊', exact: true })).toHaveValue('24');
  await expect(page.getByRole('combobox', { name: '窗口背景', exact: true })).toHaveText(
    '正在播放的封面',
  );
  await choose('颜色模式', '深色');
  await expect(page.getByRole('slider', { name: '背景饱和度', exact: true })).toHaveValue('200');
  expect(player.errors).toEqual([]);
});
