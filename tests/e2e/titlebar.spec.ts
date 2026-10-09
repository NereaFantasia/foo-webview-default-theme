import type { MenuTreeNode } from 'foo-webview-sdk';
import { expect, test, type Page } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';
import { choosePlayerBar } from '../fixtures/playerPage.ts';

// 标题栏的键接到宿主替身上：三大键发窗口命令、⋯ 弹出宿主主菜单并按 GUID 执行；两种播放栏形态下的
// 高度，最大化键的矩形上报与贴靠布局下的悬停提示。拖动只断言样式上标了哪几块，真拖不拖得动、贴靠布局
// 出不出来要在宿主里实机看。

const ROOTS: readonly [string, string][] = [
  ['File', '文件'],
  ['Edit', '编辑'],
  ['View', '视图'],
  ['Playback', '播放'],
  ['Library', '媒体库'],
  ['Help', '帮助'],
];

function submenu(label: string, displayLabel: string, children: MenuTreeNode[]): MenuTreeNode {
  return { type: 'submenu', label, displayLabel, path: label, children };
}

const TREE: MenuTreeNode[] = ROOTS.map(([label, display]) =>
  submenu(
    label,
    display,
    label === 'Playback'
      ? [
          {
            type: 'command',
            label: 'Stop',
            displayLabel: '停止',
            guid: 'stop-guid',
            path: 'Playback/Stop',
          },
          { type: 'separator' },
          {
            type: 'command',
            label: 'Stop after current',
            displayLabel: '播完当前停止',
            guid: 'sac-guid',
            path: 'Playback/Stop after current',
            checked: true,
          },
        ]
      : [{ type: 'command', label: `${label} item`, guid: `${label}-guid`, path: `${label}/item` }],
  ),
);

function answerTree(host: PageHost): void {
  host.answer('menu.getMainMenu', {
    success: true,
    root: '',
    requestedRoot: '',
    rootMatched: true,
    locale: 'zh-CN',
    i18n: true,
    withAvailability: true,
    items: TREE,
  });
}

let errors: string[] = [];
let host: PageHost;

async function open(page: Page): Promise<void> {
  errors = collectPageErrors(page);
  host = await installPageHost(page);
  answerTree(host);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '关闭' })).toBeEnabled();
}

test('三大键发窗口命令，最大化之后键名换成还原', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '最小化' }).click();
  await expect.poll(() => host.callsTo('window.minimize').length).toBe(1);

  host.answer('window.toggleMaximize', { success: true, maximized: true });
  host.answer('window.getState', {
    success: true,
    maximized: true,
    minimized: false,
    fullscreen: false,
    alwaysOnTop: false,
    focused: true,
    isMaximized: true,
    isMinimized: false,
    isFullscreen: false,
    isAlwaysOnTop: false,
    isFocused: true,
    width: 1280,
    height: 800,
    x: 0,
    y: 0,
  });
  await page.getByRole('button', { name: '最大化' }).click();
  await expect(page.getByRole('button', { name: '还原' })).toBeVisible();

  await page.getByRole('button', { name: '关闭' }).click();
  await expect.poll(() => host.callsTo('window.close').length).toBe(1);
  expect(errors).toEqual([]);
});

test('窗口最大化着启动：一开始就显示还原键，不显示最大化键', async ({ page }) => {
  errors = collectPageErrors(page);
  host = await installPageHost(page, {
    answers: {
      window: {
        getState: {
          success: true,
          maximized: true,
          minimized: false,
          fullscreen: false,
          alwaysOnTop: false,
          focused: true,
          isMaximized: true,
          isMinimized: false,
          isFullscreen: false,
          isAlwaysOnTop: false,
          isFocused: true,
          width: 1280,
          height: 800,
          x: 0,
          y: 0,
        },
      },
    },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '还原' })).toBeVisible();
  await expect(page.getByRole('button', { name: '最大化' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** 元素的边框盒，取整到像素。 */
function boxOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
    });
}

test('标题栏把实测高度交给宿主；整条是拖动区，键退出拖动', async ({ page }) => {
  await open(page);
  await expect.poll(() => host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 48 }]);
  const region = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'));
  expect(await region('header')).toBe('drag');
  expect(await region('[role="toolbar"]')).toBe('no-drag');
  expect(await region('header button[data-caption="maximize"]')).toBe('no-drag');
  expect(errors).toEqual([]);
});

