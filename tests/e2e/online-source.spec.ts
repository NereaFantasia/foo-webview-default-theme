import { expect, test, type Page } from '@playwright/test';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';
import { collectPageErrors } from '../fixtures/pageHost.ts';

// 在线音乐范围的来源下拉：试验页里 `lx=hosted` 时 lxserver 装好，可选来源有 QQ 音乐、酷我、酷狗、咪咕。

test.use({ screenshot: 'off' });

const results = (page: Page) => page.locator('[data-online-results]');
const rows = (page: Page) => results(page).locator('[data-online-track]');
const sourceButton = (page: Page) => page.locator('[data-online-source]');
const HOSTED = { lx: 'hosted' } as const;

const searches = async (page: Page) =>
  (await onlineLog(page)).flatMap((entry) =>
    typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === 'search'
      ? [
          {
            platform: Reflect.get(entry, 'platform'),
            type: Reflect.get(entry, 'type'),
            cursor: Reflect.get(entry, 'cursor'),
          },
        ]
      : [],
  );

async function choose(page: Page, name: string) {
  await sourceButton(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

test('只有网易云时分类行没有来源下拉', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page);
  await expect(page.getByRole('tab', { name: '曲目 45' })).toBeVisible();
  await expect(sourceButton(page)).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const)
  test(`有可选来源时下拉出现在分类行右端，列出各平台，默认网易云（${colorScheme}）`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const errors = collectPageErrors(page);
    await openOnlineHarness(page, HOSTED);
    await expect(sourceButton(page)).toHaveText('网易云');
    await expect(sourceButton(page)).toHaveAccessibleName('来源：网易云');
    const tabs = await page.getByRole('tablist').boundingBox();
    const button = await sourceButton(page).boundingBox();
    const row = await page.locator('[data-online-controls]').boundingBox();
    expect(button && tabs && button.x >= tabs.x + tabs.width).toBe(true);
    // 靠分类行的右端：只剩行的内缩，不是紧挨着页签
    expect(button && row && row.x + row.width - (button.x + button.width) < 40).toBe(true);
    await sourceButton(page).click();
    const items = page.getByRole('menuitemradio');
    await expect(items).toHaveText(['网易云', 'QQ 音乐', '酷我', '酷狗', '咪咕']);
    await expect(page.getByRole('menuitemradio', { name: '网易云' })).toBeChecked();
    for (const name of ['QQ 音乐', '酷我', '酷狗', '咪咕'])
      await expect(page.getByRole('menuitemradio', { name })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
    await expect(sourceButton(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

test('托管的 lxserver 没有启用的音源时，其他平台置灰并写原因，选不上', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, lxsources: 'none' });
  await sourceButton(page).click();
  const kuwo = page.getByRole('menuitemradio', { name: '酷我' });
  await expect(kuwo).toBeDisabled();
  await kuwo.hover({ force: true });
  await expect(page.getByRole('tooltip')).toHaveText('没有启用支持酷我的音源');
  await kuwo.click({ force: true });
  await expect(sourceButton(page)).toHaveText('网易云');
  expect((await searches(page)).every((entry) => entry.platform === 'wy')).toBe(true);
});

test('选酷我：只按曲目搜它，艺人、专辑、歌单页签置灰并写事实，点了不起作用', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, HOSTED);
  await expect(rows(page)).toHaveCount(5);
  await choose(page, '酷我');
  await expect(sourceButton(page)).toHaveText('酷我');
  // 「全部」里第一首是最佳匹配，不在列表里
  await expect(page.locator('[data-online-best]')).toContainText('KW Track 01');
  await expect(rows(page).first()).toContainText('KW Track 02');
  const sent = (await searches(page)).filter((entry) => entry.platform === 'kw');
  expect(sent).toEqual([{ platform: 'kw', type: 'track', cursor: null }]);
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  for (const name of ['艺人', '专辑', '歌单']) {
    await expect(tab(name)).toHaveAttribute('aria-disabled', 'true');
    await tab(name).click({ force: true });
    await expect(tab('全部')).toHaveAttribute('aria-selected', 'true');
  }
  await tab('艺人').hover();
  await expect(page.getByRole('tooltip')).toHaveText('酷我不提供艺人搜索');
  await expect(tab('曲目')).toBeEnabled();
  expect((await searches(page)).filter((entry) => entry.platform === 'kw')).toHaveLength(1);
});

