import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFolders } from '../fixtures/foldersPage.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { openGenres } from '../fixtures/genresPage.ts';
import { choosePlayerBar, PLAYING_TRACK } from '../fixtures/playerPage.ts';

test.use({ screenshot: 'off' });

async function finish(panel: Locator) {
  await panel.evaluate((node) => node.getAnimations().forEach((animation) => animation.finish()));
}

async function openArea(page: Page, area: string) {
  if (area === 'folders') return openFolders(page);
  if (area === 'artists') return openArtists(page);
  return openGenres(page);
}

for (const [area, label] of [
  ['folders', '目录'],
  ['artists', '艺人列表'],
  ['genres', '流派列表'],
] as const) {
  test(`${area} 窄屏抽屉与右侧共用布局和平移，保持选择与跨档行为`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await choosePlayerBar(page, 'titlebar');
    await page.setViewportSize({ width: 1280, height: 800 });
    const env = await openArea(page, area!);
    await page.setViewportSize({ width: 900, height: 800 });
    const trigger = env.view.getByRole('button', { name: label!, exact: true });
    await expect(trigger).toBeVisible();
    const rightKey = page.locator('[data-right-card-key="queue"]');
    const right = page.locator('[data-form="overlay"]');
    await rightKey.click();
    await expect(right).toBeVisible();
    await finish(right);
    const reference = await right.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        y: box.y,
        height: box.height,
        width: box.width,
        radius: style.borderRadius,
        background: style.backgroundColor,
        shadow: style.boxShadow,
      };
    });
    await rightKey.click();
    await expect(right).toHaveCount(0);

    const drawer = page.locator('[data-library-drawer]');
    const motion = await trigger.evaluate(async (button, name) => {
      if (!(button instanceof HTMLElement)) throw new Error('抽屉入口不可用');
      button.focus();
      button.click();
      await new Promise(requestAnimationFrame);
      const node = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (element) =>
          document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent ===
          name,
      );
      if (!node) throw new Error('抽屉未挂载');
      const animation = node
        .getAnimations()
        .find(
          (entry) =>
            entry.effect instanceof KeyframeEffect &&
            entry.effect.getKeyframes().some((frame) => frame.translate !== undefined),
        );
      if (!animation) throw new Error('抽屉缺少平移动效');
      animation.pause();
      const duration = Number(animation.effect?.getTiming().duration);
      animation.currentTime = 0;
      const startRight = node.getBoundingClientRect().right;
      animation.currentTime = duration * 0.999;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const host = node.offsetParent?.getBoundingClientRect();
      animation.currentTime = duration * 0.4;
      return {
        duration,
        startRight,
        x: box.x,
        y: box.y,
        height: box.height,
        width: box.width,
        hostX: host?.x,
        radius: style.borderRadius,
        background: style.backgroundColor,
        shadow: style.boxShadow,
      };
    }, label!);
    expect(motion.duration).toBe(350);
    expect(motion.startRight).toBeLessThanOrEqual(0);
    expect(motion.hostX).toBeGreaterThan(0);
    expect(motion.x).toBeGreaterThan(motion.hostX!);
    expect(motion.y).toBeCloseTo(reference.y, 1);
    expect(motion.height).toBeCloseTo(reference.height, 1);
    expect(motion.width).toBeCloseTo(reference.width, 1);
    expect(motion.radius).toBe(reference.radius);
    expect(motion.background).toBe(reference.background);
    expect(motion.shadow).toBe(reference.shadow);

    const exit = await drawer.evaluate(async (node) => {
      const before = node.getBoundingClientRect().x;
      node.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')?.click();
      await new Promise(requestAnimationFrame);
      const animation = node.getAnimations()[0];
      if (!animation) throw new Error('抽屉缺少退场动效');
      animation.pause();
      animation.currentTime = 0;
      const after = node.getBoundingClientRect().x;
      animation.currentTime = Number(animation.effect?.getTiming().duration) * 0.999;
      return {
        before,
        after,
        right: node.getBoundingClientRect().right,
        inert: node instanceof HTMLElement && node.inert,
      };
    });
    expect(exit.after).toBeCloseTo(exit.before, 1);
    expect(exit.right).toBeLessThanOrEqual(0);
    expect(exit.inert).toBe(true);
    await finish(drawer);
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 800 });
    await trigger.click();
    await expect(drawer).toBeVisible();
    await finish(drawer);
    const compact = await drawer.boundingBox();
    expect(compact?.x).toBeCloseTo(20, 1);
    expect(compact?.width).toBeCloseTo(350, 1);
    if (area === 'folders') {
      await drawer.getByRole('treeitem').filter({ hasText: 'Alpha' }).click();
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: '关闭目录导航', exact: true }).click();
    } else {
      await drawer
        .locator(area === 'artists' ? '[data-artist="Nujabes"]' : '[data-genre-name="Trip-Hop"]')
        .click();
    }
    await expect(drawer).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(trigger).toHaveCount(0);
    expect(env.errors).toEqual([]);
  });
}

