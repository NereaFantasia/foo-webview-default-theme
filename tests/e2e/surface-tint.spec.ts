import { expect, test, type Locator } from '@playwright/test';
import { enterSettings, openSettings } from '../fixtures/settingsPage.ts';

test.use({ screenshot: 'off' });

async function colorOf(element: Locator, value?: string): Promise<number[]> {
  return element.evaluate((node, color) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = color ?? getComputedStyle(node).backgroundColor;
    node.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取表面颜色');
    context.fillStyle = resolved;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, value);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} 菜单与下拉共用表面，染色开关独立保存且不影响选项状态`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('default-theme.backdrop.v1', 'none');
      localStorage.setItem(
        'default-theme.base-accent.v1',
        JSON.stringify({ mode: 'custom', custom: '#d04030' }),
      );
      localStorage.setItem(
        'default-theme.theme-background.v1',
        JSON.stringify({ light: 40, dark: 40 }),
      );
    });
    const settings = await openSettings(page);
    const root = page.locator('#root > .fui-FluentProvider');
    const pane = page.locator('main [data-reading-fill]').first();
    const readingColor = await colorOf(pane);
    const tinted = await colorOf(root, 'var(--bg-panel-overlay)');
    const neutral = await colorOf(
      root,
      scheme === 'dark' ? 'var(--colorNeutralBackground3)' : 'var(--colorNeutralBackground1)',
    );
    expect(tinted).not.toEqual(neutral);
    expect(tinted[3]).toBe(255);

    await settings.select('动效').click();
    const listbox = page.getByRole('listbox');
    await expect.poll(() => colorOf(listbox)).toEqual(tinted);
    const selected = listbox.getByRole('option', { name: '跟随系统', exact: true });
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(selected.locator('.fui-Option__checkIcon')).toBeVisible();
    await selected.hover();
    expect(await colorOf(selected)).not.toEqual(tinted);
    await expect(selected.locator('.fui-Option__checkIcon')).toBeVisible();
    expect(
      await listbox.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar').width),
    ).toBe('8px');
    await page.keyboard.press('Escape');
    await expect(settings.select('动效')).toBeFocused();

    await page.locator('[data-menu="main"]').click();
    await expect
      .poll(() => colorOf(page.locator('.fui-MenuPopover:visible [data-menu-backplate]').first()))
      .toEqual(tinted);
    await page.keyboard.press('Escape');
    await settings.expand('表面跟随背景色调');
    const menuSwitch = page.getByRole('switch', { name: '菜单与下拉列表', exact: true });
    const panelSwitch = page.getByRole('switch', { name: '浮动面板', exact: true });
    await expect(menuSwitch).toBeChecked();
    await expect(panelSwitch).toBeChecked();
    await menuSwitch.uncheck();
    expect(await colorOf(root, 'var(--bg-panel-overlay)')).toEqual(tinted);
    await settings.select('动效').click();
    await expect.poll(() => colorOf(listbox)).toEqual(neutral);
    await page.keyboard.press('Escape');
    await panelSwitch.uncheck();
    await expect.poll(() => colorOf(root, 'var(--bg-panel-overlay)')).toEqual(neutral);
    expect(await colorOf(pane)).toEqual(readingColor);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('default-theme.surface-tint.v1')))
      .toBe('{"menus":false,"panels":false}');

    await page.reload();
    await enterSettings(page);
    await settings.expand('表面跟随背景色调');
    await expect(menuSwitch).not.toBeChecked();
    await expect(panelSwitch).not.toBeChecked();
    await menuSwitch.check();
    await settings.select('动效').click();
    await expect.poll(() => colorOf(listbox)).toEqual(tinted);
    expect(await colorOf(root, 'var(--bg-panel-overlay)')).toEqual(neutral);
    await page.emulateMedia({ forcedColors: 'active' });
    const defaultSurface = await root.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--colorNeutralBackground1'),
    );
    await expect
      .poll(() =>
        listbox.evaluate((node) =>
          getComputedStyle(node).getPropertyValue('--colorNeutralBackground1'),
        ),
      )
      .toBe(defaultSurface);
    await page.keyboard.press('Escape');
    await page.emulateMedia({ forcedColors: 'none' });

    await page.setViewportSize({ width: 900, height: 800 });
    await page.locator('[data-right-card-key="queue"]').click();
    await expect.poll(() => colorOf(page.locator('[data-form="overlay"]'))).toEqual(neutral);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByRole('navigation', { name: '侧边栏' })
      .getByRole('button', { name: '专辑', exact: true })
      .click();
    await page.locator('[data-view-panel]').click();
    await page.getByRole('combobox', { name: '分节', exact: true }).click();
    await expect.poll(() => colorOf(listbox)).toEqual(tinted);
    await expect(listbox.locator('xpath=..')).toHaveClass(/fui-Dropdown/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(settings.errors).toEqual([]);
  });
}
