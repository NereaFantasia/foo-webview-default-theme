import { expect, test, type Page } from '@playwright/test';
import type { AlbumInfo } from 'foo-webview-sdk';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { FakePlaylists } from '../fixtures/fakePlaylists.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { DEFAULT_LISTS } from '../fixtures/sidebarPage.ts';

// 侧边栏的拖拽折叠、图标态与窄窗浮层：握柄的拖动吸附、Esc、双击与键盘，窗口宽度三档，导航行的侧边栏键
// （宽档隐藏与摆回、窄档浮层），两种形态的图标对齐，图标态的列表浮层与小圆点，换形态的动画。
// 动画的观感、拖放悬停自动弹出只能实机看。

const STORAGE_KEY = 'default-theme.sidebar.v1';

interface ShellOptions {
  /** 页面加载之前写进存档的侧边栏形态。 */
  readonly prefs?: Readonly<Record<string, unknown>>;
  readonly width?: number;
  /** 媒体库里的专辑；不给是空库，封面墙一块都不画。 */
  readonly albums?: readonly AlbumInfo[];
}

async function openShell(page: Page, options: ShellOptions = {}) {
  await page.setViewportSize({ width: options.width ?? 1280, height: 800 });
  if (options.prefs) {
    const saved = JSON.stringify(options.prefs);
    await page.addInitScript(
      ([key, value]) => {
        if (key && value) localStorage.setItem(key, value);
      },
      [STORAGE_KEY, saved],
    );
  }
  await page.addInitScript(recordAnimate);
  const errors = collectPageErrors(page);
  const host = await installPageHost(
    page,
    options.albums ? { answers: libraryAnswers(options.albums) } : undefined,
  );
  const lists = new FakePlaylists(host, DEFAULT_LISTS, (event, payload) =>
    host.emit(event, payload),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  const body = page.locator('[data-sidebar]');
  return {
    host,
    lists,
    errors,
    body,
    splitter: page.getByRole('separator', { name: '调整侧边栏宽度' }),
    key: page.locator('[data-sidebar-key]'),
    nav: page.getByRole('navigation', { name: '侧边栏' }),
    saved: () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORAGE_KEY),
    columnWidth: () =>
      page.locator('aside').evaluate((element) => element.getBoundingClientRect().width),
  };
}

type Shell = Awaited<ReturnType<typeof openShell>>;

/**
 * 页面里每一次 `Element.animate` 都记一笔，动画播没播完都查得到：窗格与内容区的裁剪、平移记成
 * 「属性 时长 起 → 止」，带 `data-pane-only` 的淡出淡入记成「起→止 延迟 fill」，封面墙换列时的位移与淡入只记是哪一块。
 * `holdAnimations` 为真时新建的动画当场暂停，测中途打断时不必和 200 ms 赛跑。
 */
function recordAnimate() {
  const motion: string[] = [];
  const fades: string[] = [];
  const reflows: string[] = [];
  Reflect.set(window, 'paneMotionLog', motion);
  Reflect.set(window, 'paneFadeLog', fades);
  Reflect.set(window, 'wallReflowLog', reflows);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const frames = Array.isArray(keyframes) ? keyframes : [];
    const keys = ['clipPath', 'translate'].filter((key) => frames.some((frame) => key in frame));
    const timing = typeof options === 'number' ? { duration: options } : (options ?? {});
    // 只认窗格（aside 下的那一层）与内容区，别的件自带的位移不算。
    const shell = this.tagName === 'MAIN' || this.parentElement?.tagName === 'ASIDE';
    if (keys.length > 0 && shell) {
      const values = frames.map((frame) => keys.map((key) => String(frame[key])).join(','));
      motion.push(`${keys.join('+')} ${String(timing.duration)} ${values.join(' → ')}`);
    } else if (this.hasAttribute('data-pane-only')) {
      const [start, end] = [frames[0], frames[frames.length - 1]].map((frame) =>
        String(frame?.['opacity']),
      );
      fades.push(`${start}→${end} ${String(timing.delay ?? 0)} ${String(timing.fill)}`);
    } else if (this.hasAttribute('data-reflow-key') || this.hasAttribute('data-reflow-follow')) {
      reflows.push(this.getAttribute('data-reflow-key') ?? 'follow');
    }
    const animation = original.call(this, keyframes, options);
    if (Reflect.get(window, 'holdAnimations') === true) animation.pause();
    return animation;
  };
}

