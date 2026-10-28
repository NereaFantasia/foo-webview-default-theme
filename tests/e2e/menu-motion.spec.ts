import { expect, test, type Locator } from '@playwright/test';

test.use({ screenshot: 'off', viewport: { width: 1280, height: 800 } });
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import '/tests/fixtures/menuMotionEntry.ts';
        import { startupOverlay } from '/src/app/startupOverlay.ts';
        startupOverlay.dismiss();`,
    }),
  );
});
test.afterEach(() => expect(errors).toEqual([]));

test('靠近右边缘自动向左翻，悬停跨入时保持8px重叠且子菜单在上', async ({ page }) => {
  await page.goto('/?edge');
  await page.locator('[data-trigger]').click();
  await finish(page.locator('[data-primary]'));
  await page.locator('[data-subtrigger]').hover();
  const child = page.locator('[data-child]');
  await expect(child).toBeVisible();
  await finish(child);
  const main = await page.locator('[data-primary]').boundingBox();
  const sub = await child.boundingBox();
  expect(sub!.x).toBeLessThan(main!.x);
  expect(sub!.x + sub!.width - main!.x).toBeCloseTo(8, 0);
  await page.mouse.move(main!.x + 3, sub!.y + 20);
  await expect(child).toBeVisible();
  expect(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-child]'), {
      x: main!.x + 3,
      y: sub!.y + 20,
    }),
  ).toBe(true);
});

test('右键菜单淡出期间对象失效，仍通知关闭并清除旧对象', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import '/tests/fixtures/contextMenuEntry.ts';
      import { startupOverlay } from '/src/app/startupOverlay.ts';
      startupOverlay.dismiss();`,
    }),
  );
  await page.goto('/');
  await page.locator('[data-open-menu]').click();
  const menu = page.locator('[data-context-menu-owner]');
  await finish(menu);
  await menu.evaluate(async (node) => {
    node.querySelector<HTMLElement>('[data-context-command="play"]')!.click();
    await new Promise(requestAnimationFrame);
    node.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
    document.querySelector<HTMLElement>('[data-change-target]')!.click();
  });
  await expect(page.locator('[data-closed-by]')).toHaveText('invalidated');
  await expect(menu).toHaveCount(0);
});

test('高对比度保留勾选、禁用文字和键盘焦点，选中后悬停仍可辨', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('[data-trigger]').click();
  await page.locator('[data-subtrigger]').click();
  const selected = page.getByRole('menuitemradio', { name: '收藏', exact: true });
  await expect(selected).toBeChecked();
  await selected.hover();
  await expect(selected.locator('.fui-MenuItem__checkmark')).toBeVisible();
  await selected.focus();
  await page.keyboard.press('ArrowDown');
  const disabled = page
    .locator('[data-child]')
    .getByRole('menuitem', { name: '不可用', exact: true });
  await expect(disabled).toHaveAttribute('aria-disabled', 'true');
  expect(await disabled.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await selected.evaluate((node) => getComputedStyle(node).color),
  );
  const plate = page.locator('[data-child] [data-menu-backplate]');
  const colors = await plate.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
  expect(colors.background).not.toBe(colors.border);
});

