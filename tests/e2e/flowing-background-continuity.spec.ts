import { expect, test, type Page } from '@playwright/test';
import { openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

interface FlowStats {
  readonly textures: number;
  readonly uploads: number;
  readonly paintedUploads: number;
  readonly reads: number;
  readonly frames: readonly number[][];
}

async function instrument(page: Page, reduced: boolean, scheme: 'light' | 'dark' = 'dark') {
  await page.emulateMedia({
    colorScheme: scheme,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({ source: 'palette' }),
    );
    const textures = new Set<WebGLTexture>();
    let uploads = 0,
      paintedUploads = 0,
      reads = 0;
    const frames: number[][] = [];
    const isField = (gl: WebGL2RenderingContext) =>
      gl.canvas instanceof HTMLCanvasElement && gl.canvas.hasAttribute('data-palette-field');
    const create = WebGL2RenderingContext.prototype.createTexture;
    const remove = WebGL2RenderingContext.prototype.deleteTexture;
    WebGL2RenderingContext.prototype.createTexture = function () {
      const texture = create.call(this);
      if (texture && isField(this)) textures.add(texture);
      return texture;
    };
    WebGL2RenderingContext.prototype.deleteTexture = function (texture) {
      if (texture) textures.delete(texture);
      remove.call(this, texture);
    };
    WebGL2RenderingContext.prototype.texImage2D = new Proxy(
      WebGL2RenderingContext.prototype.texImage2D,
      {
        apply(target, gl: WebGL2RenderingContext, args: unknown[]) {
          if (isField(gl) && args.length === 6) uploads++;
          return Reflect.apply(target, gl, args);
        },
      },
    );
    window.fetch = new Proxy(window.fetch, {
      apply(target, context: typeof window, args: unknown[]) {
        if (String(args[0]).includes('/flow-cover-')) reads++;
        return Reflect.apply(target, context, args);
      },
    });
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
      draw.call(this, mode, first, count);
      if (!isField(this) || this.getParameter(this.FRAMEBUFFER_BINDING) !== null) return;
      const sample: number[] = [];
      const pixel = new Uint8Array(4);
      for (const y of [64, 256, 448])
        for (const x of [64, 256, 448]) {
          this.readPixels(x, 511 - y, 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
          sample.push(...pixel.slice(0, 3));
        }
      frames.push(sample);
      paintedUploads = uploads;
      if (frames.length > 180) frames.shift();
    };
    let visible = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
    Reflect.set(window, '__flowVisibility', (next: boolean) => {
      visible = next;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Reflect.set(window, '__flowStats', (reset: boolean) => {
      const result = {
        textures: textures.size,
        uploads,
        paintedUploads,
        reads,
        frames: [...frames],
      };
      if (reset) frames.length = 0;
      return result;
    });
  });
}

async function stats(page: Page, reset = false): Promise<FlowStats> {
  return page.evaluate((clear) => {
    const read: unknown = Reflect.get(window, '__flowStats');
    if (typeof read !== 'function') throw new Error('缺少绘制记录');
    return read(clear);
  }, reset);
}

async function artwork(page: Page, patterned = false) {
  const data = await page.evaluate((pattern) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成封面');
    context.fillStyle = '#e82836';
    context.fillRect(0, 0, 128, 128);
    if (pattern) {
      context.fillStyle = '#e8ce28';
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = '#643ddb';
      context.fillRect(64, 64, 64, 64);
    }
    return canvas.toDataURL().split(',')[1];
  }, patterned);
  return Buffer.from(data, 'base64');
}

async function changeCover(player: PlayerPage, url: string, title: string) {
  player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: url,
  }));
  const track = makeTrack({ path: `file://E:/Music/Flow/${title}.flac`, title });
  player.state.track = track;
  await player.host.emit('playback:trackChanged', track);
}

