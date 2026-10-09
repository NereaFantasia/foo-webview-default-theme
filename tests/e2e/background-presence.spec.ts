import { expect, test, type Page } from '@playwright/test';
import { openPlayer } from '../fixtures/playerPage.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

async function choose(page: Page, label: string) {
  await page.getByRole('combobox', { name: '窗口背景', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
async function finishFade(page: Page) {
  await page.evaluate(() => {
    const animation: unknown = Reflect.get(window, '__backgroundFade');
    if (animation instanceof Animation) animation.finish();
  });
}
async function textures(page: Page): Promise<number> {
  return page.evaluate(() => {
    const read: unknown = Reflect.get(window, '__backgroundTextures');
    return typeof read === 'function' ? read() : -1;
  });
}
async function prepare(page: Page) {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem(
      'default-theme.window-background.v1',
      JSON.stringify({ source: 'palette' }),
    );
    const live = new Set<WebGLTexture>();
    const create = WebGL2RenderingContext.prototype.createTexture;
    const remove = WebGL2RenderingContext.prototype.deleteTexture;
    WebGL2RenderingContext.prototype.createTexture = function () {
      const result = create.call(this);
      if (
        result &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.hasAttribute('data-palette-field')
      )
        live.add(result);
      return result;
    };
    WebGL2RenderingContext.prototype.deleteTexture = function (texture) {
      if (texture) live.delete(texture);
      remove.call(this, texture);
    };
    Reflect.set(window, '__backgroundTextures', () => live.size);
  });
  const player = await openPlayer(page);
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成背景封面');
    context.fillStyle = '#c6482f';
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL();
  });
  player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: url,
  }));
  const track = makeTrack({ path: 'file://E:/Music/Flow/presence.flac', title: 'Presence' });
  player.state.track = track;
  await player.host.emit('playback:trackChanged', track);
  await enterSettings(page);
  await expect(page.locator('[data-background-pending]')).toHaveCount(0);
  await expect(page.locator('[data-palette-field]')).toBeVisible();
  return player;
}
async function holdFades(page: Page) {
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.hasAttribute('data-background-source')) {
        animation.pause();
        animation.currentTime = 41.5;
        Reflect.set(window, '__backgroundFade', animation);
      }
      return animation;
    };
  });
}

test('背景来源双向淡变，色场退场保留预览并立即释放GPU', async ({ page }) => {
  const player = await prepare(page);
  await choose(page, '正在播放的封面');
  await expect(page.locator('[data-background-leaving]')).toHaveCount(0);
  const image = page.locator('[data-window-background="cover"]');
  await expect(image.locator('[data-background-image]')).toBeVisible();
  const filter = await image
    .locator(':scope > div')
    .first()
    .evaluate((element) => getComputedStyle(element).filter);
  await holdFades(page);
  await choose(page, '流动色场');
  const field = page.locator('[data-window-background="palette"]');
  await expect(field).toHaveCSS('opacity', '0.5');
  const retiring = page.locator('[data-background-leaving]');
  await expect(retiring).toHaveAttribute('data-background-source', 'cover');
  await expect(retiring).toHaveCSS('opacity', '1');
  await expect(retiring.locator(':scope > div').first()).toHaveCSS('filter', filter);
  expect(await textures(page)).toBe(8);
  await finishFade(page);
  await expect(retiring).toHaveCount(0);
  await expect(field).toHaveCSS('opacity', '1');

  await choose(page, '正在播放的封面');
  await expect(image).toHaveCSS('opacity', '0.5');
  await expect(retiring).toHaveAttribute('data-background-source', 'palette');
  await expect(retiring.locator('[data-flow-preview]')).toHaveCount(1);
  await expect(page.locator('[data-palette-field]')).toHaveCount(0);
  expect(await textures(page)).toBe(0);
  await finishFade(page);
  await expect(retiring).toHaveCount(0);

  await choose(page, 'Mica');
  await expect(retiring).toHaveCSS('opacity', '0.5');
  await expect(page.locator('[data-background-source="material"]')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await finishFade(page);
  await expect(retiring).toHaveCount(0);
  await expect(page.locator('[data-window-background]')).toHaveCount(0);
  await choose(page, '流动色场');
  await expect(field).toHaveCSS('opacity', '0.5');
  await finishFade(page);
  await expect(field).toHaveCSS('opacity', '1');
  expect(player.errors).toEqual([]);
});

test('等待目标封面时保持原画面，取消后迟到解码不能复活；减弱动效直接交接', async ({ page }) => {
  const player = await prepare(page);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    const releases: (() => void)[] = [];
    HTMLImageElement.prototype.decode = function () {
      return decode.call(this).then(() => new Promise<void>((resolve) => releases.push(resolve)));
    };
    Reflect.set(window, '__releaseBackgroundImages', () =>
      releases.splice(0).forEach((resolve) => resolve()),
    );
  });
  await choose(page, '正在播放的封面');
  await expect(page.locator('[data-window-background="cover"]')).toHaveCSS('opacity', '0');
  await expect(page.locator('[data-background-leaving]')).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-flow-preview]')).toHaveCount(1);
  expect(await textures(page)).toBe(0);
  await choose(page, '流动色场');
  await expect(page.locator('[data-background-source]')).toHaveCount(1);
  await expect(page.locator('[data-window-background="palette"]')).toHaveCSS('opacity', '1');
  await page.evaluate(() => {
    const release = Reflect.get(window, '__releaseBackgroundImages');
    if (typeof release === 'function') release();
  });
  await expect(page.locator('[data-background-source="cover"]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choose(page, 'Mica');
  await expect(page.locator('[data-background-leaving]')).toHaveCount(0);
  await choose(page, '流动色场');
  const field = page.locator('[data-window-background="palette"]');
  await expect(field).toHaveCSS('opacity', '1');
  expect(await field.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(await textures(page)).toBe(8);
  expect(player.errors).toEqual([]);
});

test('淡变途中快速选择只交接到最后一项，最多两层且旧资源不累积', async ({ page }) => {
  const player = await prepare(page);
  await holdFades(page);
  await choose(page, '正在播放的封面');
  await expect(page.locator('[data-window-background="cover"]')).toHaveCSS('opacity', '0.5');
  await choose(page, 'Mica');
  await choose(page, '流动色场');
  await expect(page.locator('[data-background-source]')).toHaveCount(2);
  await expect(page.locator('[data-window-background="cover"]')).toHaveCSS('opacity', '0.5');
  await finishFade(page);
  await expect(page.locator('[data-window-background="palette"]')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('[data-background-source]')).toHaveCount(2);
  await expect(page.locator('[data-background-source="material"]')).toHaveCount(0);
  await finishFade(page);
  await expect(page.locator('[data-background-source]')).toHaveCount(1);
  expect(await textures(page)).toBe(8);
  await expect(page.locator('[data-flow-preview]')).toHaveCount(0);
  expect(player.errors).toEqual([]);
});
