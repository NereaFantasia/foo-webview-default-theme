import { expect, test, type Locator } from '@playwright/test';
import { openPlayer } from '../fixtures/playerPage.ts';

test.use({ screenshot: 'off' });

async function openHalfway(trigger: Locator, selector: string) {
  return trigger.evaluate(async (button, target) => {
    if (!(button instanceof HTMLElement)) throw new Error('浮层入口不可用');
    button.focus();
    button.click();
    await new Promise(requestAnimationFrame);
    const panel = document.querySelector<HTMLElement>(target);
    if (!panel) throw new Error('浮层未挂载');
    const animation = panel
      .getAnimations()
      .find(
        (entry) =>
          entry.effect instanceof KeyframeEffect &&
          entry.effect.getKeyframes().some((frame) => frame.translate !== undefined),
      );
    if (!animation) throw new Error('浮层没有整张平移的入场动效');
    const duration = Number(animation.effect?.getTiming().duration);
    animation.pause();
    const sample = (portion: number) => {
      animation.currentTime = duration * portion;
      const rect = panel.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const start = sample(0);
    // 不寻到精确终点，避免完成回调撤去动画后无法继续检查途中反向。
    const end = sample(0.999);
    const middle = sample(0.4);
    const host = panel.offsetParent?.getBoundingClientRect();
    return {
      start,
      middle,
      end,
      host: host ? { x: host.x, right: host.right } : null,
      duration,
      clip: getComputedStyle(panel).clipPath,
    };
  }, selector);
}

async function finish(panel: Locator) {
  await panel.evaluate((node) => node.getAnimations().forEach((animation) => animation.finish()));
}

async function closeToEdge(trigger: Locator, selector: string) {
  return trigger.evaluate(async (button, target) => {
    if (!(button instanceof HTMLElement)) throw new Error('缺少浮层入口');
    const panel = document.querySelector<HTMLElement>(target);
    if (!panel) throw new Error('浮层已提前卸载');
    const before = panel.getBoundingClientRect().x;
    button.click();
    await new Promise(requestAnimationFrame);
    const animations = panel.getAnimations();
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    const after = panel.getBoundingClientRect().x;
    const samples = [0.25, 0.5, 0.75, 0.999].map((portion) => {
      for (const animation of animations) {
        animation.currentTime = Number(animation.effect?.getTiming().duration) * portion;
      }
      const rect = panel.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    const rail = document.querySelector('[data-sidebar-rail]');
    return {
      before,
      after,
      samples,
      inert: panel.inert,
      rail: rail ? getComputedStyle(rail).visibility : null,
    };
  }, selector);
}

for (const width of [900, 390]) {
  test(`${width}px 左右浮层共用坐标与平移，反向关闭后恢复图标条`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      localStorage.setItem(
        'default-theme.sidebar.v1',
        JSON.stringify({ width: 320, rail: false, hidden: false }),
      );
    });
    const player = await openPlayer(page, { width });
    const rightKey = page.locator('[data-right-card-key="queue"]');
    const right = page.locator('[data-form="overlay"]');
    const rightMotion = await openHalfway(rightKey, '[data-form="overlay"]');
    expect(rightMotion.start.x).toBeGreaterThan(rightMotion.middle.x);
    expect(rightMotion.middle.x).toBeGreaterThan(rightMotion.end.x);
    expect(rightMotion.clip).toBe('none');
    await finish(right);
    const rightClosing = await closeToEdge(rightKey, '[data-form="overlay"]');
    expect.soft(rightClosing.samples.at(-1)?.left).toBeGreaterThanOrEqual(width);
    await finish(right);
    await expect(right).toHaveCount(0);

    const leftKey = page.locator('[data-sidebar-key]');
    const left = page.locator('[data-sidebar-overlay]');
    const leftMotion = await openHalfway(leftKey, '[data-sidebar-overlay]');
    expect(leftMotion.duration).toBe(rightMotion.duration);
    expect(leftMotion.clip).toBe('none');
    expect(leftMotion.start.x).toBeLessThan(leftMotion.middle.x);
    expect(leftMotion.middle.x).toBeLessThan(leftMotion.end.x);
    expect(leftMotion.host).toEqual(rightMotion.host);
    expect(leftMotion.end.y).toBeCloseTo(rightMotion.end.y, 1);
    expect(leftMotion.end.height).toBeCloseTo(rightMotion.end.height, 1);
    expect(leftMotion.end.width).toBeCloseTo(rightMotion.end.width, 1);
    expect.soft(leftMotion.start.x + leftMotion.start.width).toBeLessThanOrEqual(0);
    expect.soft(rightMotion.start.x).toBeGreaterThanOrEqual(width);
    expect
      .soft(-(leftMotion.start.x + leftMotion.start.width))
      .toBeCloseTo(rightMotion.start.x - width, 1);
    if (!leftMotion.host || !rightMotion.host) throw new Error('缺少浮层定位容器');
    expect(leftMotion.end.x - leftMotion.host.x).toBeCloseTo(
      rightMotion.host.right - rightMotion.end.x - rightMotion.end.width,
      1,
    );

    if (width > 640) {
      // 面板停在途中，图标栏先完成独立淡出，再检查退场期间的隐藏。
      await finish(page.locator('[data-sidebar-rail]'));
      await expect(page.locator('[data-sidebar-rail]')).toBeHidden();
    }
    const closing = await closeToEdge(leftKey, '[data-sidebar-overlay]');
    expect(closing.after).toBeCloseTo(closing.before, 1);
    expect(closing.inert).toBe(true);
    expect(closing.rail).toBe(width > 640 ? 'hidden' : null);
    expect.soft(closing.samples.at(-1)?.right).toBeLessThanOrEqual(0);
    for (let index = 1; index < closing.samples.length; index++) {
      expect(closing.samples[index]!.right).toBeLessThan(closing.samples[index - 1]!.right);
    }
    await finish(left);
    await expect(left).toHaveCount(0);
    if (width > 640) {
      await expect(page.locator('[data-sidebar-rail]')).toBeVisible();
      await expect(page.locator('[data-sidebar-rail]')).toHaveJSProperty('inert', false);
    }
    await expect(leftKey).toBeFocused();
    expect(player.errors).toEqual([]);
  });
}

