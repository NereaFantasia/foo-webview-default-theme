import { expect, test } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`页内主题隔离与浮层继承：${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.evaluate(async () => {
      const url = '/tests/fixtures/CoverThemeHarness.tsx';
      const { mountCoverThemeHarness }: typeof import('../fixtures/CoverThemeHarness.tsx') =
        await import(url);
      const container = document.createElement('div');
      container.id = 'color-test';
      document.body.append(container);
      mountCoverThemeHarness(container);
    });
    const global = page.getByTestId('global');
    const local = page.getByTestId('local');
    const portal = page.getByTestId('portal');
    const color = (target: typeof local) =>
      target.evaluate((element) => getComputedStyle(element).color);
    const base = await color(global);
    await expect.poll(() => color(local)).toBe(base);
    const images = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建画布');
      return ['#cc2255', '#808080'].map((fill) => {
        context.fillStyle = fill;
        context.fillRect(0, 0, 64, 64);
        return canvas.toDataURL();
      });
    });
    await page.getByRole('textbox', { name: '封面地址' }).fill(images[0]!);
    await expect.poll(() => color(local)).not.toBe(base);
    const accent = await color(local);
    const glow = page.locator('#color-test [data-cover-glow]');
    await expect(glow.locator('img')).toHaveAttribute('data-ready', 'true');
    const bloom = glow.locator(':scope > div').first();
    await expect(bloom).toHaveCSS('opacity', scheme === 'dark' ? '1' : '0.33');
    await expect(glow).toHaveCSS('height', '300px');
    await expect(glow).toHaveCSS('pointer-events', 'none');
    expect(await color(global)).toBe(base);
    await expect.poll(() => color(portal)).toBe(accent);
    expect(await portal.getAttribute('data-tone')).toBe(await local.getAttribute('data-tone'));
    const geometry = await local.boundingBox();
    const sibling = await page.getByTestId('sibling').boundingBox();
    expect(geometry?.width).toBe(120);
    expect(sibling?.y).toBe(geometry?.y);
    expect(sibling?.x).toBe((geometry?.x ?? 0) + 120);
    const selected = (target: typeof local) =>
      target.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await selected(portal)).toBe(await selected(local));
    expect(await selected(local)).not.toBe(await selected(global));
    expect(
      await portal.evaluate((element) => getComputedStyle(element.parentElement!).display),
    ).not.toBe('contents');
    const play = page.getByTestId('play');
    const background = () => play.evaluate((element) => getComputedStyle(element).backgroundColor);
    const soft = await background();
    await play.hover();
    await expect.poll(background).not.toBe(soft);
    const hover = await background();
    await page.mouse.down();
    await expect.poll(background).not.toBe(hover);
    await page.mouse.up();
    await global.hover();
    await expect.poll(background).toBe(soft);
    await expect(page.getByTestId('disabled-play')).toBeDisabled();
    for (const mode of ['brand', 'raw', 'tonal', 'neutral']) {
      await page.getByRole('combobox', { name: '按钮样式' }).selectOption(mode);
      await expect.poll(background).not.toBe(soft);
    }
    expect(
      await play
        .locator('.fui-Button__icon')
        .evaluate((element) => getComputedStyle(element).color),
    ).not.toBe(await color(play));
    await page.getByRole('textbox', { name: '封面地址' }).fill(images[1]!);
    await expect(glow.locator('img')).toHaveAttribute('src', images[1]!);
    await expect(glow.locator('img')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => color(local)).toBe(base);
    await expect.poll(() => color(portal)).toBe(base);
    await page.getByRole('textbox', { name: '封面地址' }).fill('');
    await expect(glow).toHaveCount(1);
    await expect(glow.locator('img')).toHaveCount(0);
    await expect.poll(() => color(local)).toBe(base);
    await expect(bloom).toHaveCSS('background-color', base);
  });
}
