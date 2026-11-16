import { expect, type Locator, type Page } from '@playwright/test';
import type { AnswerTable, FakeHostOptions } from './fakeHost.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

// 设置页 e2e 的共用件：安装宿主替身，打开页面，从侧边栏进入设置页，再按标题查找卡片与控件

/** 设置页会调用、缺省应答表里没有的宿主方法，一律应答成功 */
const SETTINGS_ANSWERS: AnswerTable = {
  clipboard: { write: { success: true } },
  config: { showLibraryPreferences: { success: true } },
  misc: { showPreferences: { success: true } },
  shell: { openExternal: { success: true } },
};

/** 设置页的分区名，与目录中的文字一致。页面一次只显示一个分区，操作某分区的控件前须先切换到该分区 */
export type SettingsSectionName =
  '常规' | '外观' | '播放' | '沉浸视图' | '歌词' | '在线音乐' | '在线内容' | '快捷键' | '关于';

const settingsNav = (page: Page): Locator => page.getByRole('navigation', { name: '设置分类' });

/** 切换到指定分区 */
export async function showSection(page: Page, name: SettingsSectionName): Promise<void> {
  const nav = settingsNav(page);
  if ((await nav.getAttribute('data-settings-nav')) === 'menu') {
    const trigger = nav.getByRole('button');
    if ((await trigger.textContent())?.trim() !== name) {
      await trigger.click();
      await page.getByRole('menuitemradio', { name, exact: true }).click();
    }
  } else {
    await nav.getByRole('button', { name, exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
}

export interface SettingsPage {
  readonly host: PageHost;
  readonly errors: string[];
  /** 可滚动的卡片列 */
  readonly scroller: Locator;
  /** 分类导航：宽页为目录，窄页为页顶的分区名 */
  readonly nav: Locator;
  /** 切换到指定分区 */
  show(name: SettingsSectionName): Promise<void>;
  /** 标题为 `title` 的设置卡，或卡头标题为 `title` 的可展开卡 */
  card(title: string): Locator;
  /** 卡头标题为 `title` 的可展开卡 */
  expander(title: string): Locator;
  /** 可展开卡中标题为 `title` 的行 */
  row(title: string): Locator;
  /** 展开卡头标题为 `title` 的可展开卡，已展开时不做操作 */
  expand(title: string): Promise<void>;
  /** 标题为 `title` 的下拉框 */
  select(title: string): Locator;
  /** 在标题为 `title` 的控件中选择 `option`，按实际出现的控件（缩略图单选、图标分段或下拉框）操作 */
  choose(title: string, option: string): Promise<void>;
  /** 标题为 `title` 的缩略图单选组 */
  radios(title: string): Locator;
}

const BACKGROUND_SOURCES = ['主题色背景', '系统材质', '正在播放的封面', '流动色场', '图片'];

/** 窗口背景的可展开卡 */
export const backgroundCard = (page: Page): Locator =>
  page.locator('[data-settings-expander]').filter({
    has: page.locator(':scope > :first-child').getByText('窗口背景', { exact: true }),
  });

/** 窗口背景的五个来源选项，须先展开卡片 */
export const backgroundSources = (page: Page): Locator =>
  page.getByRole('radiogroup', { name: '背景来源', exact: true });

/** 切换到「外观」分区并展开窗口背景卡，已展开时不做操作 */
export async function openBackground(page: Page): Promise<void> {
  await showSection(page, '外观');
  const toggle = backgroundCard(page).locator('[data-settings-toggle]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** 材质行：卡片较宽时是页签，较窄时（右侧卡打开或窗口较窄）是单选，按实际出现的控件点击与断言 */
function materialRow(page: Page) {
  return {
    tabs: page.getByRole('tablist', { name: '材质', exact: true }),
    radios: page.getByRole('radiogroup', { name: '材质', exact: true }),
  };
}

/** 选择窗口背景：五个来源之一，或系统材质下的某一档材质（未选系统材质时先选中它） */
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

/** 断言窗口背景当前选中 `option`，断言前会展开卡片 */
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

/**
 * 按控件类型选择一项：依次尝试缩略图单选组与图标分段，都不是时按下拉框处理。窗口背景有两层选项，单独处理。
 * 同名控件在页面中出现不止一处时，用 `within` 限定在某一张卡中查找
 */
export async function chooseOption(
  page: Page,
  title: string,
  option: string,
  within: Page | Locator = page,
): Promise<void> {
  if (title === '窗口背景') {
    await chooseBackground(page, option);
    return;
  }
  const { group, tabs, box } = controlsOf(within, title);
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

/** 卡片中可能出现的三种控件：缩略图单选组、图标分段（页签）与下拉框 */
function controlsOf(scope: Page | Locator, title: string) {
  return {
    group: scope.getByRole('radiogroup', { name: title, exact: true }),
    tabs: scope.getByRole('tablist', { name: title, exact: true }),
    box: scope.getByRole('combobox', { name: title, exact: true }),
  };
}

/** 断言标题为 `title` 的控件当前选中 `option`，按实际出现的控件检查选中状态 */
export async function expectOption(
  page: Page,
  title: string,
  option: string,
  within: Page | Locator = page,
): Promise<void> {
  const { group, tabs, box } = controlsOf(within, title);
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
  // 没有展开区的可展开卡（如窗口背景选了材质）外观与设置卡相同，因此也按卡片查找
  const card = (title: string) =>
    page
      .locator('[data-settings-card]')
      .filter({ has: page.getByText(title, { exact: true }) })
      .or(expander(title));
  return {
    scroller: page.locator('[data-settings-scroller]'),
    nav: settingsNav(page),
    show: (name) => showSection(page, name),
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

/** 等待两帧：滚动的 scrollend 与 matchMedia 的 change 都在渲染更新步骤中派发，两帧之后都已到达 */
export async function waitFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * 从侧边栏进入设置页，窗口宽度须足以显示侧边栏。页面停在上次访问的分区（保存于浏览器偏好），
 * 传入 `section` 时再切换到该分区
 */
export async function enterSettings(page: Page, section?: SettingsSectionName): Promise<void> {
  await expect(page.getByRole('navigation', { name: '侧边栏' })).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '设置', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  if (section) await showSection(page, section);
}

/**
 * 安装宿主替身并进入设置页。`options.answers` 按命名空间覆盖设置页的缺省应答。
 * `section` 指定要操作的分区，不传时停在页面进入时的分区（缺省为「常规」）
 */
export async function openSettings(
  page: Page,
  options: FakeHostOptions = {},
  section?: SettingsSectionName,
): Promise<SettingsPage> {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, options);
  host.answerAll(SETTINGS_ANSWERS);
  host.answerAll(options.answers ?? {});
  await page.goto('/');
  await enterSettings(page, section);
  return { host, errors, ...handle(page) };
}

/** 不安装宿主替身进入设置页，即在普通浏览器中打开时的情形。等待宿主超时需要几秒，断言时须自行放宽时限 */
export async function openSettingsWithoutHost(
  page: Page,
  section?: SettingsSectionName,
): Promise<Omit<SettingsPage, 'host'>> {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await enterSettings(page, section);
  return { errors, ...handle(page) };
}