async function toggleAndPause(trigger: Locator) {
  await trigger.evaluate(async (button) => {
    if (!(button instanceof HTMLElement)) throw new Error('浮层入口不可用');
    button.focus();
    button.click();
    await new Promise(requestAnimationFrame);
    for (const node of document.querySelectorAll('[data-sidebar-overlay], [data-sidebar-rail]')) {
      for (const animation of node.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
    }
  });
}

async function sampleRail(rail: Locator, portion: number) {
  return rail.evaluate((node, progress) => {
    const animation = node
      .getAnimations()
      .find(
        (entry) =>
          entry.effect instanceof KeyframeEffect &&
          entry.effect.getKeyframes().some((frame) => frame.opacity !== undefined),
      );
    if (!animation) throw new Error('图标栏没有淡变动画');
    animation.pause();
    const duration = Number(animation.effect?.getTiming().duration);
    animation.currentTime = duration * progress;
    return { opacity: Number(getComputedStyle(node).opacity), duration };
  }, portion);
}

async function finishPanelAndPauseRail(panel: Locator) {
  await panel.evaluate(async (node) => {
    node.getAnimations().forEach((animation) => animation.finish());
    await new Promise(requestAnimationFrame);
    for (const animation of document.querySelector('[data-sidebar-rail]')?.getAnimations() ?? []) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
}

test('图标栏同步淡出，浮层退场后淡入，途中重开从当前透明度反向', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const player = await openPlayer(page, { width: 900 });
  const key = page.locator('[data-sidebar-key]');
  const panel = page.locator('[data-sidebar-overlay]');
  const rail = page.locator('[data-sidebar-rail]');
  const box = await rail.boundingBox();

  await toggleAndPause(key);
  expect(await sampleRail(rail, 0)).toEqual({ opacity: 1, duration: 83 });
  expect((await sampleRail(rail, 0.5)).opacity).toBeCloseTo(0.5, 2);
  await expect(rail).toHaveJSProperty('inert', true);
  await rail
    .locator('button')
    .first()
    .evaluate((button) => button.focus());
  expect(await rail.evaluate((node) => node.contains(document.activeElement))).toBe(false);
  expect(await rail.boundingBox()).toEqual(box);
  await finish(rail);
  await expect(rail).toBeHidden();
  await finish(panel);

  await toggleAndPause(key);
  await expect(panel).toHaveCount(1);
  await expect(rail).toBeHidden();
  expect(await rail.evaluate((node) => node.getAnimations().length)).toBe(0);
  await finishPanelAndPauseRail(panel);
  await expect(panel).toHaveCount(0);
  expect(await sampleRail(rail, 0)).toEqual({ opacity: 0, duration: 83 });
  await expect(rail).toHaveJSProperty('inert', true);
  const halfway = await sampleRail(rail, 0.5);
  expect(halfway.opacity).toBeCloseTo(0.5, 2);

  await toggleAndPause(key);
  const reversed = await sampleRail(rail, 0);
  expect(reversed.opacity).toBeCloseTo(halfway.opacity, 2);
  expect(reversed.duration).toBeCloseTo(41.5, 1);
  expect((await sampleRail(rail, 0.5)).opacity).toBeCloseTo(0.25, 2);
  await expect(rail).toHaveJSProperty('inert', true);
  await finish(rail);
  await expect(rail).toBeHidden();
  await finish(panel);
  await toggleAndPause(key);
  await finishPanelAndPauseRail(panel);
  await finish(rail);
  await expect(rail).toHaveJSProperty('inert', false);
  await expect(rail).toBeVisible();
  expect(await rail.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  expect(await rail.boundingBox()).toEqual(box);
  await expect(key).toBeFocused();
  expect(player.errors).toEqual([]);
});

test('图标栏淡变中跨档清理，极窄浮层回到中窄时继续隐藏图标栏', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const player = await openPlayer(page, { width: 900 });
  const key = page.locator('[data-sidebar-key]');
  const panel = page.locator('[data-sidebar-overlay]');
  const rail = page.locator('[data-sidebar-rail]');
  await toggleAndPause(key);
  await sampleRail(rail, 0.5);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(panel).toHaveCount(0);
  const pane = page.locator('aside > div');
  await expect(pane).toHaveJSProperty('inert', false);
  await expect(pane).toBeVisible();
  expect(await pane.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(rail).toHaveCount(0);
  await toggleAndPause(key);
  await finish(panel);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(rail).toBeHidden();
  await expect(rail).toHaveJSProperty('inert', true);
  await toggleAndPause(key);
  await finishPanelAndPauseRail(panel);
  await finish(rail);
  await expect(rail).toHaveJSProperty('inert', false);
  await expect(rail).toBeVisible();
  expect(player.errors).toEqual([]);
});

for (const source of ['system', 'preference']) {
  test(`图标栏遵循${source === 'system' ? '系统' : '主题'}减弱动效并恢复交互`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: source === 'system' ? 'reduce' : 'no-preference' });
    if (source === 'preference') {
      await page.addInitScript(() => {
        localStorage.setItem('default-theme.motion.v1', 'reduce');
      });
    }
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.hasAttribute('data-sidebar-rail') && typeof options === 'object') {
          this.setAttribute('data-fade-duration', String(options?.duration));
        }
        return animate.call(this, frames, options);
      };
    });
    const player = await openPlayer(page, { width: 900 });
    const key = page.locator('[data-sidebar-key]');
    const panel = page.locator('[data-sidebar-overlay]');
    const rail = page.locator('[data-sidebar-rail]');
    await key.click();
    await expect(rail).toBeHidden();
    await expect(rail).toHaveJSProperty('inert', true);
    await expect(rail).toHaveAttribute('data-fade-duration', '1');
    await key.click();
    await expect(panel).toHaveCount(0);
    await expect(rail).toBeVisible();
    await expect(rail).toHaveJSProperty('inert', false);
    await expect(rail).toHaveAttribute('data-fade-duration', '1');
    expect(player.errors).toEqual([]);
  });
}