const luminance = (rgb: readonly number[]) =>
  rgb.reduce((sum, channel, index) => {
    const c = channel / 255;
    return (
      sum +
      (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
    );
  }, 0);

async function secondaryLuminance(page: Page) {
  const rgb = await page.locator('[data-window-background]').evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取前景色');
    context.fillStyle = getComputedStyle(element).getPropertyValue('--text-secondary');
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
  return luminance(rgb);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`${scheme} 停止和缺图时淡出到中性底，暂停仍流动且恢复不复活强调色`, async ({ page }) => {
    await instrument(page, false, scheme);
    await page.addInitScript(() => {
      localStorage.setItem(
        'default-theme.base-accent.v1',
        JSON.stringify({ mode: 'custom', custom: '#0066ff', windows: null }),
      );
    });
    const player = await openPlayer(page, { state: { state: 'stopped', track: null } });
    const field = page.locator('[data-palette-field]');
    const background = page.locator('[data-window-background="palette"]');
    await expect(background).toHaveCSS('opacity', '1');
    await expect(field).toHaveCSS('opacity', '0');
    const neutral = async () => {
      for (const area of [background, page.locator('main [data-reading-fill]').first()]) {
        const rgba = await area.evaluate((element) => {
          const probe = document.createElement('canvas');
          probe.width = probe.height = 1;
          const context = probe.getContext('2d');
          if (!context) throw new Error('无法读取背景颜色');
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        });
        expect(Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3))).toBeLessThan(2);
        if (scheme === 'dark') expect(rgba[0]).toBeLessThan(45);
        else expect(rgba[0]).toBeGreaterThan(240);
      }
    };
    await neutral();
    const body = await artwork(page, true);
    await page.route('**/flow-cover-rest.png', (route) =>
      route.fulfill({ contentType: 'image/png', body }),
    );
    player.state.state = 'playing';
    await changeCover(player, '/flow-cover-rest.png', 'rest-start');
    await player.host.emit('playback:stateChanged', {
      state: 'playing',
      position: 0,
      duration: 240,
      canSeek: true,
      hostTime: Date.now(),
    });
    await expect(field).toHaveCSS('opacity', '1');
    player.state.state = 'paused';
    await player.host.emit('playback:paused', { paused: true });
    const paused = (await stats(page)).frames.at(-1);
    await expect.poll(async () => (await stats(page)).frames.at(-1)).not.toEqual(paused);
    await expect(field).toHaveCSS('opacity', '1');
    const fade = field.evaluate(
      (element) =>
        new Promise<number>((resolve) => {
          const observe = () => {
            const animation = element
              .getAnimations()
              .find(
                (entry) => entry instanceof CSSTransition && entry.transitionProperty === 'opacity',
              );
            if (!animation) {
              requestAnimationFrame(observe);
              return;
            }
            animation.pause();
            animation.currentTime = 41.5;
            Reflect.set(window, '__neutralFade', animation);
            resolve(Number(getComputedStyle(element).opacity));
          };
          requestAnimationFrame(observe);
        }),
    );
    player.state.state = 'stopped';
    player.state.track = null;
    await player.host.emit('playback:stopped', { reason: 'user' });
    expect(await fade).toBeCloseTo(0.5, 2);
    await page.evaluate(() => {
      const animation: unknown = Reflect.get(window, '__neutralFade');
      if (animation instanceof Animation) animation.finish();
    });
    await expect(field).toHaveCSS('opacity', '0');
    await neutral();
    await stats(page, true);
    await page.waitForTimeout(200);
    expect((await stats(page)).frames).toHaveLength(0);
    await page.evaluate(() => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(false);
    });
    await expect(page.locator('[data-flow-preview]')).toHaveCount(0);
    await page.evaluate(() => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(true);
    });
    await expect(field).toHaveCSS('opacity', '0');
    player.state.state = 'playing';
    await changeCover(player, '/flow-cover-rest.png', 'rest-resume');
    await player.host.emit('playback:stateChanged', {
      state: 'playing',
      position: 0,
      duration: 240,
      canSeek: true,
      hostTime: Date.now(),
    });
    await expect(field).toHaveCSS('opacity', '1');
    expect(player.errors).toEqual([]);
    await page.evaluate(() => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(false);
    });
    await expect(page.locator('[data-flow-preview]')).toHaveCount(1);
    player.state.state = 'stopped';
    player.state.track = null;
    await player.host.emit('playback:stopped', { reason: 'user' });
    await expect(page.locator('[data-flow-preview]')).toHaveCount(0);
    await page.evaluate(() => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(true);
    });
    await expect(field).toHaveCSS('opacity', '0');
    player.state.state = 'playing';
    await changeCover(player, '/flow-cover-rest.png', 'rest-hidden-resume');
    await player.host.emit('playback:stateChanged', {
      state: 'playing',
      position: 0,
      duration: 240,
      canSeek: true,
      hostTime: Date.now(),
    });
    await expect(field).toHaveCSS('opacity', '1');
    await page.route('**/flow-cover-failed.png', (route) =>
      route.fulfill({ status: 404, body: '' }),
    );
    await changeCover(player, '/flow-cover-failed.png', 'rest-failed');
    await expect(field).toHaveCSS('opacity', '0');
    await neutral();
    // 故意返回404时浏览器会记录资源错误，其他异常仍判失败。
    expect(player.errors.length).toBeGreaterThan(0);
    expect(
      player.errors.filter(
        (message) =>
          message !==
          'Failed to load resource: the server responded with a status of 404 (Not Found)',
      ),
    ).toEqual([]);
  });
}