/**
 * 取出记下的一类并清空：`paneMotionLog` 是裁剪与平移，`paneFadeLog` 是淡出淡入，`wallReflowLog` 是封面墙
 * 换列。
 */
function takeLog(
  page: Page,
  name: 'paneMotionLog' | 'paneFadeLog' | 'wallReflowLog',
): Promise<string[]> {
  return page.evaluate((key) => {
    const log: unknown = Reflect.get(window, key);
    const taken = Array.isArray(log)
      ? log.filter((item): item is string => typeof item === 'string')
      : [];
    if (Array.isArray(log)) log.length = 0;
    return taken;
  }, name);
}

const takeMotion = (page: Page) => takeLog(page, 'paneMotionLog');
const takeFades = (page: Page) => takeLog(page, 'paneFadeLog');

/** 之后新建的动画当场暂停（`on` 为真）或照常播。 */
async function holdAnimations(page: Page, on: boolean) {
  await page.evaluate((value) => Reflect.set(window, 'holdAnimations', value), on);
}

/** 把此刻所有暂停着的动画拨到第 `ms` 毫秒。 */
async function seekHeld(page: Page, ms: number) {
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) {
      if (animation.playState === 'paused') animation.currentTime = time;
    }
  }, ms);
}

/** 按下握柄中间，依次挪到这几个横坐标，不松手。 */
async function dragTo(page: Page, shell: Shell, xs: readonly number[]) {
  const box = await shell.splitter.boundingBox();
  if (!box) throw new Error('握柄没画出来');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (const x of xs) await page.mouse.move(x, y, { steps: 2 });
}

/** 让正在播的动画都播完，形态与布局落到终值。 */
async function settleMotion(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

test('拖过收起线吸成图标态，拖回过展开线展开到 200 再跟手；松手时的形态与宽度落盘', async ({
  page,
}) => {
  const shell = await openShell(page);
  // 指针横坐标减去握柄半宽 4 就是侧边栏宽度。
  await dragTo(page, shell, [154]);
  await expect(shell.body).toHaveAttribute('data-sidebar', 'expanded');
  expect(await shell.columnWidth()).toBe(200);
  await page.mouse.move(118, 400, { steps: 2 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  expect(await shell.columnWidth()).toBe(48);
  // 滞回带里来回不切。
  await page.mouse.move(134, 400);
  await page.mouse.move(124, 400);
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await page.mouse.move(140, 400);
  await expect(shell.body).toHaveAttribute('data-sidebar', 'expanded');
  expect(await shell.columnWidth()).toBe(200);
  await page.mouse.move(304, 400, { steps: 3 });
  await page.mouse.up();
  expect(await shell.columnWidth()).toBe(300);
  expect(await shell.saved()).toMatchObject({ rail: false, width: 300 });
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '300');
  expect(shell.errors).toEqual([]);
});

test('拖动中按 Esc 回到拖动之前的形态与宽度，之后再挪指针也不跟', async ({ page }) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 320 } });
  await dragTo(page, shell, [240, 100]);
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await page.keyboard.press('Escape');
  await expect(shell.body).toHaveAttribute('data-sidebar', 'expanded');
  expect(await shell.saved()).toMatchObject({ rail: false, width: 320 });
  await page.mouse.move(220, 400);
  await page.mouse.up();
  expect(await shell.columnWidth()).toBe(320);
  // Esc 只收了拖动，页面没有别的动静。
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  expect(shell.errors).toEqual([]);
});