test('当前是专辑分类时换到酷我，落到「曲目」', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, category: 'albums' });
  await expect(page.getByRole('tab', { name: '专辑 12' })).toHaveAttribute('aria-selected', 'true');
  await choose(page, '酷我');
  await expect(page.getByRole('tab', { name: '曲目' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).first()).toContainText('KW Track 01');
  // 列表放得下时会接着取下一页；酷我只被问过曲目
  const kuwo = (await searches(page)).filter((entry) => entry.platform === 'kw');
  expect(kuwo.length).toBeGreaterThan(0);
  expect(kuwo.every((entry) => entry.type === 'track')).toBe(true);
});

test('切回网易云不重搜，结果还在', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, category: 'tracks' });
  await expect(page.getByRole('tab', { name: '曲目 45' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).first()).toContainText('Track 01');
  const before = (await searches(page)).filter((entry) => entry.platform === 'wy').length;
  await choose(page, '酷我');
  await expect(rows(page).first()).toContainText('KW Track 01');
  await choose(page, '网易云');
  await expect(sourceButton(page)).toHaveText('网易云');
  await expect(page.getByRole('tab', { name: '曲目 45' })).toBeVisible();
  await expect(rows(page).first()).toContainText('Track 01');
  expect((await searches(page)).filter((entry) => entry.platform === 'wy')).toHaveLength(before);
});

test('其他平台的曲目可续页：平台不给总数，页签不写个数', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, category: 'tracks' });
  await choose(page, '酷我');
  await expect(page.getByRole('tab', { name: '曲目', exact: true })).toBeVisible();
  const cursors = async () =>
    (await searches(page)).filter((entry) => entry.platform === 'kw').map((entry) => entry.cursor);
  for (let round = 0; round < 6 && (await cursors()).length < 2; round += 1) {
    await results(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await page.waitForTimeout(150);
  }
  await expect.poll(cursors).toEqual([null, '20']);
  await results(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(rows(page).last()).toContainText('KW Track 25');
});

test('窄窗口下分类收成下拉，与来源下拉并排不溢出，置灰项仍写事实', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 800 });
  await openOnlineHarness(page, HOSTED);
  const controls = page.locator('[data-online-controls]');
  await expect(page.locator('[data-search-category]')).toBeVisible();
  await expect(sourceButton(page)).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await choose(page, '酷我');
  await page.locator('[data-search-category]').click();
  const artists = page.getByRole('menuitemradio', { name: '艺人', exact: true });
  await expect(artists).toBeDisabled();
  await artists.hover({ force: true });
  await expect(page.getByRole('tooltip')).toHaveText('酷我不提供艺人搜索');
});

test('酷我的「全部」只有曲目一节，署名是纯文字，右键菜单的「转到」置灰', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, HOSTED);
  await choose(page, '酷我');
  const view = results(page);
  await expect(view.getByRole('heading', { name: '曲目', exact: true })).toBeVisible();
  for (const name of ['艺人', '专辑', '歌单'])
    await expect(view.getByRole('heading', { name, exact: true })).toHaveCount(0);
  await expect(page.locator('[data-online-empty]')).toHaveCount(0);
  await expect(rows(page).first().getByRole('button')).toHaveCount(0);
  await rows(page).first().click({ button: 'right' });
  const menu = page.locator('[data-online-menu]');
  await expect(menu.getByRole('menuitem', { name: '转到专辑' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(menu.getByRole('menuitem', { name: '转到艺人' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('酷我搜索失败时整页写「酷我搜索失败」并给重试，网易云不受影响', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, platformfail: 'kw' });
  await choose(page, '酷我');
  const empty = page.locator('[data-online-empty]');
  await expect(empty).toContainText('酷我搜索失败');
  await expect(empty.getByRole('button', { name: '重试' })).toBeVisible();
  await empty.getByRole('button', { name: '重试' }).click();
  await expect(empty).toContainText('酷我搜索失败');
  await choose(page, '网易云');
  await expect(page.getByRole('tab', { name: '曲目 45' })).toBeVisible();
  await expect(empty).toHaveCount(0);
});