test('播放栏在底部时标题栏各档都是 48 高，跨档不重报高度；窗口三键铺满整条高', async ({ page }) => {
  await open(page);
  await expect.poll(() => host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 48 }]);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
  expect(await boxOf(page, '[data-menu="main"]')).toMatchObject({ x: 8, width: 40, height: 32 });
  expect(await boxOf(page, '[data-caption="maximize"]')).toEqual({
    x: 1280 - 92,
    y: 0,
    width: 46,
    height: 48,
  });
  await page.setViewportSize({ width: 900, height: 800 });
  // 最大化键的新矩形与高度出自同一次布局；等宿主收到新矩形，再看高度有没有多报。
  await expect
    .poll(() => host.callsTo('window.setMaximizeButtonRegion').at(-1))
    .toEqual({ region: { x: 900 - 92, y: 0, width: 46, height: 48 } });
  await page.waitForTimeout(200);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 48 });
  expect(host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 48 }]);
  expect(errors).toEqual([]);
});

test('播放栏在底部时后退、前进与侧边栏键在标题栏左段：40 × 32、彼此隔 2，内容卡里没有导航行', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('[data-nav-row]')).toHaveCount(0);
  const tools = page.getByRole('toolbar', { name: '窗口工具' });
  for (const [index, selector] of [
    '[data-menu="main"]',
    '[data-nav="back"]',
    '[data-nav="forward"]',
    '[data-sidebar-key]',
  ].entries()) {
    expect(await boxOf(page, `header ${selector}`)).toEqual({
      x: 8 + 42 * index,
      y: 8,
      width: 40,
      height: 32,
    });
  }
  await expect(tools.getByRole('button', { name: '后退' })).toBeDisabled();
  await tools.getByRole('button', { name: '隐藏侧边栏' }).click();
  await expect(page.locator('aside')).toHaveCount(0);
  await tools.getByRole('button', { name: '显示侧边栏' }).click();
  await expect(page.locator('aside')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('播放栏在标题栏时宽窗 64 高、窄窗 48 高，高度都交给宿主；⋯ 离左缘 8，窗口三键铺满整条高', async ({
  page,
}) => {
  await choosePlayerBar(page, 'titlebar');
  await open(page);
  expect(await boxOf(page, 'header')).toMatchObject({ height: 64 });
  expect(await boxOf(page, '[data-menu="main"]')).toMatchObject({ x: 8, width: 28, height: 36 });
  expect(await boxOf(page, '[data-caption="maximize"]')).toEqual({
    x: 1280 - 92,
    y: 0,
    width: 46,
    height: 64,
  });

  await page.setViewportSize({ width: 900, height: 800 });
  await expect.poll(() => boxOf(page, 'header')).toMatchObject({ height: 48 });
  expect(await boxOf(page, '[data-caption="maximize"]')).toEqual({
    x: 900 - 92,
    y: 0,
    width: 46,
    height: 48,
  });
  const header = page.locator('header');
  for (const name of ['主菜单', '最小化', '最大化', '关闭']) {
    await expect(header.getByRole('button', { name })).toBeVisible();
  }
  await expect
    .poll(() => host.callsTo('window.setTitlebarHeight'))
    .toEqual([{ height: 64 }, { height: 48 }]);
  expect(errors).toEqual([]);
});

test('最大化键的矩形报给宿主，标题栏换档、窗口缩放时重报，同值不重发', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  await open(page);
  const regions = () => host.callsTo('window.setMaximizeButtonRegion');
  await expect.poll(regions).toEqual([{ region: { x: 1188, y: 0, width: 46, height: 64 } }]);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect
    .poll(regions)
    .toEqual([
      { region: { x: 1188, y: 0, width: 46, height: 64 } },
      { region: { x: 1008, y: 0, width: 46, height: 64 } },
    ]);
  await page.setViewportSize({ width: 1100, height: 600 });
  await page.setViewportSize({ width: 900, height: 600 });
  await expect
    .poll(() => regions().at(-1))
    .toEqual({
      region: { x: 808, y: 0, width: 46, height: 48 },
    });
  expect(regions()).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('系统给贴靠布局时最大化键不出悬停提示，名字照样在；别的键照常出', async ({ page }) => {
  errors = collectPageErrors(page);
  host = await installPageHost(page, {
    answers: {
      window: {
        setMaximizeButtonRegion: { success: true, hasRegion: true, snapLayouts: true, scale: 1 },
      },
    },
  });
  await page.goto('/');
  const maximize = page.getByRole('button', { name: '最大化' });
  await expect(maximize).toBeEnabled();
  await expect.poll(() => host.callsTo('window.setMaximizeButtonRegion').length).toBe(1);
  await page.getByRole('button', { name: '最小化' }).hover();
  await expect(page.getByRole('tooltip', { name: '最小化' })).toBeVisible();
  await maximize.hover();
  await page.waitForTimeout(1000);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(maximize).toHaveAttribute('aria-label', '最大化');
  expect(errors).toEqual([]);
});

test('⋯ 首读还没回来时占位项写「正在读取」，读到了才换成宿主的根', async ({ page }) => {
  errors = collectPageErrors(page);
  host = await installPageHost(page);
  answerTree(host);
  const held = host.hold('menu.getMainMenu');
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '主菜单' });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const placeholder = page.getByRole('menuitem', { name: '正在读取菜单…' });
  await expect(placeholder).toHaveAttribute('aria-disabled', 'true');

  held.release();
  const roots = page.getByRole('menu').first().getByRole('menuitem');
  await expect(roots).toHaveText(ROOTS.map(([, display]) => display));
  expect(errors).toEqual([]);
});