test('双击握柄：在图标态与上次的展开宽度之间切换，侧边栏键不跟着变', async ({ page }) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 280 } });
  await shell.splitter.dblclick();
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await expect(shell.key).toHaveAccessibleName('隐藏侧边栏');
  await expect(shell.key).toHaveAttribute('aria-expanded', 'true');
  await shell.splitter.dblclick();
  await expect(shell.body).toHaveAttribute('data-sidebar', 'expanded');
  await settleMotion(page);
  expect(await shell.columnWidth()).toBe(280);
  expect(await shell.saved()).toMatchObject({ rail: false, width: 280 });
  expect(shell.errors).toEqual([]);
});

test('侧边栏键把侧边栏整个藏起来，没有握柄、内容卡占满；再按照原来的形态与宽度摆回来，存档记下', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: true, width: 280 } });
  await expect(shell.key).toHaveAccessibleName('隐藏侧边栏');
  await shell.key.click();
  await expect(shell.body).toHaveAttribute('data-sidebar', 'none');
  await expect(shell.key).toHaveAccessibleName('显示侧边栏');
  await expect(shell.key).toHaveAttribute('aria-expanded', 'false');
  await expect(shell.splitter).toHaveCount(0);
  await settleMotion(page);
  await expect(page.locator('aside')).toHaveCount(0);
  expect(
    await page.locator('main').evaluate((element) => element.getBoundingClientRect().left),
  ).toBe(0);
  expect(await shell.saved()).toMatchObject({ hidden: true, rail: true, width: 280 });

  // 藏着时窗口缩窄照样恒为图标态，拉回来还是藏着。
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'none');

  await shell.key.click();
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await expect(shell.splitter).toBeVisible();
  await shell.splitter.dblclick();
  await settleMotion(page);
  expect(await shell.columnWidth()).toBe(280);
  expect(await shell.saved()).toMatchObject({ hidden: false, rail: false, width: 280 });
  expect(shell.errors).toEqual([]);
});

test('两种形态里同一项的图标在同一处；分节标题与细线占同样的高度', async ({ page }) => {
  const shell = await openShell(page);
  const iconBox = (name: string) =>
    shell.nav
      .getByRole('button', { name })
      .locator('svg')
      .first()
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width };
      });
  const names = ['首页', '专辑', '设置'];
  const expanded = await Promise.all(names.map(iconBox));
  await shell.splitter.dblclick();
  await settleMotion(page);
  // 两种形态里各项同名，等图标态换上、展开态卸掉再量，免得量到正被卸掉的那一个。
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await expect(shell.nav.getByRole('button', { name: '首页', exact: true })).toHaveCount(1);
  const rail = await Promise.all(names.map(iconBox));
  expect(rail).toEqual(expanded);
  expect(shell.errors).toEqual([]);
});

test('握柄的键盘：← / → 每步 16，在 200 再按 ← 进图标态，→ 回到 200；End 到 360，Home 到图标态，Enter 切换', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 216 } });
  await shell.splitter.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '200');
  await page.keyboard.press('ArrowLeft');
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '48');
  await page.keyboard.press('ArrowRight');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '200');
  await page.keyboard.press('ArrowRight');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '216');
  await page.keyboard.press('End');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '360');
  await page.keyboard.press('Home');
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await page.keyboard.press('Enter');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '360');
  await expect(shell.splitter).toBeFocused();
  // Alt+← 仍是后退，不被握柄接走。
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(shell.splitter).toHaveAttribute('aria-valuenow', '360');
  expect(shell.errors).toEqual([]);
});

test('窗口缩到 1000 强制图标态、没有握柄；拉回 1280 恢复用户存的形态，存档不动', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 300 } });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await expect(shell.splitter).toHaveCount(0);
  // 跨档直接到位，不播展开 ↔ 图标态的动画。
  const running = await page.evaluate(() => document.getAnimations().length);
  expect(running).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'expanded');
  expect(await shell.columnWidth()).toBe(300);
  expect(await shell.saved()).toEqual({ rail: false, width: 300 });
  expect(shell.errors).toEqual([]);
});

