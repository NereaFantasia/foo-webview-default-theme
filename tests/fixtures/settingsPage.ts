import { expect, type Locator, type Page } from '@playwright/test';
import type { AnswerTable, FakeHostOptions } from './fakeHost.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

// 设置页的 e2e 共用：装上宿主替身、打开页面、从侧边栏进设置页，再按标题找卡片与控件。

/**
 * 设置页要用、缺省应答表里没有的几个方法。材质应答保留本次提交的策略，失败场景由用例覆盖。
 */
const SETTINGS_ANSWERS: AnswerTable = {
  clipboard: { write: { success: true } },
  config: { showLibraryPreferences: { success: true } },
  misc: { showPreferences: { success: true } },
  shell: { openExternal: { success: true } },
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
  /** 选一项：缩略图单选、图标分段（页签）或下拉框，按卡里实际是哪种控件来点。 */
  choose(title: string, option: string): Promise<void>;
  /** 某张卡里的缩略图单选组。 */
  radios(title: string): Locator;
}

const BACKGROUND_SOURCES = ['主题色背景', '系统材质', '正在播放的封面', '流动色场', '图片'];

/** 窗口背景那张可展开卡。 */
export const backgroundCard = (page: Page): Locator =>
  page.locator('[data-settings-expander]').filter({
    has: page.locator(':scope > :first-child').getByText('窗口背景', { exact: true }),
  });

/** 窗口背景的来源五选一；要先展开卡。 */
export const backgroundSources = (page: Page): Locator =>
  page.getByRole('radiogroup', { name: '背景来源', exact: true });

/** 展开窗口背景卡；已展开就不动。 */
export async function openBackground(page: Page): Promise<void> {
  const toggle = backgroundCard(page).locator('[data-settings-toggle]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** 材质一行：卡宽时是页签，卡窄（右侧卡开着、窄窗口）时是单选，按实际是哪种来点与断言。 */
function materialRow(page: Page) {
  return {
    tabs: page.getByRole('tablist', { name: '材质', exact: true }),
    radios: page.getByRole('radiogroup', { name: '材质', exact: true }),
  };
}

/** 选窗口背景：五张来源图之一，或系统材质下的一档材质（没选系统材质就先选它）。 */
export async function chooseBackground(page: Page, option: string): Promise<void> {
  await openBackground(page);
  const sources = backgroundSources(page);
  if (BACKGROUND_SOURCES.includes(option)) {
    await sources.getByRole('radio', { name: option, exact: true }).check();
    return;
  }
  const material = sources.getByRole('radio', { name: '系统材质', exact: true });
  if (!(await material.isChecked())) await material.check();
  const { tabs, radios } = materialRow(page);
  await tabs.or(radios).first().waitFor();
  if ((await tabs.count()) > 0) await tabs.getByRole('tab', { name: option, exact: true }).click();
  else await radios.getByRole('radio', { name: option, exact: true }).check();
}

/** 断言窗口背景此刻选的是这一项；会把卡展开。 */
export async function expectBackground(page: Page, option: string): Promise<void> {
  await openBackground(page);
  const sources = backgroundSources(page);
  if (BACKGROUND_SOURCES.includes(option)) {
    await expect(sources.getByRole('radio', { name: option, exact: true })).toBeChecked();
    return;
  }
  await expect(sources.getByRole('radio', { name: '系统材质', exact: true })).toBeChecked();
  const { tabs, radios } = materialRow(page);
  await tabs.or(radios).first().waitFor();
  if ((await tabs.count()) > 0)
    await expect(tabs.getByRole('tab', { name: option, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  else await expect(radios.getByRole('radio', { name: option, exact: true })).toBeChecked();
}

/** 按控件类型选一项：缩略图单选组、图标分段，都不是就当下拉框；窗口背景是两层，单独走。 */
export async function chooseOption(page: Page, title: string, option: string): Promise<void> {
  if (title === '窗口背景') {
    await chooseBackground(page, option);
    return;
  }
  const { group, tabs, box } = controlsOf(page, title);
  await group.or(tabs).or(box).first().waitFor();
  if ((await group.count()) > 0) {
    await group.getByRole('radio', { name: option, exact: true }).check();
    return;
  }
  if ((await tabs.count()) > 0) {
    await tabs.getByRole('tab', { name: option, exact: true }).click();
    return;
  }
  await box.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** 某张卡里可能出现的三种控件：缩略图单选组、图标分段（页签）、下拉框。 */
function controlsOf(page: Page, title: string) {
  return {
    group: page.getByRole('radiogroup', { name: title, exact: true }),
    tabs: page.getByRole('tablist', { name: title, exact: true }),
    box: page.getByRole('combobox', { name: title, exact: true }),
  };
}

/** 断言某张卡里此刻选的是这一项：缩略图单选、图标分段（页签）或下拉框，按实际控件看选中态。 */
export async function expectOption(page: Page, title: string, option: string): Promise<void> {
  const { group, tabs, box } = controlsOf(page, title);
  await group.or(tabs).or(box).first().waitFor();
  if ((await group.count()) > 0) {
    await expect(group.getByRole('radio', { name: option, exact: true })).toBeChecked();
    return;
  }
  if ((await tabs.count()) > 0) {
    await expect(tabs.getByRole('tab', { name: option, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    return;
  }
  await expect(box).toHaveText(option);
}

function handle(page: Page): Omit<SettingsPage, 'host' | 'errors'> {
  const select = (title: string) => page.getByRole('combobox', { name: title, exact: true });
  const radios = (title: string) => page.getByRole('radiogroup', { name: title, exact: true });
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
    choose: (title, option) => chooseOption(page, title, option),
    radios,
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