test('浅色保留冷暖差异与明亮无彩底，切换主题只换呈色而不重取封面', async ({ page }) => {
  await instrument(page, true, 'light');
  const player = await openPlayer(page);
  const foreground = await secondaryLuminance(page);
  const colors: number[][] = [];
  for (const [index, color] of ['#ff7f00', '#2f75dc', '#000000', '#808080', '#ffffff'].entries()) {
    const url = await page.evaluate((fill) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法生成封面');
      context.fillStyle = fill;
      context.fillRect(0, 0, 64, 64);
      return canvas.toDataURL();
    }, color);
    const uploads = (await stats(page)).uploads;
    await changeCover(player, url, `light-${index}`);
    await expect.poll(async () => (await stats(page)).paintedUploads).toBeGreaterThan(uploads);
    const rgb = (await stats(page)).frames.at(-1)?.slice(0, 3);
    if (!rgb) throw new Error('背景尚未绘制');
    expect((luminance(rgb) + 0.05) / (foreground + 0.05)).toBeGreaterThanOrEqual(4.5);
    if (index >= 2) {
      expect(Math.min(...rgb)).toBeGreaterThan(240);
      expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThan(2);
    }
    colors.push(rgb);
  }
  expect(colors[0][0] - colors[0][2]).toBeGreaterThan(20);
  expect(colors[1][2] - colors[1][0]).toBeGreaterThan(15);
  const before = await stats(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await stats(page)).frames.at(-1)?.[0] ?? 255).toBeLessThan(2);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(async () => (await stats(page)).frames.at(-1)?.slice(0, 3))
    .toEqual(colors.at(-1));
  const after = await stats(page);
  expect(after.uploads).toBe(before.uploads);
  expect(after.textures).toBe(8);
  await expect(page.locator('[data-background-shade]')).toHaveCSS('opacity', '0');
  expect(player.errors).toEqual([]);
});

