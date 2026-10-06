import { expect, type Locator, type Page } from '@playwright/test';
import type { AnswerTable, FakeHostOptions } from './fakeHost.ts';
import { hostFailure } from './hostAnswers.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

// 设置页的 e2e 共用：装上宿主替身、打开页面、从侧边栏进设置页，再按标题找卡片与控件。

/**
 * 设置页要用、缺省应答表里没有的几个方法。材质下发答失败：材质服务不看这次应答，只有调用记录要紧。
 */
const SETTINGS_ANSWERS: AnswerTable = {
  clipboard: { write: { success: true } },
  config: { showLibraryPreferences: { success: true } },
  misc: { showPreferences: { success: true } },
  shell: { openExternal: { success: true } },
  window: { setBackdropPolicy: hostFailure('OPERATION_FAILED') },
};

export interface SettingsPage {
  readonly host: PageHost;
  readonly errors: string[];
  /** 自己滚动的卡列。 */
  readonly scroller: Locator;
  /** 分类导航，目录或分类条。 */
  readonly nav: Locator;
  /** 标题是这个名字的那张设置卡，或卡头标题是这个名字的可展开卡。 */
  card(title: string): Locator;
  /** 卡头标题是这个名字的那张可展开卡。 */
  expander(title: string): Locator;
  /** 可展开卡里标题是这个名字的那一行。 */
  row(title: string): Locator;
  /** 把这张可展开卡展开；已经展开就不动。 */
  expand(title: string): Promise<void>;
  /** 某张卡里的下拉框。 */
  select(title: string): Locator;
  /** 展开下拉框并选一项。 */
  choose(title: string, option: string): Promise<void>;
}

function handle(page: Page): Omit<SettingsPage, 'host' | 'errors'> {
  const select = (title: string) => page.getByRole('combobox', { name: title, exact: true });
  const expander = (title: string) =>
    page.locator('[data-settings-expander]').filter({
      has: page.locator(':scope > :first-child').getByText(title, { exact: true }),
    });
  // 没有展开区的可展开卡（窗口背景选了材质）看上去就是一张设置卡，也按卡找。
  const card = (title: string) =>
    page
      .locator('[data-settings-card]')
      .filter({ has: page.getByText(title, { exact: true }) })
      .or(expander(title));
  return {
    scroller: page.locator('[data-settings-scroller]'),
    nav: page.getByRole('navigation', { name: '设置分类' }),
    card,
    expander,
    row: (title) =>
      page.locator('[data-settings-row]').filter({ has: page.getByText(title, { exact: true }) }),
    async expand(title) {
      const toggle = expander(title).locator('[data-settings-toggle]');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    },
    select,
    async choose(title, option) {
      await select(title).click();
      await page.getByRole('option', { name: option, exact: true }).click();
    },
  };
}

/** 等两帧：滚动的 scrollend、matchMedia 的 change 都在渲染更新那一步派发，等过这两帧它们都已经到了。 */
export async function waitFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** 从侧边栏点「设置」进设置页；窗口要宽到侧边栏看得见。 */
export async function enterSettings(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: '侧边栏' })).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '设置', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
}

/** 装上宿主替身并进设置页。`options.answers` 按命名空间盖在设置页的几条缺省应答上。 */
export async function openSettings(
  page: Page,
  options: FakeHostOptions = {},
): Promise<SettingsPage> {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, options);
  host.answerAll(SETTINGS_ANSWERS);
  host.answerAll(options.answers ?? {});
  await page.goto('/');
  await enterSettings(page);
  return { host, errors, ...handle(page) };
}

/** 不装宿主替身进设置页：普通浏览器里打开的样子。等宿主超时要几秒，断言时自己放宽时限。 */
export async function openSettingsWithoutHost(page: Page): Promise<Omit<SettingsPage, 'host'>> {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await enterSettings(page);
  return { errors, ...handle(page) };
}
