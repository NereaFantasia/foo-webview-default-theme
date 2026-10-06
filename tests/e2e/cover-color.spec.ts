import { expect, test } from '@playwright/test';
import { openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';

test('真实 Worker 完成解码与取色，重复输入稳定且不改变主线程随机源', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/theme/coverColor.ts';
    const { seedFromUrl }: typeof import('../../src/theme/coverColor.ts') = await import(moduleUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    const random = Math.random;
    const image = context.createImageData(64, 64);
    for (let at = 0; at < image.data.length; at += 1) {
      image.data[at] = at % 4 === 3 ? 255 : (Math.imul(at, 31) + (at >> 4)) % 256;
    }
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL();
    const first = await seedFromUrl(url);
    const second = await seedFromUrl(url);
    context.fillStyle = '#808080';
    context.fillRect(0, 0, 64, 64);
    const gray = await seedFromUrl(canvas.toDataURL());
    context.fillStyle = '#ffff00';
    context.fillRect(0, 0, 64, 64);
    const yellow = await seedFromUrl(canvas.toDataURL());
    return { first, second, gray, yellow, unchanged: random === Math.random };
  });
  expect(result.first).not.toBeNull();
  expect(result.second).toEqual(result.first);
  expect(result.gray).toBeNull();
  expect(result.yellow?.chroma).toBeGreaterThan(8);
  expect(result.unchanged).toBe(true);
});

test('共享缓存跨地址复用真实分析档案，灰图仍保留背景主色', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/covers/coverAnalysis.ts';
    const { createCoverAnalysis }: typeof import('../../src/covers/coverAnalysis.ts') =
      await import(moduleUrl);
    const service = createCoverAnalysis();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.fillStyle = '#285ac8';
    context.fillRect(0, 0, 64, 64);
    const dataUrl = canvas.toDataURL();
    const blob = await (await fetch(dataUrl)).blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      const pending = service.read(dataUrl);
      const merged = pending === service.read(dataUrl);
      const first = await pending;
      const second = await service.read(blobUrl);
      context.fillStyle = '#808080';
      context.fillRect(0, 0, 64, 64);
      const gray = await service.read(canvas.toDataURL());
      return { merged, reused: first === second, first, gray };
    } finally {
      service.dispose();
      URL.revokeObjectURL(blobUrl);
    }
  });
  expect(result.merged).toBe(true);
  expect(result.reused).toBe(true);
  expect(result.first?.accent).not.toBeNull();
  expect(result.gray?.accent).toBeNull();
  expect(result.gray?.dominant).not.toBeNull();
  expect(result.gray?.gray).toBe(true);
  expect(result.gray?.lightness?.mean).toBeGreaterThan(50);
});

test('不进入沉浸页也跟随换曲；刷新首帧恢复，确认停止后才清缓存', async ({ page }) => {
  const player = await openPlayer(page);
  const root = page.locator('#root > .fui-FluentProvider');
  const accent = () =>
    root.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--colorBrandForeground1').trim(),
    );
  const base = await accent();
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.fillStyle = '#d02030';
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL();
  });
  const track = makeTrack({ path: 'file://E:/Music/Color/current.flac', title: 'Current color' });
  player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: url,
  }));
  player.state.track = track;
  await player.host.emit('playback:trackChanged', track);
  await expect.poll(accent).not.toBe(base);
  const colored = await accent();
  await enterSettings(page);
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '外观', exact: true })
    .click();
  await page.getByRole('button', { name: '强调色', exact: true, expanded: false }).click();
  const follow = page.getByRole('switch', { name: '跟随正在播放的封面颜色', exact: true });
  await expect(follow).toBeChecked();
  await follow.uncheck();
  await expect.poll(accent).toBe(base);
  expect(await page.evaluate(() => localStorage.getItem('default-theme.cover-accent.v1'))).toBe(
    'off',
  );
  await follow.check();
  await expect.poll(accent).toBe(colored);
  const held = player.host.hold('playback.getCurrentTrack');
  await page.addInitScript(() => {
    const read = () => {
      const root = document.querySelector('#root > .fui-FluentProvider');
      const value =
        root && getComputedStyle(root).getPropertyValue('--colorBrandForeground1').trim();
      if (value) Reflect.set(window, '__firstColor', value);
      else requestAnimationFrame(read);
    };
    requestAnimationFrame(read);
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__firstColor'))).toBe(colored);
  await expect.poll(() => held.pending.length).toBeGreaterThan(0);
  expect(await accent()).toBe(colored);
  held.respond(0, { success: true, found: false });
  await expect.poll(accent).toBe(base);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = localStorage.getItem('default-theme.cover-profile.v1');
        return saved ? JSON.parse(saved).profile : 'missing';
      }),
    )
    .toBeNull();
  held.release();
});