test('⋯ 读到空树时给一条置灰的占位项；之前读失败过，读成功后不再报失败', async ({ page }) => {
  errors = collectPageErrors(page);
  host = await installPageHost(page);
  host.answer('menu.getMainMenu', hostFailure('INTERNAL_ERROR'));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '主菜单' });
  await expect(trigger).toBeEnabled();
  await expect.poll(() => host.callsTo('menu.getMainMenu').length).toBeGreaterThan(0);

  host.answer('menu.getMainMenu', {
    success: true,
    root: '',
    requestedRoot: '',
    rootMatched: true,
    locale: 'zh-CN',
    i18n: true,
    withAvailability: true,
    items: [],
  });
  await trigger.click();
  const placeholder = page.getByRole('menuitem', { name: '没有可用的菜单项' });
  await expect(placeholder).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu').first().getByRole('menuitem')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('⋯ 弹出 fb2k 的六个根，打开时重读；点命令按 GUID 执行', async ({ page }) => {
  await open(page);
  const reads = host.callsTo('menu.getMainMenu').length;
  await page.getByRole('button', { name: '主菜单' }).click();
  const roots = page.getByRole('menu').first().getByRole('menuitem');
  await expect(roots).toHaveText(ROOTS.map(([, display]) => display));
  expect(host.callsTo('menu.getMainMenu').length).toBeGreaterThan(reads);

  await page.getByRole('menuitem', { name: '播放' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: '播完当前停止' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitem', { name: '停止' }).click();
  await expect
    .poll(() => host.callsTo('menu.runMainMenuCommand'))
    .toEqual([{ command: 'stop-guid' }]);
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(errors).toEqual([]);
});
