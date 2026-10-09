import { expect, test } from '@playwright/test';
import { openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';

const IMMERSIVE_MODULE = '**/src/app/ImmersivePage.tsx*';
const ENTRY = '[data-player-bar] [data-player-key="cover"]';

test('沉浸模块首次进入才加载，返回后保留入口焦点，再次进入使用已加载模块', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(IMMERSIVE_MODULE, async (route) => {
    requests += 1;
    await held;
    await route.continue();
  });
  try {
    const { errors } = await openPlayer(page);
    expect(requests).toBe(0);
    const entry = page.locator(ENTRY);
    await entry.click();
    // 等待模块时不悬停入口，避免工具提示先消费用于退出页面的 Esc。
    await page.mouse.move(0, 0);
    await expect(page.getByRole('progressbar', { name: '正在加载页面…' })).toBeVisible();
    await expect.poll(() => requests).toBe(1);
    release();
    const view = page.getByRole('region', { name: '正在播放' });
    await expect(view).toBeVisible();
    await expect(view.locator('[data-field="title"]')).toHaveText(PLAYING_TRACK.title);
    await expect(view).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    await expect(entry).toBeFocused();
    await entry.click();
    await expect(view).toBeVisible();
    expect(requests).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test('等待时 Esc 返回，迟到的模块不会挂上页面或抢走焦点', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(IMMERSIVE_MODULE, async (route) => {
    await held;
    await route.continue();
  });
  try {
    const { errors } = await openPlayer(page);
    const entry = page.locator(ENTRY);
    await entry.click();
    await expect(page.getByRole('progressbar', { name: '正在加载页面…' })).toBeVisible();
    await page.keyboard.press('Escape');
    const response = page.waitForResponse((value) =>
      value.url().includes('/app/ImmersivePage.tsx'),
    );
    release();
    await response;
    const view = page.getByRole('region', { name: '正在播放' });
    await expect(page.locator('[data-page="albums"]')).toBeVisible();
    await expect(page.locator('[data-page-loading]')).toHaveCount(0);
    await expect(view).toHaveCount(0);
    await expect(entry).toBeFocused();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(view).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme}：模块加载失败保留主窗，重新加载主题后可再次打开`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(IMMERSIVE_MODULE, (route) => route.abort('failed'));
    const { errors } = await openPlayer(page);
    if (colorScheme === 'dark') await page.setViewportSize({ width: 390, height: 800 });
    await page.locator(ENTRY).click();
    const failure = page.getByRole('alert').filter({ hasText: '页面加载失败' });
    await expect(failure).toBeVisible();
    await expect(page.locator('[data-player-bar]')).toBeVisible();
    const reload = failure.getByRole('button', { name: '重新加载主题' });
    await expect(reload).toBeVisible();
    await page.unroute(IMMERSIVE_MODULE);
    await reload.click();
    await expect(page.locator(ENTRY)).toBeVisible();
    await page.locator(ENTRY).click();
    await expect(page.getByRole('region', { name: '正在播放' })).toBeVisible();
    // 故意中断的模块请求会写一条网络错误；不能另有未处理的导入或渲染异常。
    expect(errors).toEqual(['Failed to load resource: net::ERR_FAILED']);
  });
}