test('艺人抽屉打开的重命名对话框跨档后保留输入', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await openArtists(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await env.view.getByRole('button', { name: '艺人列表', exact: true }).click();
  const drawer = page.locator('[data-library-drawer]');
  await drawer.locator('[data-artist="Nujabes"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名艺人', exact: true });
  const input = rename.getByRole('textbox');
  await input.fill('Nujabes preview');
  await expect(drawer).toHaveCount(1);
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(drawer).toHaveCount(0);
  await expect(input).toHaveValue('Nujabes preview');
  await rename.getByRole('button', { name: '取消', exact: true }).click();
  expect(env.errors).toEqual([]);
});

test('文件夹抽屉避让正在播放的胶囊并随跨档退出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choosePlayerBar(page, 'capsule');
  await page.setViewportSize({ width: 1280, height: 800 });
  const env = await openFolders(page, (host) => {
    host.answer('playback.getState', {
      success: true,
      state: 'playing',
      canSeek: true,
      canPause: true,
    });
    host.answer('playback.getCurrentTrack', { success: true, found: true, track: PLAYING_TRACK });
  });
  await page.setViewportSize({ width: 900, height: 800 });
  await env.view.getByRole('button', { name: '目录', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '目录', exact: true });
  await expect(drawer).toBeVisible();
  const gap = await drawer.evaluate((node) => {
    const host = node instanceof HTMLElement ? node.offsetParent?.getBoundingClientRect() : null;
    return host ? host.bottom - node.getBoundingClientRect().bottom : 0;
  });
  expect(gap).toBeGreaterThanOrEqual(88);
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(drawer).toHaveCount(0);
  await expect(env.view.getByRole('tree', { name: '媒体库目录' })).toBeVisible();
  expect(env.errors).toEqual([]);
});

for (const [area, label] of [
  ['artists', '艺人列表'],
  ['genres', '流派列表'],
] as const) {
  test(`${area} 筛选输入框未处理的 Esc 关闭抽屉并返回入口`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const env = await openArea(page, area);
    await page.setViewportSize({ width: 900, height: 800 });
    const trigger = env.view.getByRole('button', { name: label, exact: true });
    await trigger.click();
    const drawer = page.locator('[data-library-drawer]');
    await drawer.getByRole('textbox').first().focus();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(env.errors).toEqual([]);
  });
}

test('文件夹查找框先处理 Esc，结束查找后才关闭抽屉', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const env = await openFolders(page);
  await page.setViewportSize({ width: 900, height: 800 });
  const trigger = env.view.getByRole('button', { name: '目录', exact: true });
  await trigger.click();
  const drawer = page.locator('[data-library-drawer]');
  await drawer.getByRole('button', { name: '查找音乐所在目录', exact: true }).click();
  const input = drawer.getByRole('textbox', { name: '查找音乐所在目录', exact: true });
  await input.fill('Alpha');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(env.errors).toEqual([]);
});

for (const [area, label] of [
  ['folders', '目录'],
  ['artists', '艺人列表'],
] as const) {
  test(`${area} 抽屉内右键菜单和子菜单不触发外部关闭`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const env = await openArea(page, area);
    await page.setViewportSize({ width: 900, height: 800 });
    await env.view.getByRole('button', { name: label, exact: true }).click();
    const drawer = page.locator('[data-library-drawer]');
    const row =
      area === 'folders'
        ? drawer.getByRole('treeitem').filter({ hasText: 'Alpha' })
        : drawer.locator('[data-artist="Nujabes"]');
    await row.click({ button: 'right' });
    const submenu = page.getByRole('menuitem', { name: '发送到', exact: true });
    await expect(submenu).toBeEnabled();
    await submenu.click();
    await expect(drawer).toHaveJSProperty('inert', false);
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (area === 'folders') {
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '展开目录', exact: true }).click();
      await expect(drawer).toHaveJSProperty('inert', false);
    } else {
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
      const rename = page.getByRole('dialog', { name: '重命名艺人', exact: true });
      await rename.getByRole('textbox').click();
      await expect(drawer).toHaveCount(1);
      await rename.getByRole('button', { name: '取消', exact: true }).click();
      await expect(drawer).toHaveJSProperty('inert', false);
    }
    await page.mouse.click(880, 400);
    await expect(drawer).toHaveCount(0);
    expect(env.errors).toEqual([]);
  });
}
