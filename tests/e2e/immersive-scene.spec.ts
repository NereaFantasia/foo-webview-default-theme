import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AnswerTable } from '../fixtures/fakeHost.ts';
import { openImmersive } from '../fixtures/immersivePage.ts';

// 沉浸视图的场景：偏好选图纸或预设，预设场景固定深色、不起图纸的取数服务；视图开着时换场景，
// 外壳（Esc、会话）不重开，图纸的取数服务随场景停起。预设场景的背景由偏好选的 AMLL 渲染器画

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
    expect(errors).toStrictEqual([]);
  });
}

const OPTIONS_KEY = 'default-theme.immersive.backdropOptions.v1';

/** 宿主对背景那份频段订阅的应答：订阅号用 SDK 自己发来的 */
const BAND_ANSWERS: AnswerTable = {
  audio: {
    subscribeSpectrum: (params) => ({
      success: true,
      subscriptionId: String(params['subscriptionId']),
      event: String(params['event']),
      output: 'bands',
      scale: 'weighted',
      channels: 'mix',
      fftSize: Number(params['fftSize']),
      fps: Number(params['fps']),
      bands: Number(params['bands']),
      streamReady: true,
      backgroundThrottle: true,
      minFrequency: Number(params['minFrequency']),
      maxFrequency: Number(params['maxFrequency']),
    }),
    unsubscribeSpectrum: (params) => ({
      success: true,
      subscriptionId: String(params['subscriptionId']),
      removed: 1,
    }),
  },
};

test('背景开了随音乐律动：播放时订一份低频的频段输出，暂停退订，再播放重订', async ({ page }) => {
  await page.addInitScript(
    ([scene, options]) => {
      localStorage.setItem(scene ?? '', 'presets');
      localStorage.setItem(options ?? '', '{"mesh":{"audio":true}}');
    },
    [SCENE_KEY, OPTIONS_KEY],
  );
  const { view, host, state, calls, errors } = await openImmersive(page, {
    answers: BAND_ANSWERS,
  });
  test.skip(!(await webgl(page)), '这个环境没有 WebGL，背景渲染器用不了');
  await expect(view.locator('[data-backdrop="mesh"] canvas')).toHaveCount(1);
  await expect.poll(() => calls('audio.subscribeSpectrum')).toHaveLength(1);
  expect(calls('audio.subscribeSpectrum')[0]).toMatchObject({
    output: 'bands',
    bands: 8,
    fftSize: 4096,
    minFrequency: 30,
    maxFrequency: 200,
    event: 'audio:spectrum:backdrop',
  });
  // 图纸的取数不起：只有背景这一份订阅
  expect(calls(PAPER_CALL)).toHaveLength(0);

  const emitState = async (next: 'playing' | 'paused') => {
    state.state = next;
    await host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: next,
      position: 42,
      duration: 240,
      canSeek: true,
    });
  };
  await emitState('paused');
  await expect.poll(() => calls('audio.unsubscribeSpectrum')).toHaveLength(1);
  expect(calls('audio.unsubscribeSpectrum')[0]).toMatchObject({
    subscriptionId: String(calls('audio.subscribeSpectrum')[0]?.['subscriptionId']),
  });
  await emitState('playing');
  await expect.poll(() => calls('audio.subscribeSpectrum')).toHaveLength(2);
  expect(errors).toStrictEqual([]);
});

test('背景没开随音乐律动：不订音频', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  const { view, calls, errors } = await openImmersive(page, { answers: BAND_ANSWERS });
  test.skip(!(await webgl(page)), '这个环境没有 WebGL，背景渲染器用不了');
  await expect(view.locator('[data-backdrop="mesh"] canvas')).toHaveCount(1);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(calls('audio.subscribeSpectrum')).toHaveLength(0);
  expect(errors).toStrictEqual([]);
});

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

test('设置键与退出键在图纸、歌词两种视图里都在', async ({ page }) => {
  const { view, errors } = await openImmersive(page);
  await settled(view);
  const key = view.locator('[data-settings-key]');
  const esc = view.getByRole('button', { name: '退出沉浸' });
  for (const scene of ['paper', 'presets'] as const) {
    await chooseScene(page, scene);
    await expect(
      view.locator(scene === 'paper' ? '[data-tier]' : '[data-scene="presets"]'),
    ).toBeVisible();
    await expect(key, scene).toBeVisible();
    await expect(esc, scene).toBeVisible();
  }
  expect(errors).toStrictEqual([]);
});

const PRESET_KEY = 'default-theme.immersive.presetLandscape.v1';
const PRESET_OPTIONS_KEY = 'default-theme.immersive.presetOptions.v1';

