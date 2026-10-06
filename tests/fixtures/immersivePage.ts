import { expect, type Locator, type Page } from '@playwright/test';
import { openPlayer, type OpenPlayerOptions, type PlayerPage } from './playerPage.ts';

// 正在播放全屏页的 e2e 共用：装好正在放歌的宿主替身，换上 immersiveHarnessEntry.ts 这个入口打开主窗，
// 再直接走到这一页。

const ENTRY = "import '/tests/fixtures/immersiveHarnessEntry.ts';";

export interface ImmersivePage extends PlayerPage {
  /** 盖住整窗的那一层。 */
  readonly view: Locator;
}

export async function openImmersive(
  page: Page,
  options: Omit<OpenPlayerOptions, 'harness'> = {},
): Promise<ImmersivePage> {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: ENTRY }),
  );
  const player = await openPlayer(page, options);
  await page.waitForFunction(() => '__immersive' in window);
  await page.evaluate(() => {
    const harness: unknown = Reflect.get(window, '__immersive');
    const open = typeof harness === 'object' && harness ? Reflect.get(harness, 'open') : null;
    if (typeof open !== 'function') throw new Error('试验页没有挂上 __immersive.open');
    Reflect.apply(open, harness, []);
  });
  const view = page.getByRole('region', { name: '正在播放' });
  await expect(view).toBeVisible();
  return { ...player, view };
}
