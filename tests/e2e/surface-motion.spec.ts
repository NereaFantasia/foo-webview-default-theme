import { expect, test } from '@playwright/test';

let errors: string[] = [];
test.use({ screenshot: 'off' });
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "import '/tests/fixtures/surfaceMotionEntry.ts';",
    }),
  );
});
test.afterEach(() => expect(errors).toEqual([]));

test('浮层反向开关从当前透明度、位移和裁剪继续', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-toggle-flyout]').click();
  const frames = await page.locator('[data-flyout]').evaluate((element) => {
    const toggle = document.querySelector<HTMLButtonElement>('[data-toggle-flyout]');
    if (!toggle) throw new Error('缺少开合按钮');
    const sample = () => {
      const style = getComputedStyle(element);
      return { opacity: Number(style.opacity), translate: style.translate, clip: style.clipPath };
    };
    const seek = (portion: number) => {
      for (const animation of element.getAnimations()) {
        animation.pause();
        animation.currentTime = Number(animation.effect?.getTiming().duration) * portion;
      }
    };
    seek(0.4);
    const entering = sample();
    toggle.click();
    seek(0);
    const closing = sample();
    seek(0.3);
    const midway = sample();
    toggle.click();
    seek(0);
    const reopening = sample();
    for (const animation of element.getAnimations()) animation.play();
    return { entering, closing, midway, reopening };
  });
  expect(frames.closing.opacity).toBeCloseTo(frames.entering.opacity, 3);
  expect(frames.closing.translate).toBe(frames.entering.translate);
  expect(frames.closing.clip).toBe(frames.entering.clip);
  expect(frames.reopening.opacity).toBeCloseTo(frames.midway.opacity, 3);
  expect(frames.reopening.translate).toBe(frames.midway.translate);
  expect(frames.reopening.clip).toBe(frames.midway.clip);
  await expect(page.locator('[data-flyout]')).toBeVisible();
  await expect(page.locator('[data-finishes]')).toHaveText('0');
});

for (const light of [false, true]) {
  test(`对话框退场立即禁用交互并交还焦点（${light ? '浅色' : '深色'}）`, async ({ page }) => {
    await page.goto(light ? '/?light' : '/');
    await page.locator('[data-toggle-dialog]').click();
    await expect(page.locator('[data-dialog-action]')).toBeFocused();
    const closing = await page.locator('[data-close-dialog]').evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('缺少关闭按钮');
      button.click();
      const dialog = document.querySelector<HTMLElement>('[data-dialog]');
      const action = document.querySelector<HTMLElement>('[data-dialog-action]');
      action?.focus();
      return {
        present: Boolean(dialog),
        inert: dialog?.inert,
        hidden: dialog?.getAttribute('aria-hidden'),
        pointers: dialog && getComputedStyle(dialog).pointerEvents,
        focusedInside: dialog?.contains(document.activeElement),
      };
    });
    expect(closing).toEqual({
      present: true,
      inert: true,
      hidden: 'true',
      pointers: 'none',
      focusedInside: false,
    });
    await expect(page.locator('[data-toggle-dialog]')).toBeFocused();
    await expect(page.locator('[data-dialog]')).toHaveCount(0);
  });
}

test('菜单命令打开对话框后，旧菜单退场不夺回焦点', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-menu-trigger]').click();
  await page.getByRole('menuitem', { name: '打开对话框' }).click();
  await expect(page.locator('[data-dialog-action]')).toBeFocused();
  await expect(page.locator('[data-menu]')).toHaveCount(0);
  await expect(page.locator('[data-dialog-action]')).toBeFocused();
});

test('弹出层关闭时交还焦点并从读屏与键盘导航中移除', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-popover-trigger]').click();
  const closing = await page.locator('[data-close-popover]').evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('缺少关闭按钮');
    button.click();
    const surface = document.querySelector<HTMLElement>('[data-popover]');
    return { inert: surface?.inert, hidden: surface?.getAttribute('aria-hidden') };
  });
  expect(closing).toEqual({ inert: true, hidden: 'true' });
  await expect(page.locator('[data-popover-trigger]')).toBeFocused();
  await expect(page.locator('[data-popover]')).toHaveCount(0);
});

