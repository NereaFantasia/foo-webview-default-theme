import { expect, test, type Locator, type Page } from '@playwright/test';
import { openImmersive } from '../fixtures/immersivePage.ts';

// 沉浸视图的场景：偏好选图纸或预设，预设场景固定深色、不起图纸的取数服务；视图开着时换场景，
// 外壳（Esc、会话）不重开，图纸的取数服务随场景停起。预设场景的背景由偏好选的 AMLL 渲染器画。

const SCENE_KEY = 'default-theme.immersive.scene.v1';
const BACKDROP_KEY = 'default-theme.immersive.backdrop.v1';

/** 图纸的取数服务起来时会问宿主这一条；预设场景不该问 */
const PAPER_CALL = 'audio.isVisualizationAvailable';

async function chooseScene(page: Page, scene: 'paper' | 'presets') {
  await page.evaluate((value) => {
    const harness: unknown = Reflect.get(window, '__immersive');
    const choose = typeof harness === 'object' && harness ? Reflect.get(harness, 'scene') : null;
    if (typeof choose !== 'function') throw new Error('试验页没有挂上 __immersive.scene');
    Reflect.apply(choose, harness, [value]);
  }, scene);
}

test('选了预设场景：只画预设宿主，固定深色，不挂图纸的件也不起图纸的取数', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  // 整窗是浅色，预设场景也是深色
  await page.emulateMedia({ colorScheme: 'light' });
  const { view, calls, errors } = await openImmersive(page);
  await expect(view.locator('[data-scene="presets"]')).toBeVisible();
  await expect(view.locator('[data-tier]')).toHaveCount(0);
  // 图纸的 canvas 都不在，剩下的只能是背景渲染器自己的
  await expect(view.locator('canvas:not([data-backdrop] canvas)')).toHaveCount(0);
  expect(await view.evaluate((root) => getComputedStyle(root).colorScheme)).toBe('dark');
  const base = await view
    .locator('[data-scene="presets"]')
    .evaluate((scene) => getComputedStyle(scene).backgroundColor);
  const [red = 255, green = 255, blue = 255] = (base.match(/\d+/g) ?? []).map(Number);
  expect(red + green + blue).toBeLessThan(200);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(calls(PAPER_CALL)).toHaveLength(0);
  expect(errors).toStrictEqual([]);
});

const webgl = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });

test('背景选了关：不画渲染器，只留底色', async ({ page }) => {
  await page.addInitScript(
    ([scene, backdrop]) => {
      localStorage.setItem(scene ?? '', 'presets');
      localStorage.setItem(backdrop ?? '', 'off');
    },
    [SCENE_KEY, BACKDROP_KEY],
  );
  const { view, errors } = await openImmersive(page);
  await expect(view.locator('[data-backdrop="off"]')).toHaveCount(1);
  await expect(view.locator('canvas')).toHaveCount(0);
  expect(errors).toStrictEqual([]);
});

test('背景缺省用 mesh，一块 canvas 在背景层里', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  const { view, errors } = await openImmersive(page);
  test.skip(!(await webgl(page)), '这个环境没有 WebGL，背景渲染器用不了');
  await expect(view.locator('[data-backdrop="mesh"] canvas')).toHaveCount(1);
  expect(errors).toStrictEqual([]);
});

for (const renderer of ['titanium', 'isolation']) {
  test(`背景选了 ${renderer}：渲染器建得出，没有报错`, async ({ page }) => {
    await page.addInitScript(
      ([scene, backdrop, choice]) => {
        localStorage.setItem(scene ?? '', 'presets');
        localStorage.setItem(backdrop ?? '', choice ?? '');
      },
      [SCENE_KEY, BACKDROP_KEY, renderer],
    );
    const { view, errors } = await openImmersive(page);
    test.skip(!(await webgl(page)), '这个环境没有 WebGL，背景渲染器用不了');
    await expect(view.locator(`[data-backdrop="${renderer}"] canvas`)).toHaveCount(1);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(errors).toStrictEqual([]);
  });
}

test('预设场景里外壳照常：Esc 后退，这一层移走', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  const { view, errors } = await openImmersive(page);
  await expect(view).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toStrictEqual([]);
});