test('641–1007：侧边栏键从图标条原地展开整张侧边栏，宽度用存的值；点外面、Esc 关，拉过 1008 立刻关', async ({
  page,
}) => {
  const shell = await openShell(page, { width: 900, prefs: { rail: false, width: 280 } });
  const overlay = page.locator('[data-sidebar-overlay]');
  await expect(shell.key).toHaveAccessibleName('展开侧边栏');
  await shell.key.click();
  await expect(overlay).toBeVisible();
  await expect(shell.key).toHaveAttribute('aria-expanded', 'true');
  await settleMotion(page);
  expect(await overlay.evaluate((element) => element.getBoundingClientRect().width)).toBe(280);
  await expect(overlay.getByRole('button', { name: '新建', exact: true })).toBeVisible();
  await page.mouse.click(700, 400);
  await expect(overlay).toHaveCount(0);
  await shell.key.click();
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(shell.key).toBeFocused();
  await shell.key.click();
  await expect(overlay).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(overlay).toHaveCount(0);
  await expect(shell.body).toHaveAttribute('data-sidebar', 'expanded');
  expect(shell.errors).toEqual([]);
});

test('≤ 640：不显示侧边栏，标题栏留着 ⋯，导航行留着后退、前进与展开键；从浮层里点一项就去那里并关掉浮层', async ({
  page,
}) => {
  const shell = await openShell(page, { width: 600 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'none');
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(
    page.getByRole('toolbar', { name: '窗口工具' }).getByRole('button', { name: '主菜单' }),
  ).toBeVisible();
  const navRow = page.locator('[data-nav-row]');
  for (const name of ['后退', '前进', '展开侧边栏']) {
    await expect(navRow.getByRole('button', { name })).toBeVisible();
  }
  await shell.key.click();
  const overlay = page.locator('[data-sidebar-overlay]');
  await overlay.locator(`[data-playlist-entry="${shell.lists.guid('Road Trip')}"]`).click();
  await expect(
    page
      .locator('[data-page="playlist"]')
      .getByRole('heading', { level: 1, name: 'Road Trip', exact: true }),
  ).toBeVisible();
  await expect(overlay).toHaveCount(0);
  expect(shell.errors).toEqual([]);
});

test('图标态：点「播放列表」弹出列表浮层，能点开一张列表并关掉；Esc 关、焦点回到图标', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: true, width: 260 } });
  const icon = shell.nav.getByRole('button', { name: '播放列表' });
  const flyout = page.getByRole('dialog', { name: '播放列表' });
  await icon.click();
  await expect(flyout).toBeVisible();
  await expect(icon).toHaveAttribute('aria-expanded', 'true');
  // 这一节在浮层里不能收起。
  await expect(flyout.getByRole('button', { name: /展开或收起/ })).toHaveCount(0);
  await expect(
    flyout.locator(`[data-playlist-entry="${shell.lists.guid('Default')}"]`),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(flyout).toHaveCount(0);
  await expect(icon).toBeFocused();
  await icon.click();
  await flyout.locator(`[data-playlist-entry="${shell.lists.guid('Road Trip')}"]`).click();
  await expect(
    page
      .locator('[data-page="playlist"]')
      .getByRole('heading', { level: 1, name: 'Road Trip', exact: true }),
  ).toBeVisible();
  await expect(flyout).toHaveCount(0);
  await expect(icon).toHaveAttribute('aria-current', 'page');
  expect(shell.errors).toEqual([]);
});

test('图标态的列表浮层里改名：点外面只提交改名，浮层不关；改完再点外面才关', async ({ page }) => {
  const shell = await openShell(page, { prefs: { rail: true, width: 260 } });
  await shell.nav.getByRole('button', { name: '播放列表' }).click();
  const flyout = page.getByRole('dialog', { name: '播放列表' });
  await flyout.locator(`[data-playlist-entry="${shell.lists.guid('Road Trip')}"]`).focus();
  await page.keyboard.press('F2');
  await page.keyboard.type('Night Drive');
  await page.mouse.click(700, 400);
  await expect
    .poll(() => shell.host.callsTo('playlist.rename').map((params) => params['name']))
    .toEqual(['Night Drive']);
  await expect(flyout).toBeVisible();
  await page.mouse.click(700, 400);
  await expect(flyout).toHaveCount(0);
  expect(shell.errors).toEqual([]);
});

