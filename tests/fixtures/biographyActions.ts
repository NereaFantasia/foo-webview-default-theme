import { expect, type Page } from '@playwright/test';

export async function openBiographyLink(page: Page) {
  const details = page.locator('[data-biography-link]');
  await expect(details).toBeVisible();
  if (!(await details.evaluate((node) => node.hasAttribute('open'))))
    await details.locator('summary').click();
}

export async function openBiographySettings(page: Page) {
  await page.locator('[data-biography]').getByRole('button', { name: '简介选项' }).click();
  await page.getByRole('menuitem', { name: '设置 · 在线内容', exact: true }).click();
}

export async function expandBiographyArticle(page: Page) {
  const article = page.locator('[data-biography-article]');
  await expect(article).toBeVisible();
  await expect(article.locator('[data-collapsed]')).toHaveCount(0);
}

export async function confirmBiographyExternal(page: Page) {
  await page
    .getByRole('dialog', { name: '访问外部链接？' })
    .getByRole('button', { name: '打开链接', exact: true })
    .click();
}
