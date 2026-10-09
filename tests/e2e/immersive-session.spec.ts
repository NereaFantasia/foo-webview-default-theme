import { expect, test } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { spectrumAnswer, waveformAnswer } from '../fixtures/audioAnswers.ts';

for (const fullscreenAtStart of [false, true]) {
  test(`迷你往返保留沉浸会话：进入前全屏=${fullscreenAtStart}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('default-theme.immersive.hostFullscreen.v1', 'on');
    });
    const x = await openPlayer(page);
    x.host.answer('audio.generateFullWaveform', (params) => ({
      success: true,
      status: 'ready',
      cached: false,
      waveform: [0.2, 0.5, 1, 0.4],
      resolution: 1024,
      method: 'rms',
      scale: 'linear',
      signed: false,
      path: String(params['path']),
    }));
    let fullscreen = fullscreenAtStart;
    let refuseRestore = false;
    const bounds = { x: 180, y: 120, width: 1280, height: 800 };
    const emitFullscreen = async (value: boolean) => {
      fullscreen = value;
      await x.host.emit('window:stateChanged', {
        windowId: 'main',
        isMaximized: false,
        maximized: false,
        isMinimized: false,
        minimized: false,
        isActive: true,
        active: true,
        isFullscreen: value,
        fullscreen: value,
      });
    };
    x.host.answer('window.getMode', {
      success: true,
      mode: 'standalone',
      panelMode: false,
      windowId: 'main',
    });
    x.host.answer('window.getState', () => ({
      success: true,
      ...bounds,
      maximized: false,
      minimized: false,
      fullscreen,
      alwaysOnTop: false,
      focused: true,
      isMaximized: false,
      isMinimized: false,
      isFullscreen: fullscreen,
      isAlwaysOnTop: false,
      isFocused: true,
    }));
    x.host.answer('window.isFullscreen', () => ({
      success: true,
      fullscreen,
      isFullscreen: fullscreen,
      windowId: 'main',
    }));
    x.host.answer('window.enterFullscreen', async () => {
      if (fullscreen) return hostFailure('OPERATION_FAILED');
      await emitFullscreen(true);
      return { success: true, isFullscreen: true };
    });
    x.host.answer('window.exitFullscreen', async () => {
      await emitFullscreen(false);
      return { success: true, isFullscreen: false };
    });
    x.host.answer('window.setFullscreen', async (params) => {
      if (refuseRestore) return hostFailure('OPERATION_FAILED');
      await emitFullscreen(params['enabled'] === true);
      return { success: true, fullscreen, windowId: 'main' };
    });
    x.host.answer('window.getBounds', () => ({ success: true, ...bounds }));
    x.host.answer('window.getMinSize', {
      success: true,
      width: 640,
      height: 400,
      windowId: 'main',
    });
    x.host.answer('window.getMaxSize', { success: true, width: 0, height: 0, windowId: 'main' });
    x.host.answer('window.isResizable', { success: true, resizable: true, windowId: 'main' });
    x.host.answer('window.setMinSize', { success: true, windowId: 'main' });
    x.host.answer('window.setMaxSize', { success: true, windowId: 'main' });
    x.host.answer('window.setResizable', { success: true, windowId: 'main' });
    x.host.answer('window.setAlwaysOnTop', { success: true });
    x.host.answer('window.setBounds', { success: true });
    x.host.answer('window.restore', { success: true });
    await page.locator('[data-player-bar] [data-player-key="cover"]').click();
    const view = page.getByRole('region', { name: '正在播放' });
    await expect(view.locator('[data-fullscreen="on"]')).toBeVisible();
    await expect.poll(() => x.calls('audio.generateFullWaveform').length).toBe(1);
    await expect(view.locator('[data-mode="rms"]')).toHaveAttribute('data-status', 'ready');
    await view.evaluate((node) => node.setAttribute('data-session-retained', 'yes'));
    const entering = x.calls('window.enterFullscreen').length;

    for (let round = 0; round < 3; round += 1) {
      // 经保留的播放栏入口调用真实迷你服务，覆盖外部命令切入时的 Activity 清理。
      await page.locator('[data-player-bar] [data-player-key="mini"]').evaluate((node) => {
        if (!(node instanceof HTMLElement)) throw new Error('缺少迷你入口');
        node.click();
      });
      const mini = page.locator('[data-mini-player]');
      await expect(mini).toBeVisible();
      await expect(mini).toHaveAttribute('aria-busy', 'false');
      expect(x.calls('window.exitFullscreen')).toEqual([]);
      expect(x.calls('audio.generateFullWaveform')).toHaveLength(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('F11');
      expect(x.calls('window.enterFullscreen')).toHaveLength(entering);
      expect(x.calls('window.toggleFullscreen')).toEqual([]);

      if (round === 0) {
        refuseRestore = true;
        await mini.getByRole('button', { name: '关闭迷你播放器' }).click();
        await expect(mini).toHaveAttribute('aria-busy', 'false');
        await expect(mini).toBeVisible();
        refuseRestore = false;
      }
      await mini.getByRole('button', { name: '关闭迷你播放器' }).click();
      await expect(mini).toHaveCount(0);
      await expect(view).toBeVisible();
      await expect(view).toHaveAttribute('data-session-retained', 'yes');
      await expect(view.locator('[data-fullscreen="on"]')).toBeVisible();
      await expect(view.locator('[data-mode="rms"]')).toHaveAttribute('data-status', 'ready');
      expect(x.calls('window.enterFullscreen')).toHaveLength(entering);
      expect(x.calls('window.exitFullscreen')).toEqual([]);
    }
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    await expect(page.locator('[data-page="albums"]')).toBeVisible();
    expect(x.calls('window.exitFullscreen')).toHaveLength(fullscreenAtStart ? 0 : 1);
    expect(fullscreen).toBe(fullscreenAtStart);
    expect(x.errors).toEqual([]);
  });
}

test('整轨波形在二十次隐藏恢复中逐次取消，离开后不再恢复取数', async ({ page }) => {
  const x = await openPlayer(page);
  let sequence = 0;
  x.host.answer('audio.generateFullWaveform', (params) => ({
    success: true,
    status: 'pending',
    taskId: `wave-${++sequence}`,
    cached: false,
    resolution: 1024,
    method: 'rms',
    scale: 'linear',
    signed: false,
    path: String(params['path']),
  }));
  x.host.answer('audio.cancelFullWaveform', (params) => ({
    success: true,
    taskId: String(params['taskId']),
    cancelled: true,
  }));
  const visible = (value: boolean) =>
    page.evaluate((show) => {
      if (show) Reflect.deleteProperty(document, 'hidden');
      else Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, value);
  await page.locator('[data-player-bar] [data-player-key="cover"]').click();
  await page.mouse.move(0, 0);
  const view = page.getByRole('region', { name: '正在播放', exact: true });
  await expect(view).toBeVisible();
  for (let round = 0; round < 20; round += 1) {
    await expect.poll(() => x.calls('audio.generateFullWaveform').length).toBe(round + 1);
    await visible(false);
    await expect.poll(() => x.calls('audio.cancelFullWaveform').length).toBe(round + 1);
    expect(x.calls('audio.cancelFullWaveform').at(-1)?.['taskId']).toBe(`wave-${round + 1}`);
    await visible(true);
  }
  await expect.poll(() => x.calls('audio.generateFullWaveform').length).toBe(21);
  await view.getByRole('button', { name: '退出沉浸', exact: true }).click();
  await expect(view).toHaveCount(0);
  await expect.poll(() => x.calls('audio.cancelFullWaveform').length).toBe(21);
  await visible(false);
  await visible(true);
  expect(x.calls('audio.generateFullWaveform')).toHaveLength(21);
  expect(x.errors).toEqual([]);
});

test('二十次隐藏恢复逐次终止山脊 Worker，频谱订阅与实时画布不累积', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('default-theme.immersive.wash.v1', 'off');
    const stats = { created: 0, terminated: 0, active: 0 };
    Reflect.set(window, '__terrainResourceCounts', stats);
    window.Worker = class extends Worker {
      private readonly terrain: boolean;
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.terrain = String(url).includes('terrainWorker');
        if (this.terrain) {
          stats.created += 1;
          stats.active += 1;
        }
      }
      override terminate() {
        if (this.terrain && !this.ended) {
          this.ended = true;
          stats.terminated += 1;
          stats.active -= 1;
        }
        super.terminate();
      }
    };
  });
  const x = await openPlayer(page);
  const subscriptions = new Set<string>();
  x.host.answer('audio.isVisualizationAvailable', { success: true, available: true });
  x.host.answer('audio.subscribeSpectrum', (params) => {
    const subscriptionId = String(params['subscriptionId']);
    subscriptions.add(subscriptionId);
    return {
      success: true,
      subscriptionId,
      event: 'audio:spectrum',
      output: 'bins',
      scale: 'db',
      channels: 'mix',
      fftSize: Number(params['fftSize']),
      fps: 1,
      bands: 48,
      streamReady: true,
      backgroundThrottle: true,
      minFrequency: 20,
      maxFrequency: 24000,
    };
  });
  x.host.answer('audio.unsubscribeSpectrum', (params) => {
    const subscriptionId = String(params['subscriptionId']);
    const removed = subscriptions.delete(subscriptionId) ? 1 : 0;
    return { success: true, subscriptionId, removed };
  });
  let streamTime = 0;
  x.host.answer('audio.getSpectrum', () =>
    spectrumAnswer({
      state: x.state.state,
      streamTime: ++streamTime / 60,
      firstBin: 1,
      sampleRate: 48000,
      fftSize: 1024,
      spectrum: Array.from({ length: 511 }, (_, bin) => -30 - (bin % 12)),
    }),
  );
  x.host.answer('audio.getWaveform', () =>
    waveformAnswer({
      left: [0.2, -0.4, 0.3],
      right: [0.4, -0.2, 0.3],
    }),
  );
  const counts = () =>
    page.evaluate(() => {
      const stats: unknown = Reflect.get(window, '__terrainResourceCounts');
      if (typeof stats !== 'object' || !stats) throw new Error('没有 Worker 计数');
      return {
        created: Number(Reflect.get(stats, 'created')),
        terminated: Number(Reflect.get(stats, 'terminated')),
        active: Number(Reflect.get(stats, 'active')),
      };
    });
  await page.locator('[data-player-bar] [data-player-key="cover"]').click();
  await page.mouse.move(0, 0);
  const view = page.getByRole('region', { name: '正在播放', exact: true });
  await expect(view).toBeVisible();
  for (let round = 0; round < 20; round += 1) {
    await expect.poll(async () => (await counts()).active).toBe(1);
    await expect.poll(() => subscriptions.size).toBe(2);
    await expect.poll(() => x.calls('audio.getWaveform').length).toBeGreaterThan(0);
    if (round === 10) {
      x.state.state = 'paused';
      await x.host.emit('playback:stateChanged', {
        hostTime: Date.now(),
        state: 'paused',
        position: 42,
        duration: 240,
        canSeek: true,
      });
    }
    const cleared = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const realtime = [...document.querySelectorAll('canvas')].filter((canvas) =>
        /(?:bars|trace)_/.test(canvas.className),
      );
      return {
        terrain: document.querySelectorAll('[data-terrain] canvas').length,
        sizes: realtime.map((canvas) => [canvas.width, canvas.height]),
      };
    });
    expect(cleared).toEqual({
      terrain: 0,
      sizes: [
        [0, 0],
        [0, 0],
      ],
    });
    expect(await counts()).toEqual({ created: round + 1, terminated: round + 1, active: 0 });
    await expect.poll(() => subscriptions.size).toBe(0);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await expect.poll(async () => (await counts()).active).toBe(1);
  await expect.poll(() => subscriptions.size).toBe(2);
  await view.getByRole('button', { name: '退出沉浸', exact: true }).click();
  await expect(view).toHaveCount(0);
  expect(await counts()).toEqual({ created: 21, terminated: 21, active: 0 });
  await expect.poll(() => subscriptions.size).toBe(0);
  expect(x.errors).toEqual([]);
});

test('主线程山脊 GPU 删除纹理、程序、缓冲和顶点对象，重复释放不重复删除', async ({ page }) => {
  await openPlayer(page);
  const result = await page.evaluate(async () => {
    const { openTerrainGpu }: typeof import('../../src/immersive/terrain/terrainGpu.ts') =
      await import(new URL('/src/immersive/terrain/terrainGpu.ts', location.href).href);
    const { createSpectrumHistory }: typeof import('../../src/immersive/terrain/terrain.ts') =
      await import(new URL('/src/immersive/terrain/terrain.ts', location.href).href);
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return null;
    const live = new Set<unknown>();
    const created: string[] = [];
    const deleted: string[] = [];
    const tracked = new Proxy(gl, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const output: unknown = Reflect.apply(value, target, args);
          if (typeof key === 'string' && key.startsWith('create') && output) {
            live.add(output);
            created.push(key);
          }
          if (typeof key === 'string' && key.startsWith('delete') && args[0]) {
            live.delete(args[0]);
            deleted.push(key);
          }
          return output;
        };
      },
    });
    try {
      const drawer = openTerrainGpu(
        {
          get width() {
            return canvas.width;
          },
          set width(value) {
            canvas.width = value;
          },
          get height() {
            return canvas.height;
          },
          set height(value) {
            canvas.height = value;
          },
          getContext: () => tracked,
        },
        () => {},
      );
      if (!drawer) return null;
      drawer.resize(200, 100, 1);
      const history = createSpectrumHistory(4, 8);
      history.push(new Float32Array(8).fill(0.5));
      drawer.draw(history, { width: 200, height: 100, horizon: 50, lineColor: 'red' });
      const before = live.size;
      drawer.dispose?.();
      const after = live.size;
      const released = deleted.length;
      drawer.dispose?.();
      return { before, after, released, repeated: deleted.length, created, deleted };
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  });
  test.skip(result === null, '浏览器不支持山脊图所需的 WebGL2 扩展');
  expect(result?.before).toBeGreaterThan(0);
  expect(result?.after).toBe(0);
  expect(result?.repeated).toBe(result?.released);
  for (const resource of ['Shader', 'Program', 'Texture', 'Framebuffer', 'Buffer', 'VertexArray']) {
    expect(
      result?.created.filter((method) => method === `create${resource}`).length,
    ).toBeGreaterThan(0);
    expect(result?.deleted.filter((method) => method === `delete${resource}`).length).toBe(
      result?.created.filter((method) => method === `create${resource}`).length,
    );
  }
});