test('浅彩输出持续流动并保持文字对比，隐藏换主题后首帧使用当前呈色', async ({ page }) => {
  await instrument(page, false, 'light');
  const player = await openPlayer(page);
  const body = await artwork(page, true);
  await page.route('**/flow-cover-light-pattern.png', (route) =>
    route.fulfill({ contentType: 'image/png', body }),
  );
  await changeCover(player, '/flow-cover-light-pattern.png', 'light-pattern');
  await expect.poll(async () => (await stats(page)).paintedUploads).toBeGreaterThan(0);
  const foreground = await secondaryLuminance(page);
  await stats(page, true);
  await page.waitForTimeout(1200);
  const active = await stats(page);
  expect(active.frames.length).toBeGreaterThan(3);
  const first = active.frames[0];
  expect(
    Math.max(
      ...active.frames.flatMap((frame) =>
        frame.map((value, index) => Math.abs(value - first[index])),
      ),
    ),
  ).toBeGreaterThan(3);
  for (const frame of active.frames)
    for (let at = 0; at < frame.length; at += 3)
      expect(
        (luminance(frame.slice(at, at + 3)) + 0.05) / (foreground + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
  await page.evaluate(() => {
    const change = Reflect.get(window, '__flowVisibility');
    if (typeof change === 'function') change(false);
  });
  await expect(page.locator('[data-palette-field]')).toHaveCount(0);
  await expect(page.locator('[data-flow-preview]')).toHaveCount(1);
  expect((await stats(page)).textures).toBe(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('[data-window-background]')).toHaveAttribute('data-scheme', 'dark');
  await expect(page.locator('[data-flow-preview]')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('[data-window-background]')).toHaveAttribute('data-scheme', 'light');
  const sleeping = await stats(page, true);
  await page.evaluate(() => {
    const change = Reflect.get(window, '__flowVisibility');
    if (typeof change === 'function') change(true);
  });
  await expect(page.locator('[data-palette-field]')).toBeVisible();
  const resumed = await stats(page);
  expect(resumed.reads).toBe(sleeping.reads);
  expect(resumed.textures).toBe(8);
  expect(resumed.frames.length).toBeGreaterThan(0);
  expect(
    (luminance(resumed.frames[0].slice(0, 3)) + 0.05) / (foreground + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  expect(player.errors).toEqual([]);
});

test('同封面换曲与短暂停止不闪基础色，解码期间继续保留上一幅', async ({ page }) => {
  await instrument(page, false);
  const player = await openPlayer(page);
  const body = await artwork(page);
  let resolve = () => {};
  const delayed = new Promise<void>((done) => {
    resolve = done;
  });
  await page.route('**/flow-cover-*.png', async (route) => {
    if (route.request().url().endsWith('second.png')) await delayed;
    await route.fulfill({ contentType: 'image/png', body });
  });
  await changeCover(player, '/flow-cover-first.png', 'first');
  await expect.poll(async () => (await stats(page)).uploads).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const frame = (await stats(page)).frames.at(-1);
      return frame ? frame[0] - frame[1] : 0;
    })
    .toBeGreaterThan(80);
  const baseline = await stats(page, true);
  player.state.state = 'stopped';
  await player.host.emit('playback:stateChanged', {
    state: 'stopped',
    position: 0,
    duration: 240,
    canSeek: false,
    hostTime: Date.now(),
  });
  await page.waitForTimeout(80);
  player.state.state = 'playing';
  await player.host.emit('playback:stateChanged', {
    state: 'playing',
    position: 0,
    duration: 240,
    canSeek: true,
    hostTime: Date.now(),
  });
  await changeCover(player, '/flow-cover-second.png', 'second');
  await expect.poll(async () => (await stats(page)).reads).toBeGreaterThan(baseline.reads);
  await page.waitForTimeout(350);
  expect((await stats(page)).uploads).toBe(baseline.uploads);
  resolve();
  await expect(page.locator('[data-player-bar] img').first()).toHaveAttribute(
    'src',
    '/flow-cover-second.png',
  );
  await page.waitForTimeout(350);
  const after = await stats(page);
  expect(after.uploads).toBe(baseline.uploads);
  expect(after.frames.length).toBeGreaterThan(3);
  expect(after.frames.every((frame) => frame[0] > frame[1] + 80)).toBe(true);
  await expect(page.locator('[data-background-shade]')).toHaveCSS('opacity', '0');
  expect(player.errors).toEqual([]);
});

test('无白色的暖色封面保留色相，同时限制亮度和过度饱和', async ({ page }) => {
  await instrument(page, true);
  const player = await openPlayer(page);
  for (const [index, color] of ['#f0912d', '#b96428', '#ff7f00', '#dca514'].entries()) {
    const url = await page.evaluate((fill) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法生成暖色封面');
      context.fillStyle = fill;
      context.fillRect(0, 0, 64, 64);
      return canvas.toDataURL();
    }, color);
    const uploads = (await stats(page, true)).uploads;
    await changeCover(player, url, `warm-${index}`);
    await expect.poll(async () => (await stats(page)).uploads).toBeGreaterThan(uploads);
    await expect.poll(async () => (await stats(page)).paintedUploads).toBeGreaterThan(uploads);
    await expect.poll(async () => (await stats(page)).frames.length).toBeGreaterThan(0);
    const frame = (await stats(page)).frames.at(-1);
    if (!frame) throw new Error('背景尚未绘制');
    const [red, green, blue] = frame;
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    expect(red).toBeGreaterThan(70);
    expect(red).toBeLessThan(160);
    expect((red - blue) / red).toBeLessThan(0.9);
  }
  expect(player.errors).toEqual([]);
});

test('退出沉浸直接接上缓存封面，休眠预览方向正确且回收整套纹理', async ({ page }) => {
  await instrument(page, true);
  const player = await openPlayer(page);
  const body = await artwork(page, true);
  await page.route('**/flow-cover-pattern.png', (route) =>
    route.fulfill({ contentType: 'image/png', body }),
  );
  await changeCover(player, '/flow-cover-pattern.png', 'pattern');
  await expect.poll(async () => (await stats(page)).uploads).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  const before = await stats(page);
  const last = before.frames.at(-1);
  if (!last) throw new Error('背景尚未绘制');
  await page.locator('[data-player-bar] [data-player-key="immersive"]').click();
  await expect(page.getByRole('region', { name: '正在播放' })).toBeVisible();
  await expect(page.locator('[data-palette-field]')).toHaveCount(0);
  expect((await stats(page)).textures).toBe(0);
  const preview = page.locator('[data-flow-preview]');
  await expect(preview).toHaveCount(1);
  const samples = await preview.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('缺少静态预览');
    const result: number[] = [];
    for (const y of [32, 128, 224])
      for (const x of [32, 128, 224])
        result.push(...context.getImageData(x, y, 1, 1).data.slice(0, 3));
    return result;
  });
  expect(Math.max(...samples.map((value, index) => Math.abs(value - last[index])))).toBeLessThan(8);
  const sleeping = await stats(page, true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '正在播放' })).toHaveCount(0);
  await expect(page.locator('[data-palette-field]')).toBeVisible();
  await expect(preview).toHaveCount(0);
  const resumed = await stats(page);
  expect(resumed.textures).toBe(8);
  expect(resumed.reads).toBe(sleeping.reads);
  expect(resumed.frames.length).toBeGreaterThan(0);
  expect(
    resumed.frames.every((frame) => frame.every((value, index) => value === last[index])),
  ).toBe(true);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(false);
    });
    await expect(page.locator('[data-palette-field]')).toHaveCount(0);
    expect((await stats(page)).textures).toBe(0);
    await page.evaluate(() => {
      const change = Reflect.get(window, '__flowVisibility');
      if (typeof change === 'function') change(true);
    });
    await expect(page.locator('[data-palette-field]')).toBeVisible();
    expect((await stats(page)).textures).toBe(8);
  }
  expect(player.errors).toEqual([]);
});
