import { expect, test, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer } from '../fixtures/playerPage.ts';

// 播放顺序菜单：单击与右键都能开，七项带图标、当前项打勾；选中只发命令，勾与键上的图标等宿主报了新顺序
// 才动。宽窗的标题栏与胶囊共用同一份；底部通栏的顺序键开菜单、发命令另在 player-bottom-bar.spec.ts。

test.beforeEach(({ page }) => choosePlayerBar(page, 'titlebar'));

const NAMES = [
  '默认',
  '重复（列表）',
  '重复（音轨）',
  '随机',
  '乱序（音轨）',
  '乱序（专辑）',
  '乱序（目录）',
];

const orderKey = (page: Page, scope = 'header') =>
  page.locator(`${scope} [data-player-key="order"]`);
const menu = (page: Page) => page.getByRole('menu', { name: '播放顺序' });

async function checkedItems(page: Page): Promise<string[]> {
  return menu(page)
    .getByRole('menuitemradio', { checked: true })
    .evaluateAll((items) => items.map((item) => item.textContent ?? ''));
}

test('单击弹出七选一，各带图标，当前项打勾', async ({ page }) => {
  const { errors } = await openPlayer(page, { state: { order: 1 } });
  await expect(orderKey(page)).toHaveAccessibleName('播放顺序：重复（列表）');
  await orderKey(page).click();
  const items = menu(page).getByRole('menuitemradio');
  await expect(items).toHaveText(NAMES);
  for (const item of await items.all()) await expect(item.locator('svg').first()).toBeVisible();
  expect(await checkedItems(page)).toEqual(['重复（列表）']);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(orderKey(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('右键同样弹出这份菜单，不弹浏览器的右键菜单', async ({ page }) => {
  const { errors } = await openPlayer(page);
  await orderKey(page).click({ button: 'right' });
  await expect(menu(page).getByRole('menuitemradio')).toHaveCount(7);
  expect(await checkedItems(page)).toEqual(['默认']);
  expect(errors).toEqual([]);
});

test('选中后按名字发 setOrder；勾与图标以宿主回读为准', async ({ page }) => {
  const { host, state, calls, errors } = await openPlayer(page);
  await orderKey(page).click();
  await menu(page).getByRole('menuitemradio', { name: '随机' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(() => calls('playback.setPlaybackOrder')).toEqual([{ name: 'random' }]);
  // 宿主没有改成随机：回读还是默认，键不跟着选的那一项变。
  await expect.poll(() => calls('playback.getPlaybackOrder').length).toBeGreaterThan(1);
  await expect(orderKey(page)).toHaveAccessibleName('播放顺序：默认');

  state.order = 3;
  await host.emit('playback:orderChanged', { orderIndex: 3, order: 3 });
  await expect(orderKey(page)).toHaveAccessibleName('播放顺序：随机');
  await orderKey(page).click();
  expect(await checkedItems(page)).toEqual(['随机']);
  // 选当前那一项不再发命令。
  await menu(page).getByRole('menuitemradio', { name: '随机' }).click();
  await page.waitForTimeout(200);
  expect(calls('playback.setPlaybackOrder')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('胶囊里的顺序键开同一份菜单', async ({ page }) => {
  const { calls, errors } = await openPlayer(page, { width: 900 });
  const key = orderKey(page, '[data-player-capsule]');
  await key.click();
  await expect(menu(page).getByRole('menuitemradio')).toHaveText(NAMES);
  // 入场动效带一段位移，播完再量。只等菜单自己的：胶囊里的字可能正在定时滚动。
  await menu(page).evaluate((element) => {
    const surface = element.closest('.fui-MenuPopover') ?? element;
    return Promise.all(
      surface.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  const keyBox = await key.boundingBox();
  const menuBox = await menu(page).boundingBox();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(keyBox?.y ?? 0);
  await menu(page).getByRole('menuitemradio', { name: '乱序（专辑）' }).click();
  await expect.poll(() => calls('playback.setPlaybackOrder')).toEqual([{ name: 'shuffle-albums' }]);
  expect(errors).toEqual([]);
});

test('还没连上宿主时顺序键置灰、点不开', async ({ page }) => {
  await page.goto('/');
  const key = orderKey(page);
  await expect(key).toBeDisabled();
  await key.click({ force: true });
  await expect(menu(page)).toHaveCount(0);
});