test('视图开着换场景：图纸的取数随场景停起，外壳不重开', async ({ page }) => {
  const { view, calls, errors } = await openImmersive(page);
  await expect(view.locator('[data-tier]')).toHaveCount(1);
  await expect.poll(() => calls(PAPER_CALL).length).toBeGreaterThan(0);
  const asked = calls(PAPER_CALL).length;

  await chooseScene(page, 'presets');
  await expect(view.locator('[data-scene="presets"]')).toBeVisible();
  await expect(view.locator('[data-tier]')).toHaveCount(0);
  await expect(view).toBeFocused();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(calls(PAPER_CALL)).toHaveLength(asked);

  await chooseScene(page, 'paper');
  await expect(view.locator('[data-tier]')).toHaveCount(1);
  await expect.poll(() => calls(PAPER_CALL).length).toBeGreaterThan(asked);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toStrictEqual([]);
});

/** 进视图的过渡带缩放，边框要等它播完才是排版值 */
const settled = (view: Locator) =>
  view.evaluate(async (root) => {
    const playing = root.getAnimations();
    await Promise.all(playing.map((animation) => animation.finished.catch(() => undefined)));
  });

test('头部的键：视图键在两种视图里都在，44 的圆、离左 32 离顶 20；Esc 胶囊 44 高、右缘离窗口 32；窗高不到 466 时离顶 12', async ({
  page,
}) => {
  const { view, errors } = await openImmersive(page);
  await settled(view);
  const key = view.locator('[data-view-key]');
  const esc = view.getByRole('button', { name: '退出沉浸' });
  for (const scene of ['paper', 'presets'] as const) {
    await chooseScene(page, scene);
    await expect(
      view.locator(scene === 'paper' ? '[data-tier]' : '[data-scene="presets"]'),
    ).toBeVisible();
    const [k, e] = await Promise.all([key.boundingBox(), esc.boundingBox()]);
    expect(k, scene).toMatchObject({ x: 32, y: 20, width: 44, height: 44 });
    expect(e, scene).toMatchObject({ y: 20, height: 44 });
    expect((e?.x ?? 0) + (e?.width ?? 0), scene).toBe(1248);
  }
  // 窗高不到 466 时封面列的上沿最低落到 56，键收到离顶 12，键底不越过它
  await page.setViewportSize({ width: 1280, height: 440 });
  await expect.poll(async () => (await key.boundingBox())?.y).toBe(12);
  await expect.poll(async () => (await esc.boundingBox())?.y).toBe(12);
  expect(errors).toStrictEqual([]);
});

test('视图键：点开是图纸、歌词两行，当前视图打勾；选歌词换成预设场景并写进偏好，再选图纸换回，视图不重开', async ({
  page,
}) => {
  const { view, errors } = await openImmersive(page);
  const key = view.locator('[data-view-key]');
  const menu = page.locator('[data-view-menu]');
  const row = (name: '图纸' | '歌词') => page.getByRole('menuitemradio', { name });
  const stored = () => page.evaluate((k) => localStorage.getItem(k), SCENE_KEY);

  await key.click();
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitemradio')).toHaveCount(2);
  await expect(row('图纸')).toHaveAttribute('aria-checked', 'true');
  await expect(row('歌词')).toHaveAttribute('aria-checked', 'false');
  await row('歌词').click();
  await expect(view.locator('[data-scene="presets"]')).toBeVisible();
  await expect(menu).toBeHidden();
  expect(await stored()).toBe('presets');

  await key.click();
  await expect(row('歌词')).toHaveAttribute('aria-checked', 'true');
  await row('图纸').click();
  await expect(view.locator('[data-tier]')).toHaveCount(1);
  await expect(menu).toBeHidden();
  expect(await stored()).toBe('paper');
  await expect(view).toBeVisible();
  expect(errors).toStrictEqual([]);
});

test('视图键的菜单开着时 Esc 只收菜单，视图还在；再按一次才离开', async ({ page }) => {
  const { view, errors } = await openImmersive(page);
  const menu = page.locator('[data-view-menu]');
  await view.locator('[data-view-key]').click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(view).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toStrictEqual([]);
});
