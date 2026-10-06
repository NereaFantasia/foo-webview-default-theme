import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 命令登记处挂在真实的 window 上：鼠标侧键与 Alt+← / → 由全局历史认领，缺省的页面后退被拦下。
// 这里只看输入有没有被接住、页面有没有被带走；在地点之间走一遍的用例在 album-wall 与 album-page-state。

/** 启动落在专辑页；替身的媒体库是空的，页面上写着空库。 */
const START_TEXT = '媒体库为空';

/** 经 CDP 发一次可信的侧键点击；Playwright 的 mouse 只有左、中、右三个键。 */
async function clickSideButton(page: Page, button: 'back' | 'forward'): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: 40, y: 40, button, clickCount: 1 });
  }
  await cdp.detach();
}

/**
 * 在登记处之后再挂一组监听，记下每个输入到它这里时缺省拦了没有。同一目标同一阶段按挂的先后调，
 * 所以这里看到的就是登记处处理之后的结果。
 */
async function recordDefaults(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    const note = (label: string, prevented: boolean) => {
      seen.push(`${label}=${prevented}`);
      document.body.dataset.seen = seen.join(' ');
    };
    for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) {
      window.addEventListener(
        type,
        (event) => note(`${type}${event.button}`, event.defaultPrevented),
        true,
      );
    }
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Alt')
        note(`${event.altKey ? 'Alt+' : ''}${event.key}`, event.defaultPrevented);
    });
  });
  return async () => ((await page.locator('body').getAttribute('data-seen')) ?? '').split(' ');
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = collectPageErrors(page);
  await installPageHost(page);
  // 先有一条浏览器历史，缺省的后退一旦没拦住，页面就会回到 about:blank。
  await page.goto('about:blank');
  await page.goto('/');
  await expect(page.getByText(START_TEXT)).toBeVisible();
});

test('鼠标后退、前进键被全局历史认领，页面不被带走', async ({ page }) => {
  const seen = await recordDefaults(page);

  await clickSideButton(page, 'back');
  await clickSideButton(page, 'forward');
  expect(await seen()).toEqual([
    'mousedown3=true',
    'mouseup3=true',
    'auxclick3=true',
    'mousedown4=true',
    'mouseup4=true',
    'auxclick4=true',
  ]);

  // 缺省后退在松开之后才发起导航，留一点时间让它发生（若没拦住）。
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.getByText(START_TEXT)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Alt+← / → 退不回去时也被认领，普通方向键不碰', async ({ page }) => {
  const seen = await recordDefaults(page);

  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('ArrowLeft');
  expect(await seen()).toEqual(['Alt+ArrowLeft=true', 'Alt+ArrowRight=true', 'ArrowLeft=false']);
  await expect(page.getByText(START_TEXT)).toBeVisible();
  expect(errors).toEqual([]);
});
