import { expect, test } from '@playwright/test';
import { enterSettings, openSettings } from '../fixtures/settingsPage.ts';

test('基础色：自定义取色即时生效并恢复，Windows 通过 SDK 更新', async ({ page }) => {
  const settings = await openSettings(page);
  const color = () =>
    page
      .locator('#root > .fui-FluentProvider')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--colorBrandForeground1').trim(),
      );
  const initial = await color();
  await settings.expand('强调色');
  await settings.choose('基础强调色', '自定义颜色');
  await page.getByRole('button', { name: '自定义颜色', exact: true }).click();
  await page.getByRole('textbox', { name: '十六进制颜色' }).fill('#cc2255');
  await expect.poll(color).not.toBe(initial);
  const custom = await color();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect.poll(color).toBe(custom);
  await enterSettings(page);
  await settings.expand('强调色');
  await expect(settings.select('基础强调色')).toHaveText('自定义颜色');
  settings.host.answer('system.getTheme', {
    success: true,
    darkMode: false,
    isDark: false,
    accentColor: '#3366cc',
    transparency: true,
  });
  await settings.choose('基础强调色', 'Windows 强调色');
  await expect.poll(color).not.toBe(custom);
  expect(settings.host.callsTo('system.getTheme').length).toBeGreaterThan(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`390 宽自定义取色浮层不越界，非法输入不覆盖颜色：${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const settings = await openSettings(page);
    await settings.expand('强调色');
    await settings.choose('基础强调色', '自定义颜色');
    await page.setViewportSize({ width: 390, height: 800 });
    const trigger = page.getByRole('button', { name: '自定义颜色', exact: true });
    await trigger.click();
    const surface = page.locator('.fui-PopoverSurface[aria-label="自定义颜色"]');
    await expect(surface).toBeVisible();
    await expect
      .poll(() =>
        surface.evaluate((element) => {
          const outer = element.getBoundingClientRect();
          const controls = [...element.querySelectorAll('button, input')];
          return (
            outer.left >= 0 &&
            outer.top >= 0 &&
            outer.right <= innerWidth &&
            outer.bottom <= innerHeight &&
            controls.length > 0 &&
            controls.every((control) => {
              const box = control.getBoundingClientRect();
              return (
                box.width > 0 &&
                box.height > 0 &&
                box.left >= outer.left &&
                box.right <= outer.right &&
                box.top >= outer.top &&
                box.bottom <= outer.bottom
              );
            })
          );
        }),
      )
      .toBe(true);
    const hex = surface.getByRole('textbox', { name: '十六进制颜色' });
    await hex.fill('#cc2255');
    const selected = await page
      .locator('#root > .fui-FluentProvider')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--colorBrandForeground1'));
    await hex.fill('#zzzzzz');
    await expect(hex).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#root > .fui-FluentProvider')).toHaveCSS(
      '--colorBrandForeground1',
      selected,
    );
    await hex.press('Tab');
    await expect(hex).toHaveValue('#cc2255');
    await hex.focus();
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
}
