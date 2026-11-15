import { expect, test } from '@playwright/test';
import { LASTFM_SOURCE_CONFIG } from '../fixtures/biographySource.ts';
import { openSettings } from '../fixtures/settingsPage.ts';

test('简介卡默认收起，开关不展开卡片，关闭在线时子项禁用而缓存仍可清理', async ({ page }) => {
  const settings = await openSettings(page, { config: LASTFM_SOURCE_CONFIG }, '在线内容');
  const card = settings.expander('在线艺人简介');
  const head = card.locator(':scope > :first-child');
  const online = card.getByRole('switch', { name: '在线艺人简介', exact: true });
  await expect(card.locator('[data-settings-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await expect(head).toContainText('Last.fm');
  await online.check();
  await expect(card.locator('[data-settings-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await settings.expand('在线艺人简介');
  await expect(settings.select('简介语言')).toBeEnabled();
  await expect(page.getByLabel('Last.fm API 密钥', { exact: true })).toBeEnabled();
  await online.uncheck();
  await expect(settings.select('简介语言')).toBeDisabled();
  await expect(page.getByLabel('Last.fm API 密钥', { exact: true })).toBeDisabled();
  await expect(settings.row('简介缓存').getByRole('button', { name: '清理缓存' })).toBeEnabled();
  expect(settings.errors).toEqual([]);
});

test('来源缺省是 Apple Music：隐私说明写明对方是 Apple，语言只有三项，没有 Last.fm 密钥行；切到 Last.fm 后都换回来', async ({
  page,
}) => {
  const settings = await openSettings(page, {}, '在线内容');
  const card = settings.expander('在线艺人简介');
  const head = card.locator(':scope > :first-child');
  await expect(head).toContainText('Apple');
  await expect(head).not.toContainText('Last.fm');
  await card.getByRole('switch', { name: '在线艺人简介', exact: true }).check();
  await settings.expand('在线艺人简介');
  await expect(settings.select('简介来源')).toContainText('Apple Music');
  await expect(page.getByLabel('Last.fm API 密钥', { exact: true })).toHaveCount(0);
  await settings.select('简介语言').click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.keyboard.press('Escape');
  // Last.fm 补全缺省关；打开后隐私说明补一句，密钥行出现
  const fallback = page.getByRole('switch', { name: 'Apple Music 没有简介时改用 Last.fm' });
  await expect(fallback).not.toBeChecked();
  await fallback.check();
  await expect(head).toContainText('MusicBrainz 与 Last.fm');
  await expect(page.getByLabel('Last.fm API 密钥', { exact: true })).toBeVisible();
  await fallback.uncheck();
  await expect(page.getByLabel('Last.fm API 密钥', { exact: true })).toHaveCount(0);
  await settings.choose('简介来源', 'Last.fm');
  await expect(fallback).toHaveCount(0);
  await expect(page.getByLabel('Last.fm API 密钥', { exact: true })).toBeEnabled();
  await expect(head).toContainText('Last.fm');
  await settings.select('简介语言').click();
  await expect(page.getByRole('option')).toHaveCount(13);
  await page.keyboard.press('Escape');
  expect(settings.errors).toEqual([]);
});

test('API 密钥出错时卡头保留隐私说明，收起仍能看到错误', async ({ page }) => {
  const settings = await openSettings(page, { config: LASTFM_SOURCE_CONFIG }, '在线内容');
  const card = settings.expander('在线艺人简介');
  await card.getByRole('switch', { name: '在线艺人简介', exact: true }).check();
  await settings.expand('在线艺人简介');
  const input = page.getByLabel('Last.fm API 密钥', { exact: true });
  await input.fill('bad');
  await input.press('Enter');
  await card.locator('[data-settings-toggle]').click();
  await expect(settings.row('Last.fm API 密钥')).toHaveCount(0);
  await expect(card.locator(':scope > :first-child')).toContainText('密钥须包含 32 个十六进制字符');
  await expect(card.locator(':scope > :first-child')).toContainText('Last.fm');
  expect(settings.errors).toEqual([]);
});

test('外链确认开关与确认框共用偏好，关闭后可重新开启', async ({ page }) => {
  const settings = await openSettings(page, { config: LASTFM_SOURCE_CONFIG }, '在线内容');
  const confirm = page.getByRole('switch', { name: '打开外部链接前确认', exact: true });
  await expect(confirm).toBeChecked();
  await settings.expand('在线艺人简介');
  await confirm.uncheck();
  await expect
    .poll(() => settings.host.config.get('defaultTheme.links.confirmExternal'))
    .toBe(false);
  await page.getByRole('button', { name: '申请密钥', exact: true }).click();
  await expect.poll(() => settings.host.callsTo('shell.openExternal').length).toBe(1);
  await expect(page.getByRole('dialog', { name: '访问外部链接？' })).toHaveCount(0);
  await confirm.check();
  await page.getByRole('button', { name: '申请密钥', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '访问外部链接？' })).toBeVisible();
  expect(settings.host.callsTo('shell.openExternal')).toHaveLength(1);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(settings.errors).toEqual([]);
});
