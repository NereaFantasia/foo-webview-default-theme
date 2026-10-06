import { expect, test, type Locator, type Page } from '@playwright/test';

// 只断言算出来的样式值，不看画面：深浅、减弱动效与语义变量是否接到了主题根上。
function themeRoot(page: Page): Locator {
  return page.locator('#root > .fui-FluentProvider');
}

function readVariable(root: Locator, name: string): Promise<string> {
  return root.evaluate((element, variable) => {
    return getComputedStyle(element).getPropertyValue(variable).trim();
  }, name);
}

test('深浅跟随系统，切换即时生效', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = themeRoot(page);
  await expect(root).toHaveCSS('color-scheme', 'light');
  const lightText = await readVariable(root, '--colorNeutralForeground1');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect.poll(() => readVariable(root, '--colorNeutralForeground1')).not.toBe(lightText);
});

test('语义变量落到 Fluent token 上', async ({ page }) => {
  await page.goto('/');
  const root = themeRoot(page);
  const secondary = await readVariable(root, '--colorNeutralForeground3');
  expect(secondary).not.toBe('');
  expect(await readVariable(root, '--text-secondary')).toBe(secondary);
  expect(await readVariable(root, '--bg-app')).toBe('transparent');
  await expect(root).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('减弱动效时动效时长缩到 1 ms，关掉后恢复原值', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const root = themeRoot(page);
  await expect.poll(() => readVariable(root, '--motion-fast')).toBe('1ms');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => readVariable(root, '--motion-fast')).toBe('167ms');
  expect(await readVariable(root, '--motion-curve-pane')).toBe('cubic-bezier(0,0.35,0.15,1)');
});
