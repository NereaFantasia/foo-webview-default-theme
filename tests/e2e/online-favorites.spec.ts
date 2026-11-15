import { expect, test, type Page } from '@playwright/test';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';
import { collectPageErrors } from '../fixtures/pageHost.ts';

// 本地收藏的收藏键：在在线结果试验页里跑，音乐客户端替身把收藏存在页面里，操作记进日志

test.use({ screenshot: 'off' });

const rows = (page: Page) => page.locator('[data-online-results] [data-online-track]');
const favoriteLog = async (page: Page, kind: 'favorite-add' | 'favorite-remove') =>
  (await onlineLog(page)).filter(
    (entry): entry is object =>
      typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === kind,
  );

test('在线曲目表：点心形收藏、再点取消；右键菜单按状态写收藏或取消收藏', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { category: 'tracks' });
  const row = rows(page).first();
  const heart = row.locator('[data-online-favorite]');
  await row.hover();
  await expect(heart).not.toHaveAttribute('data-favorite', /.*/);

  await heart.click();
  await expect(heart).toHaveAttribute('data-favorite', 'true');
  await expect
    .poll(async () => (await favoriteLog(page, 'favorite-add')).at(-1))
    .toMatchObject({ detail: { kind: 'track', ids: ['1000'] } });

  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '取消收藏', exact: true }).click();
  await expect(heart).not.toHaveAttribute('data-favorite', /.*/);
  await expect
    .poll(async () => (await favoriteLog(page, 'favorite-remove')).at(-1))
    .toMatchObject({ detail: { kind: 'track', ids: ['1000'] } });

  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '收藏', exact: true }).click();
  await expect(heart).toHaveAttribute('data-favorite', 'true');
  expect(errors).toEqual([]);
});

test('多选两首右键：写「收藏所选」，只收还没收的；都收了写「取消收藏所选」', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { category: 'tracks' });
  await rows(page).first().locator('[data-online-favorite]').click({ force: true });
  await expect(rows(page).first().locator('[data-online-favorite]')).toHaveAttribute(
    'data-favorite',
    'true',
  );
  await rows(page).first().click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ['Control'] });
  await rows(page).nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '收藏所选', exact: true }).click();
  await expect(rows(page).nth(1).locator('[data-online-favorite]')).toHaveAttribute(
    'data-favorite',
    'true',
  );
  await rows(page).first().click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ['Control'] });
  await rows(page).nth(1).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '取消收藏所选', exact: true })).toBeVisible();
});

test('专辑页头的心形收藏专辑，署名行每位艺人名字后有加号，点了变勾', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'album:5000' });
  const header = page.locator('[data-page="onlineList"]');
  const heart = header.locator('[data-detail-favorite]');
  await expect(heart).toBeVisible();
  await expect(heart).not.toHaveAttribute('data-favorite', /.*/);
  await heart.click();
  await expect(heart).toHaveAttribute('data-favorite', 'true');
  await expect
    .poll(async () => (await favoriteLog(page, 'favorite-add')).at(-1))
    .toMatchObject({ detail: { kind: 'album', ids: ['5000'] } });

  const follow = header.locator('[data-detail-follow]').first();
  await expect(follow).not.toHaveAttribute('data-followed', /.*/);
  await follow.click();
  await expect(follow).toHaveAttribute('data-followed', 'true');
  await expect
    .poll(async () => (await favoriteLog(page, 'favorite-add')).at(-1))
    .toMatchObject({ detail: { kind: 'artist' } });
});

test('艺人页头的关注键带字：点一下变「已关注」，再点取消', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { list: 'artist:3000' });
  const follow = page.locator('[data-artist-follow]');
  await expect(follow).toHaveText('关注');
  await follow.click();
  await expect(follow).toHaveText('已关注');
  await expect
    .poll(async () => (await favoriteLog(page, 'favorite-add')).at(-1))
    .toMatchObject({ detail: { kind: 'artist', ids: ['3000'] } });
  await follow.click();
  await expect(follow).toHaveText('关注');
  await expect
    .poll(async () => (await favoriteLog(page, 'favorite-remove')).at(-1))
    .toMatchObject({ detail: { kind: 'artist', ids: ['3000'] } });
});