/** 点设置键进入编辑：编辑条出来、两边的键让位 */
async function openEdit(view: Locator) {
  await view.locator('[data-settings-key]').click();
  await expect(view.locator('[data-edit-bar]')).toBeVisible();
}

const stored = (page: Page, key: string) =>
  page.evaluate((name) => localStorage.getItem(name), key);

test('设置的编辑：顶部的键让位，编辑条在页签的位置；改了背景，取消写回，Esc 按完成保留 @smoke', async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  const { view, errors } = await openImmersive(page);
  await expect(view.locator('[data-scene="presets"]')).toBeVisible();
  await openEdit(view);
  await expect(view.locator('[data-settings-key]')).toBeHidden();
  await expect(view.getByRole('button', { name: '退出沉浸' })).toBeHidden();
  await expect(view.locator('[data-edit-category="view"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await view.locator('[data-edit-category="background"]').click();
  await view.locator('[data-edit-card] [data-choice="off"]').click();
  expect(await stored(page, BACKDROP_KEY)).toBe('off');
  await view.locator('[data-edit-cancel]').click();
  await expect(view.locator('[data-edit-bar]')).toHaveCount(0);
  expect(await stored(page, BACKDROP_KEY)).not.toBe('off');
  await expect(view.locator('[data-backdrop="off"]')).toHaveCount(0);
  await expect(view.locator('[data-settings-key]')).toBeVisible();

  await openEdit(view);
  await view.locator('[data-edit-category="background"]').click();
  await view.locator('[data-edit-card] [data-choice="off"]').click();
  await page.keyboard.press('Escape');
  await expect(view.locator('[data-edit-bar]')).toHaveCount(0);
  await expect(view).toBeVisible();
  expect(await stored(page, BACKDROP_KEY)).toBe('off');
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toStrictEqual([]);
});

test('设置的编辑：在「视图」里点歌词换成预设场景并写进偏好，再点图纸换回；编辑与视图都不重开', async ({
  page,
}) => {
  const { view, errors } = await openImmersive(page);
  await openEdit(view);
  await view.locator('[data-edit-card] [data-choice="presets"]').click();
  await expect(view.locator('[data-scene="presets"]')).toBeVisible();
  expect(await stored(page, SCENE_KEY)).toBe('presets');
  await expect(view.locator('[data-edit-bar]')).toBeVisible();
  await view.locator('[data-edit-card] [data-choice="paper"]').click();
  await expect(view.locator('[data-tier]')).toHaveCount(1);
  expect(await stored(page, SCENE_KEY)).toBe('paper');
  await expect(view.locator('[data-edit-bar]')).toBeVisible();
  expect(errors).toStrictEqual([]);
});

test('满幅封面的编辑：点画面上的胶囊切到胶囊分类；拖胶囊右端的握点，两端对称地变宽，拖动时卡片让位、出读数', async ({
  page,
}) => {
  await page.addInitScript(
    ([scene, preset]) => {
      localStorage.setItem(scene, 'presets');
      localStorage.setItem(preset, 'bleed');
    },
    [SCENE_KEY, PRESET_KEY] as const,
  );
  const { view, errors } = await openImmersive(page, { width: 1280 });
  await expect(view.locator('[data-scene="presets"][data-preset="bleed"]')).toBeVisible();
  await openEdit(view);
  const capsule = view.locator('[data-capsule]');
  const before = await capsule.boundingBox();
  if (!before) throw new Error('没有胶囊');
  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  await expect(view.locator('[data-edit-category="immersive.group.capsule"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // 几何就是被测行为：能拖的线压在胶囊右边的直边上，按住那条边往外拖 30，宽度两边各多 30
  await expect(view.locator('[data-handle="capsuleWidth"]')).toHaveCount(1);
  const x = before.x + before.width;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 5 });
  await expect(view.locator('[data-edit-card]')).toHaveAttribute('data-yielded');
  await expect(view.getByText('胶囊宽度 500px')).toBeVisible();
  await page.mouse.up();
  await expect(view.locator('[data-edit-card]')).not.toHaveAttribute('data-yielded');
  expect(JSON.parse((await stored(page, PRESET_OPTIONS_KEY)) ?? '{}')).toEqual({
    bleed: { capsuleWidth: before.width + 60 },
  });
  await expect.poll(async () => (await capsule.boundingBox())?.width).toBe(before.width + 60);
  expect(errors).toStrictEqual([]);
});

test('设置的编辑开着时 Esc 先结束编辑，视图还在；再按一次才离开', async ({ page }) => {
  const { view, errors } = await openImmersive(page);
  await openEdit(view);
  await page.keyboard.press('Escape');
  await expect(view.locator('[data-edit-bar]')).toHaveCount(0);
  await expect(view).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toStrictEqual([]);
});
