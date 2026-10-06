import { expect, test, type Page } from '@playwright/test';
import { openSettings, enterSettings } from '../fixtures/settingsPage.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

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

for (const scheme of ['light', 'dark'] as const) {
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
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(background).toHaveCSS(
      'filter',
      scheme === 'dark' ? 'brightness(0.82)' : 'brightness(0.94)',
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

test('封面背景换曲、缺图与停止回退不改来源；色场暂停与减弱动效静止', async ({ page }) => {
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
  const pixels = () => field.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const first = await pixels();
  await expect.poll(pixels).not.toBe(first);
  player.state.state = 'paused';
  await player.host.emit('playback:paused', { paused: true });
  await page.waitForTimeout(150);
  const paused = await pixels();
  await page.waitForTimeout(250);
  expect(await pixels()).toBe(paused);
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