test('图标态：分节标题换成细线，资料库各项常显；播放列表保留在播标记，队列不占导航项', async ({
  page,
}) => {
  const shell = await openShell(page, {
    prefs: { rail: true, width: 260, sections: { library: false, playlists: true } },
  });
  await expect(shell.nav.getByRole('button', { name: /展开或收起/ })).toHaveCount(0);
  await expect(shell.nav.getByRole('separator')).toHaveCount(2);
  for (const name of ['最近添加（即将推出）', '专辑', '文件夹', '设置']) {
    await expect(shell.nav.getByRole('button', { name })).toBeVisible();
  }
  const dotOf = (name: string) =>
    shell.nav.getByRole('button', { name }).locator('[data-sidebar-dot]');
  // 缺省的清单里 Chill 在播。
  await expect(dotOf('播放列表')).toHaveCount(1);
  await expect(shell.nav.getByRole('button', { name: /播放队列/ })).toHaveCount(0);
  await shell.host.emit('playback:queueChanged', { origin: 'user_added', count: 2 });
  await expect(shell.nav.getByRole('button', { name: /播放队列/ })).toHaveCount(0);
  expect(await shell.saved()).toEqual({
    rail: true,
    width: 260,
    sections: { library: false, playlists: true },
  });
  expect(shell.errors).toEqual([]);
});

test('展开 ↔ 图标态播 200 ms：窗格裁剪、内容位移，只在一种形态里有的部分淡出淡入；收起时裁剪走完才换成图标态；封面墙不播换列', async ({
  page,
}) => {
  const shell = await openShell(page, { albums: SAMPLE_ALBUMS });
  const columns = () =>
    page
      .locator('[data-album-tile]')
      .evaluateAll((tiles) =>
        Math.max(...tiles.map((tile) => Number(tile.getAttribute('aria-colindex')))),
      );
  const wide = await columns();
  await takeMotion(page);
  await shell.splitter.dblclick();
  expect(await takeMotion(page)).toEqual([
    'clipPath+translate 200 inset(0 0px 0 0),0px 0 → inset(0 212px 0 0),0px 0',
    'translate 200 212px 0 → 0 0',
  ]);
  // 收起途中窗格里还是展开态的内容；搜索框、分节标题与播放列表节当场淡出，停在透明。
  await expect(shell.nav.getByRole('button', { name: '新建', exact: true })).toHaveCount(1);
  expect(await takeFades(page)).toEqual(Array(3).fill('1→0 0 forwards'));
  await settleMotion(page);
  await expect(shell.nav.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
  await expect(shell.nav.getByRole('button', { name: '播放列表' })).toBeVisible();
  expect(await columns()).toBeGreaterThan(wide);
  // 换上图标态之后放大镜、两条细线与播放列表图标从透明淡入，不等。
  await expect.poll(() => takeFades(page)).toEqual(Array(4).fill('0→1 0 backwards'));
  await settleMotion(page);
  await shell.splitter.dblclick();
  expect(await takeMotion(page)).toEqual([
    'clipPath+translate 200 inset(0 212px 0 0),0px 0 → inset(0 0px 0 0),0px 0',
    'translate 200 -212px 0 → 0 0',
  ]);
  // 展开时当场换上展开态，那几部分先透明着等 100 ms 再淡入。
  expect(await takeFades(page)).toEqual(Array(3).fill('0→1 100 backwards'));
  await settleMotion(page);
  // 收成图标态时封面墙多出一列，展开回来又少一列；两次换列都直接到位，一块都不滑。
  expect(await columns()).toBe(wide);
  expect(await takeLog(page, 'wallReflowLog')).toEqual([]);
  expect(shell.errors).toEqual([]);
});

test('藏起来播 100 ms、摆回来播 200 ms：窗格整张滑出滑入，内容区跟着位移；中途反悔从此刻的位置起步', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 260 } });
  await takeMotion(page);
  await shell.key.click();
  expect(await takeMotion(page)).toEqual([
    'clipPath+translate 100 inset(0 0px 0 0),0px 0 → inset(0 0px 0 0),-260px 0',
    'translate 100 260px 0 → 0 0',
  ]);
  await settleMotion(page);
  await expect(page.locator('aside')).toHaveCount(0);

  await shell.key.click();
  expect(await takeMotion(page)).toEqual([
    'clipPath+translate 200 inset(0 0px 0 0),-260px 0 → inset(0 0px 0 0),0px 0',
    'translate 200 -260px 0 → 0 0',
  ]);
  await settleMotion(page);

  // 摆回到一半再按一次：从此刻滑到的位置往回滑，不先跳回摆好的样子；内容区跟着同一条线。
  await shell.key.click();
  await settleMotion(page);
  await holdAnimations(page, true);
  await shell.key.click();
  await seekHeld(page, 100);
  await takeMotion(page);
  await shell.key.click();
  const [pane = '', content = ''] = await takeMotion(page);
  const start = Number.parseFloat(pane.split(',')[1] ?? '');
  expect(start).toBeGreaterThan(-260);
  expect(start).toBeLessThan(0);
  expect(pane).toMatch(/^clipPath\+translate 100 /);
  expect(Number.parseFloat(content.split(' ')[2] ?? '')).toBeCloseTo(260 + start, 3);
  expect(shell.errors).toEqual([]);
});