test('减弱动效时退场仍完成一次并卸载内容', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('[data-toggle-flyout]').click();
  await expect(page.locator('[data-flyout]')).toBeVisible();
  await page.locator('[data-toggle-flyout]').click();
  await expect(page.locator('[data-flyout]')).toHaveCount(0);
  await expect(page.locator('[data-finishes]')).toHaveText('1');
});

test('Tab 只在用户换到另一项时展开指示条，恢复状态和重复点击不播', async ({ page }) => {
  await page.goto('/');
  const first = page.getByRole('tab', { name: '第一项' });
  const second = page.getByRole('tab', { name: '第二项' });
  const animation = () =>
    first.evaluate((element) => getComputedStyle(element, '::after').animationName);
  expect(await animation()).toBe('none');
  await first.click();
  expect(await animation()).toBe('none');
  const selected = await second.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('缺少标签');
    element.click();
    return new Promise<string>((resolve) =>
      requestAnimationFrame(() => resolve(getComputedStyle(element, '::after').animationName)),
    );
  });
  expect(selected).not.toBe('none');
  await page.locator('[data-change-tab]').click();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  expect(await animation()).toBe('none');
});

test('保留挂载的抽屉反向时从当前位置继续，关完后再次打开可交互', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-toggle-drawer]').click();
  const frames = await page.locator('[data-drawer]').evaluate((element) => {
    const toggle = document.querySelector<HTMLButtonElement>('[data-toggle-drawer]');
    if (!toggle) throw new Error('缺少抽屉开合按钮');
    for (const animation of element.getAnimations()) {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getTiming().duration) * 0.2;
    }
    const before = getComputedStyle(element).translate;
    toggle.click();
    for (const animation of element.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    const after = getComputedStyle(element).translate;
    for (const animation of element.getAnimations()) animation.play();
    return { before, after };
  });
  expect(frames.after).toBe(frames.before);
  await expect(page.locator('[data-drawer]')).toBeHidden();
  await page.locator('[data-toggle-drawer]').click();
  await expect(page.locator('[data-drawer-action]')).toBeFocused();
  await expect(page.locator('[data-drawer]')).not.toHaveAttribute('inert');
  await expect(page.locator('[data-drawer]')).not.toHaveAttribute('aria-hidden', 'true');
});

test('浮层从锚点侧露出半边，不改变定位用的 transform', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-toggle-flyout]').click();
  const frame = await page.locator('[data-flyout]').evaluate((element) => {
    for (const animation of element.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    const style = getComputedStyle(element);
    return { clip: style.clipPath, translate: style.translate, transform: style.transform };
  });
  expect(frame).toEqual({ clip: 'inset(0px 0px 60px)', translate: '0px -10px', transform: 'none' });
});

test('appear=false 只跳过首次显示，后续打开和重开仍播放入场', async ({ page }) => {
  await page.goto('/?no-appear');
  const open = () =>
    page.locator('[data-toggle-flyout]').evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('缺少开合按钮');
      button.click();
      return document.querySelector('[data-flyout]')?.getAnimations().length ?? 0;
    });
  expect(await open()).toBeGreaterThan(0);
  await page.locator('[data-toggle-flyout]').click();
  await expect(page.locator('[data-flyout]')).toHaveCount(0);
  expect(await open()).toBeGreaterThan(0);
});

test('退场途中移除组件发出一次取消通知，不再发完成通知', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-toggle-flyout]').click();
  await page.locator('[data-flyout]').evaluate(async (element) => {
    const animations = element.getAnimations();
    for (const animation of animations) animation.finish();
    await Promise.all(animations.map((animation) => animation.finished));
  });
  const canceled = await page.locator('[data-toggle-flyout]').evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('缺少开合按钮');
    button.click();
    const animations = document.querySelector('[data-flyout]')?.getAnimations() ?? [];
    for (const animation of animations) animation.pause();
    document.querySelector<HTMLButtonElement>('[data-unmount-flyout]')?.click();
    return animations.length > 0 && animations.every((animation) => animation.playState === 'idle');
  });
  expect(canceled).toBe(true);
  await expect(page.locator('[data-flyout]')).toHaveCount(0);
  await expect(page.locator('[data-cancels]')).toHaveText('exit');
  await expect(page.locator('[data-finishes]')).toHaveText('0');
});
