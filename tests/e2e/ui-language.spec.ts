import { expect, test, type Page } from '@playwright/test';

// 没有宿主时语言停在浏览器那一档：等宿主超时（标题栏的提示区撤掉 aria-busy）之后，文案仍随浏览器语言走。
/** 等宿主超时、核对有了结果。 */
async function hostGivenUp(page: Page): Promise<void> {
  await expect(page.getByRole('banner').getByRole('status')).toBeAttached({ timeout: 10_000 });
  await expect(page.getByRole('banner').locator('[role="status"]:not([aria-busy])')).toHaveCount(
    1,
    {
      timeout: 10_000,
    },
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('浏览器是中文时界面用中文', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await hostGivenUp(page);
  await expect(page.getByRole('navigation', { name: '侧边栏' }).getByText('媒体库')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(errors).toEqual([]);
});

test.describe('浏览器是英文', () => {
  test.use({ locale: 'en-US' });

  test('界面用英文', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await hostGivenUp(page);
    await expect(
      page.getByRole('navigation', { name: 'Sidebar' }).getByText('Library'),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(errors).toEqual([]);
  });
});