test('收起到一半又展开：窗格从此刻露出的宽度起步，半透明的部分从此刻的透明度接着淡入、不再等', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 260 } });
  await holdAnimations(page, true);
  await shell.splitter.dblclick();
  await seekHeld(page, 50);
  await takeMotion(page);
  await takeFades(page);
  await shell.splitter.dblclick();
  const [pane = ''] = await takeMotion(page);
  const inset = Number.parseFloat(/inset\(0 ([\d.]+)px/.exec(pane)?.[1] ?? '');
  expect(inset).toBeGreaterThan(0);
  expect(inset).toBeLessThan(212);
  const fades = await takeFades(page);
  expect(fades).toHaveLength(3);
  for (const fade of fades) expect(fade).toMatch(/^0\.\d+→1 0 backwards$/);
  expect(shell.errors).toEqual([]);
});

test('拖过收起线吸成图标态：窗格从拖动中停住的 200 起步收起，不先跳回拖动之前的宽度', async ({
  page,
}) => {
  const shell = await openShell(page, { prefs: { rail: false, width: 260 } });
  await dragTo(page, shell, [154]);
  expect(await shell.columnWidth()).toBe(200);
  await takeMotion(page);
  await page.mouse.move(110, 400, { steps: 2 });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  expect(await takeMotion(page)).toEqual([
    'clipPath+translate 200 inset(0 60px 0 0),0px 0 → inset(0 212px 0 0),0px 0',
    'translate 200 152px 0 → 0 0',
  ]);
  await page.mouse.up();
  expect(shell.errors).toEqual([]);
});

test('侧边栏卸掉时焦点在里面，就交给导航行的侧边栏键', async ({ page }) => {
  const shell = await openShell(page, { width: 900, prefs: { hidden: true, width: 260 } });
  await expect(shell.body).toHaveAttribute('data-sidebar', 'rail');
  await shell.nav.getByRole('button', { name: '专辑' }).focus();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(shell.key).toBeFocused();
  expect(shell.errors).toEqual([]);
});

test('减弱动效时换形态直接到位，不播', async ({ page }) => {
  const shell = await openShell(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await takeMotion(page);
  await shell.splitter.dblclick();
  await expect(shell.nav.getByRole('button', { name: '播放列表' })).toBeVisible();
  await shell.key.click();
  await expect(page.locator('aside')).toHaveCount(0);
  expect(await takeMotion(page)).toEqual([]);
  expect(await takeFades(page)).toEqual([]);
  expect(shell.errors).toEqual([]);
});
