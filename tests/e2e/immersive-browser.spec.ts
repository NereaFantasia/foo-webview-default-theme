import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { FakePlaylists } from '../fixtures/fakePlaylists.ts';
import { foldersAnswers } from '../fixtures/foldersLibrary.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { openImmersive } from '../fixtures/immersivePage.ts';
import { DEFAULT_LISTS } from '../fixtures/sidebarPage.ts';

test.use({ screenshot: 'off' });

// 沉浸视图里的浏览面板：入口键与 Ctrl+B 开关，面板里导航时沉浸与全屏不退，Esc 的先后，窄档自动关，
// 离开时主窗落在面板停的那一页，以及面板作为主窗第二个实例时与主窗外壳件的几处相撞

const LIBRARY = libraryAnswers(SAMPLE_ALBUMS);
const FOLDERS = foldersAnswers();
const ANSWERS = { library: { ...LIBRARY.library, ...FOLDERS.library } };

async function openBrowse(page: Page, options: { width?: number } = {}) {
  let lists: FakePlaylists | undefined;
  const immersive = await openImmersive(page, {
    ...options,
    answers: ANSWERS,
    configure: (host) => {
      lists = new FakePlaylists(host, DEFAULT_LISTS, (event, payload) => host.emit(event, payload));
      host.answer('window.isFullscreen', {
        success: true,
        fullscreen: false,
        isFullscreen: false,
        windowId: 'main',
      });
      host.answer('window.enterFullscreen', { success: true, isFullscreen: true });
      host.answer('window.exitFullscreen', { success: true, isFullscreen: false });
    },
  });
  const panel = page.locator('[data-browser-panel]');
  return {
    ...immersive,
    lists: () => {
      if (!lists) throw new Error('播放列表替身没装上');
      return lists;
    },
    panel,
    key: immersive.view.locator('[data-browse-key]'),
    nav: panel.getByRole('navigation', { name: '侧边栏' }),
  };
}

/** 指针还停在刚点的键上，它的悬停提示会先吃掉第一下 Esc；挪开等提示收了再按 */
async function parkPointer(page: Page) {
  await page.mouse.move(640, 500);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}