test('右键菜单退出时立即重开，同一坐标的新菜单不会被旧完成回调关闭', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import '/tests/fixtures/contextMenuEntry.ts';
      import { startupOverlay } from '/src/app/startupOverlay.ts';
      startupOverlay.dismiss();`,
    }),
  );
  await page.goto('/');
  await page.locator('[data-open-menu]').click();
  const menu = page.locator('[data-context-menu-owner]');
  await finish(menu);
  const state = await menu.evaluate(async (node) => {
    node.querySelector<HTMLElement>('[data-context-command="play"]')!.click();
    await new Promise(requestAnimationFrame);
    node.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
    const inert = node.hasAttribute('inert');
    document.querySelector<HTMLElement>('[data-open-menu]')!.click();
    await new Promise(requestAnimationFrame);
    return { inert, oldConnected: node.isConnected };
  });
  expect(state).toEqual({ inert: true, oldConnected: false });
  await finish(menu);
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveAttribute('inert');
  await expect(page.locator('[data-closed-by]')).toBeEmpty();
});

async function finish(menu: Locator) {
  await menu.evaluate(async (node) => {
    const animations = node.getAnimations({ subtree: true });
    animations.forEach((animation) => animation.finish());
    await Promise.all(animations.map((animation) => animation.finished));
  });
}

for (const up of [false, true])
  for (const left of [false, true]) {
    test(`菜单尺寸、竖向展开与父子重叠：${up ? '上' : '下'}／${left ? '左' : '右'}`, async ({
      page,
    }) => {
      await page.goto(`/?${up ? 'up&' : ''}${left ? 'left&light' : ''}`);
      const main = page.locator('[data-primary]');
      const child = page.locator('[data-child]');
      await page.locator('[data-trigger]').click();
      const initial = await main.evaluate((node) => {
        const animations = node.getAnimations({ subtree: true });
        animations.forEach((animation) => {
          animation.pause();
          animation.currentTime = 0;
        });
        const item = node.querySelector<HTMLElement>('[role="menuitem"]')!;
        const content = node.querySelector<HTMLElement>('[data-menu-content]')!;
        const plate = node.querySelector<HTMLElement>('[data-menu-backplate]')!;
        const style = getComputedStyle(item);
        return {
          height: item.offsetHeight,
          font: style.fontSize,
          line: style.lineHeight,
          family: style.fontFamily,
          radius: getComputedStyle(plate).borderRadius,
          scale: new DOMMatrix(getComputedStyle(plate).transform).m22,
          textScale: new DOMMatrix(getComputedStyle(content).transform).m22,
          y: new DOMMatrix(getComputedStyle(content).transform).m42,
          opacity: getComputedStyle(node).opacity,
          duration: animations.map((animation) => animation.effect?.getTiming().duration),
        };
      });
      expect(initial).toMatchObject({
        height: 32,
        font: '14px',
        line: '20px',
        radius: '8px',
        scale: 0.5,
        textScale: 1,
        opacity: '1',
        duration: [250, 250, 250],
      });
      expect(initial.family).toContain('Segoe UI Variable');
      expect(Math.sign(initial.y)).toBe(up ? 1 : -1);
      await finish(main);
      await page.locator('[data-subtrigger]').focus();
      await page.keyboard.press('ArrowRight');
      await expect(child).toBeVisible();
      const scale = await child.evaluate((node) => {
        node.getAnimations({ subtree: true }).forEach((animation) => {
          animation.pause();
          animation.currentTime = 0;
        });
        return new DOMMatrix(
          getComputedStyle(node.querySelector('[data-menu-backplate]')!).transform,
        ).m22;
      });
      expect(scale).toBeCloseTo(0.33, 2);
      await finish(child);
      const a = await main.boundingBox();
      const b = await child.boundingBox();
      expect(Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x)).toBeCloseTo(8, 0);
      await page.keyboard.press('Escape');
      await expect(child).toHaveCount(0);
      await expect(page.locator('[data-subtrigger]')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(main).toHaveCount(0);
      await expect(page.locator('[data-trigger]')).toBeFocused();
    });
  }

test('中途关闭冻结形态，83ms淡出；重开连续且退场不接操作', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-trigger]').click();
  const result = await page.locator('[data-primary]').evaluate((node) => {
    const toggle = document.querySelector<HTMLButtonElement>('[data-trigger]')!;
    const sample = () =>
      [
        ...node.querySelectorAll(
          '[data-menu-backplate], [data-menu-viewport], [data-menu-content]',
        ),
      ].map((part) => {
        const style = getComputedStyle(part);
        return [style.transform, style.clipPath];
      });
    const seek = (part: number) =>
      node.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = Number(animation.effect?.getTiming().duration) * part;
      });
    seek(0.25);
    const entering = sample();
    toggle.click();
    seek(0);
    const closing = sample();
    const inert = node.hasAttribute('inert');
    const durations = node
      .getAnimations({ subtree: true })
      .map((a) => a.effect?.getTiming().duration);
    seek(0.5);
    const midway = sample();
    const opacity = getComputedStyle(node).opacity;
    toggle.click();
    seek(0);
    const reopened = sample();
    const reopenedOpacity = getComputedStyle(node).opacity;
    node.getAnimations({ subtree: true }).forEach((a) => a.play());
    return { entering, closing, midway, reopened, opacity, reopenedOpacity, inert, durations };
  });
  expect(result.closing).toEqual(result.entering);
  expect(result.midway).toEqual(result.closing);
  expect(result.reopened).toEqual(result.midway);
  expect(result.reopenedOpacity).toBe(result.opacity);
  expect(result.inert).toBe(true);
  expect(result.durations).toEqual([83, 83, 83, 83]);
  await expect(page.locator('[data-primary]')).not.toHaveAttribute('inert');
});

test('减弱动效仍完成关闭，子菜单命令只执行一次', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('[data-trigger]').click();
  await page.locator('[data-subtrigger]').click();
  await page.getByRole('menuitem', { name: '新建播放列表', exact: true }).click();
  await expect(page.locator('[data-count]')).toHaveText('1');
  await expect(page.locator('[data-primary], [data-child]')).toHaveCount(0);
  await expect(page.locator('[data-trigger]')).toBeFocused();
});