test('入口键与 Ctrl+B 都能开关面板；Esc 先收面板，再按一次才离开沉浸', async ({ page }) => {
  const { errors, view, panel, key } = await openBrowse(page);
  await expect(panel).toHaveCount(0);
  await expect(key).toHaveAttribute('aria-pressed', 'false');

  await key.click();
  await expect(panel).toBeVisible();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await key.click();
  await expect(panel).toHaveCount(0);

  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();
  await parkPointer(page);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(view).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('光标在面板的搜索框里：Esc 先收下拉、再清空，框里没有可收可清的了才收面板', async ({
  page,
}) => {
  const { errors, view, panel } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  const box = panel.getByRole('combobox', { name: '搜索' });
  await box.click();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(view).toBeVisible();

  await page.keyboard.press('Control+B');
  await box.click();
  await page.keyboard.type('abbey');
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toHaveValue('');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('面板里导航：沉浸与全屏都不退；离开时主窗落在面板停的那一页', async ({ page }) => {
  const { errors, view, panel, nav, calls } = await openBrowse(page);
  await expect(view.locator('[data-fullscreen="off"]')).toBeVisible();
  await page.keyboard.press('F11');
  await expect.poll(() => calls('window.enterFullscreen').length).toBe(1);

  await page.keyboard.press('Control+B');
  await expect(panel.locator('[data-page="albums"]')).toBeVisible();
  // 沉浸期间主窗的页面层已卸载，面板里是唯一一份页面实例：页面服务的单例状态靠这一点不冲突
  await expect(page.locator('[data-page="albums"]')).toHaveCount(1);
  await nav.getByRole('button', { name: '文件夹', exact: true }).click();
  await expect(panel.locator('[data-page="folders"]')).toBeVisible();
  await expect(page.locator('[data-page="folders"]')).toHaveCount(1);
  await expect(view).toBeVisible();
  expect(calls('window.exitFullscreen')).toHaveLength(0);

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page.locator('[data-page="folders"]')).toBeVisible();
  await expect(page.locator('[data-page="albums"]')).toHaveCount(0);
  await expect.poll(() => calls('window.exitFullscreen').length).toBe(1);
  expect(errors).toEqual([]);
});

test('面板没逛走就离开：主窗回到进沉浸前的页', async ({ page }) => {
  const { errors, view, panel } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  await expect(panel.locator('[data-page="albums"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page.locator('[data-page="albums"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('面板的侧边栏不列视频与设置；点搜索框，建议下拉就开在面板里的这个框上', async ({ page }) => {
  const { errors, panel, nav } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  await expect(nav.getByRole('button', { name: '专辑', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: '视频', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '设置', exact: true })).toHaveCount(0);

  const box = panel.getByRole('combobox', { name: '搜索' });
  await box.click();
  await page.keyboard.type('abbey');
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-search-flyout]')).toBeVisible();
  // 点建议不算点了面板外面
  await page.locator('[data-search-flyout]').click();
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});

test('窗口窄到侧边栏收起：面板自动关、入口键不出，宽回来再出', async ({ page }) => {
  const { errors, panel, key } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();

  await page.setViewportSize({ width: 600, height: 800 });
  await expect(panel).toHaveCount(0);
  await expect(key).toHaveCount(0);
  await page.keyboard.press('Control+B');
  await expect(panel).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(key).toBeVisible();
  expect(errors).toEqual([]);
});

test('页面窄了折成抽屉的页（文件夹）在面板里：抽屉展开在面板里，看得见', async ({ page }) => {
  const { errors, panel, nav } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  await nav.getByRole('button', { name: '文件夹', exact: true }).click();
  const folders = panel.locator('[data-page="folders"]');
  await folders.getByRole('button', { name: '目录', exact: true }).click();
  await expect(panel.locator('[data-library-drawer]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('应用根部的模态对话框开着：点里面、点遮罩、按 Esc 面板都留着，对话框关了照常点外面收起', async ({
  page,
}) => {
  const { errors, panel } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();
  // 引导、自动播放列表编辑、更新说明、外链确认都由应用根部渲染，不在面板的组件树里，共同点是带 aria-modal
  await page.evaluate(() => {
    const surface = document.createElement('div');
    surface.id = 'root-dialog';
    surface.setAttribute('role', 'dialog');
    surface.setAttribute('aria-modal', 'true');
    // 压在面板上方（面板在 Portal 里，层级很高），点它时落点在面板的组件树之外
    surface.style.cssText =
      'position:fixed;left:560px;top:380px;width:160px;height:80px;z-index:2147483647';
    document.body.append(surface);
  });
  await page.locator('#root-dialog').click();
  await expect(panel).toBeVisible();
  await page.mouse.click(1260, 780);
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();

  await page.evaluate(() => document.getElementById('root-dialog')?.remove());
  await page.mouse.click(1260, 780);
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('面板收起、离开沉浸后，主窗侧栏播放列表的 F2 改名还在', async ({ page }) => {
  const { errors, view, panel, lists, host } = await openBrowse(page);
  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);

  const nav = page.getByRole('navigation', { name: '侧边栏' });
  const row = nav.locator(`[data-playlist-entry="${lists().guid('Road Trip')}"]`);
  await row.focus();
  await page.keyboard.press('F2');
  await expect(nav.getByRole('textbox', { name: '重命名「Road Trip」' })).toBeFocused();
  expect(host.callsTo('playlist.rename')).toEqual([]);
  expect(errors).toEqual([]);
});

test('点提示上的「关闭」不算点了面板外面，面板留着', async ({ page }) => {
  const { host, errors, panel } = await openBrowse(page);
  host.answer('playback.playOrPause', hostFailure('NO_ACTIVE_ITEM'));
  await page.keyboard.press('Space');
  const toast = page.locator('[data-app-toast="playback"]');
  await expect(toast).toBeVisible();
  // 指针停在提示上它就不会自己收起，免得点之前它先没了
  await toast.hover();
  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();

  await toast.getByRole('button', { name: '关闭' }).click();
  await expect(toast).toHaveCount(0);
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});

test('点边距收起面板：随后那一下单击不落到下面的元素上，只吞这一次；控制层的键照常响应', async ({
  page,
}) => {
  const { errors, view, panel } = await openBrowse(page);
  // 边距里的一个按钮，代替沉浸场景里露出来的、单击会起作用的元素（比如歌词行）
  await page.evaluate(() => {
    const probe = document.createElement('button');
    probe.id = 'probe';
    probe.style.cssText =
      'position:fixed;left:8px;top:300px;width:40px;height:40px;z-index:2147483647';
    probe.addEventListener('click', () => {
      Reflect.set(window, '__probeClicks', Number(Reflect.get(window, '__probeClicks') ?? 0) + 1);
    });
    document.body.append(probe);
  });
  const clicks = () => page.evaluate(() => Number(Reflect.get(window, '__probeClicks') ?? 0));

  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();
  await page.locator('#probe').click();
  await expect(panel).toHaveCount(0);
  expect(await clicks()).toBe(0);
  await page.locator('#probe').click();
  expect(await clicks()).toBe(1);

  // 控制层的键点一下既收面板又起作用：右上的 Esc 胶囊离开沉浸
  await page.keyboard.press('Control+B');
  await expect(panel).toBeVisible();
  await view.getByRole('button', { name: '退出沉浸' }).click();
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('图标态（窗宽 900）里面板的侧栏同样不列视频与设置', async ({ page }) => {
  const { errors, nav } = await openBrowse(page, { width: 900 });
  await page.keyboard.press('Control+B');
  await expect(nav.getByRole('button', { name: '专辑', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: '视频', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '设置', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('图标态里搜完再回退：恢复出的搜索下拉仍开在面板里，不落到窗口左上角主窗的位置', async ({
  page,
}) => {
  const { errors, panel } = await openBrowse(page, { width: 900 });
  await page.keyboard.press('Control+B');
  await expect(panel.locator('[data-page="albums"]')).toBeVisible();
  await panel.locator('[data-search-trigger]').click();
  await page.keyboard.type('abbey');
  await page.keyboard.press('Enter');
  await expect(panel.locator('[data-page="search"]')).toBeVisible();

  await panel.getByRole('button', { name: /^后退/ }).click();
  const flyout = page.locator('[data-search-flyout]');
  await expect(flyout).toBeVisible();
  // 锚点落在哪就是被测的行为：下拉要贴着面板里的放大镜，没有锚点时它会退到窗口左上角
  const [box, area] = await Promise.all([flyout.boundingBox(), panel.boundingBox()]);
  expect(box && area && box.x >= area.x && box.y >= area.y).toBe(true);
  expect(errors).toEqual([]);
});
