import { expect, test } from '@playwright/test';
import metadata from '../../package.json' with { type: 'json' };
import { REQUIRED_HOST_VERSION } from '../../src/host/hostInfo.ts';
import type { MessageKey } from '../../src/i18n/en.ts';
import { DESKTOP_LYRICS_HOTKEYS } from '../../src/lyrics/desktop/desktopLyricsPrefs.ts';
import type { KeyChord } from '../../src/nav/commandRegistry.ts';
import { CREDIT_SECTIONS } from '../../src/settings/credits.ts';
import { SHORTCUT_SECTIONS } from '../../src/settings/shortcutList.ts';
import { HOST_VERSION, hostFailure } from '../fixtures/hostAnswers.ts';
import { openSettings } from '../fixtures/settingsPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';

// 「快捷键」与「关于」两组：一览的内容与开合，版本与复制，已关闭的提醒，许可与致谢的外链。
// 一览里的后退、前进取的就是登记处用的常量（单测对照过），在 nav-commands.spec.ts 里真按过；侧边栏播放列表
// 的三条是手写的，在本文件末尾按一览写的键各按一次，那边改了按键这里就会变红。

/** 一览的行数：清单里的各条，加上桌面歌词可以录键的几项系统热键。 */
const SHORTCUT_ROWS =
  SHORTCUT_SECTIONS.flatMap((section) => section.entries).length + DESKTOP_LYRICS_HOTKEYS.length;

/** 一览里某一条的第一种键盘按法，写成 Playwright 认的按键串。 */
function pressOf(label: MessageKey): string {
  const entry = SHORTCUT_SECTIONS.flatMap((section) => section.entries).find(
    (item) => item.label === label,
  );
  const chord = entry?.inputs
    .map((input): KeyChord | undefined => ('chord' in input ? input.chord : undefined))
    .find((found) => found !== undefined);
  if (!chord) throw new Error(`一览里没有「${label}」的键盘按法`);
  return [
    chord.ctrl ? 'Control' : undefined,
    chord.alt ? 'Alt' : undefined,
    chord.shift ? 'Shift' : undefined,
    chord.meta ? 'Meta' : undefined,
    chord.key,
  ]
    .filter((part): part is string => part !== undefined)
    .join('+');
}

test('快捷键一览：按所在的地方分小节，键帽写出按法；卡能收起再展开', async ({ page }) => {
  const settings = await openSettings(page);
  const head = page.getByRole('button', { name: '键盘与鼠标' });
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  const rows = page.locator('[data-settings-shortcut]');
  await expect(rows).toHaveCount(SHORTCUT_ROWS);
  await expect(rows.filter({ hasText: '后退' }).locator('kbd')).toHaveText([
    'Alt',
    '←',
    '鼠标后退键',
  ]);
  await expect(rows.filter({ hasText: '后退' })).toContainText('或');
  await expect(rows.filter({ hasText: '前进' }).locator('kbd')).toHaveText([
    'Alt',
    '→',
    '鼠标前进键',
  ]);
  await expect(rows.filter({ hasText: '重命名' }).locator('kbd')).toHaveText(['F2']);
  for (const name of ['侧边栏的播放列表', '播放队列']) {
    const sectionRows = page
      .getByRole('region', { name, exact: true })
      .locator('[data-settings-shortcut]');
    await expect(sectionRows.filter({ hasText: '上移' }).locator('kbd')).toHaveText(['Alt', '↑']);
    await expect(sectionRows.filter({ hasText: '下移' }).locator('kbd')).toHaveText(['Alt', '↓']);
  }
  await expect(page.getByRole('region', { name: '键盘与鼠标' })).toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await head.focus();
  await page.keyboard.press('Enter');
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(rows).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(rows).toHaveCount(SHORTCUT_ROWS);
  expect(settings.errors).toEqual([]);
});

test('显示各项版本；复制把主题版本与诊断信息放进剪贴板，没复制成时写出错误', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({ platformVersion: '13.0.0' }),
      },
    });
  });
  const settings = await openSettings(page);
  for (const value of [
    `默认主题 ${metadata.version}`,
    `foo_ui_webview2 ${HOST_VERSION}`,
    'foobar2000 v2.25（64 位）',
  ]) {
    await expect(settings.card('版本').getByText(value, { exact: true })).toBeVisible();
  }
  const copy = page.getByRole('button', { name: '复制 版本' });
  await copy.click();
  await expect(page.getByRole('button', { name: '已复制 版本' })).toBeVisible();
  expect(settings.host.callsTo('clipboard.write')).toEqual([
    {
      text: [
        `foo-webview-default-theme ${metadata.version}`,
        'foobar2000 v2.25 (64-bit, portable)',
        `foo_ui_webview2 ${HOST_VERSION} (requires ${REQUIRED_HOST_VERSION} or later)`,
        'Window platform: windows11',
        'Backdrop: requested=inherit, reported=unknown, effective=unknown',
        'Backdrop application: applied',
      ].join('\n'),
    },
  ]);

  settings.host.answer('clipboard.write', hostFailure('OPERATION_FAILED'));
  await page.getByRole('button', { name: /版本$/ }).click();
  await expect(settings.card('版本').getByRole('status')).toHaveText('复制失败');
  expect(settings.errors).toEqual([]);
});

test('宿主在、版本读不到：说明行是一道横线，不写没有宿主的原因，复制禁用', async ({ page }) => {
  const settings = await openSettings(page, {
    answers: { config: { getVersionInfo: hostFailure('OPERATION_FAILED') } },
  });
  await expect.poll(() => settings.host.callsTo('config.getVersionInfo').length).toBeGreaterThan(0);
  await expect(settings.card('版本')).toContainText('—');
  await expect(settings.card('版本')).not.toContainText('只在 foobar2000 中可用');
  await expect(page.getByRole('button', { name: '复制 版本' })).toBeDisabled();
  expect(settings.errors).toEqual([]);
});

test('主题更新：卡头保留状态和检查按钮，方式与内容默认收起；不运行更新器时禁用', async ({
  page,
}) => {
  // 装着播放统计组件：缺组件的提醒与更新无关，不让它占住信息中心。
  const settings = await openSettings(page, {
    config: { 'defaultTheme.update.auto': true },
    answers: {
      config: {
        getComponents: {
          success: true,
          count: 1,
          components: [{ filename: 'foo_playcount', name: '播放统计信息', version: '3.1.5' }],
        },
      },
    },
  });
  const titles = page
    .locator('[data-settings-card] [id], [data-settings-expander] > :first-child [id]')
    .filter({ hasText: /^(版本|主题更新|已关闭的提醒)$/ });
  await expect(titles).toHaveText(['版本', '主题更新', '已关闭的提醒']);
  await expect(settings.row('更新方式')).toHaveCount(0);
  await settings.expand('主题更新');
  // 只有旧键时按它回退：true 视为自动下载并安装。
  const select = page.getByRole('combobox', { name: '更新方式' });
  await expect(select).toHaveText('自动下载并安装');
  await expect(select).toBeDisabled();
  // 页面地址不在 /fe/<目录>/ 下，也不是宿主的虚拟域名，按「不是从模板目录加载」说明
  await expect(settings.card('主题更新')).toContainText('主题不是从模板目录加载的，不支持更新');
  const check = page.getByRole('button', { name: '检查更新 主题更新' });
  await expect(check).toHaveAttribute('aria-disabled', 'true');
  await check.click({ force: true });
  expect(settings.host.callsTo('http.get')).toEqual([]);
  await expect(page.locator('[data-info-center-trigger]')).toHaveCount(0);
  expect(settings.errors).toEqual([]);
});

test('更新方式：新键有值时以新键为准，不看旧键', async ({ page }) => {
  const settings = await openSettings(page, {
    config: { 'defaultTheme.update.mode': 'notify', 'defaultTheme.update.auto': true },
  });
  await settings.expand('主题更新');
  await expect(page.getByRole('combobox', { name: '更新方式' })).toHaveText('仅提醒');
  expect(settings.errors).toEqual([]);
});

test('已关闭的提醒：写出还算数的条数；恢复清掉 config 里的记录，按钮禁用、焦点留在它上面', async ({
  page,
}) => {
  const key = 'defaultTheme.infoCenter.dismissed';
  // 记在旧插件版本下的提醒会重新显示，不计入当前版本的已关闭条数。
  const settings = await openSettings(page, {
    config: { [key]: { playcountMissing: HOST_VERSION, libraryNotConfigured: '1.9.0' } },
  });
  const card = settings.card('已关闭的提醒');
  const restore = page.getByRole('button', { name: '恢复 已关闭的提醒' });
  await expect(card).toContainText('已关闭 1 条');
  await expect(restore).toBeEnabled();

  await restore.focus();
  await page.keyboard.press('Enter');
  await expect(card).toContainText('没有已关闭的提醒');
  await expect(restore).toBeDisabled();
  await expect(restore).toBeFocused();
  // 下次启动读回的就是它；读回之前条数本来也是 0，刷新后再看说明行证明不了记录清掉了。
  await expect.poll(() => settings.host.config.get(key)).toEqual({});
  expect(settings.errors).toEqual([]);
});

test('开源许可与致谢的各行用系统浏览器打开对应的网址', async ({ page }) => {
  const settings = await openSettings(page);
  const opened = () => settings.host.callsTo('shell.openExternal').map((params) => params['url']);
  await expect(settings.card('开源许可')).toContainText('AGPL-3.0-only');
  await page.getByRole('button', { name: '查看全文 开源许可' }).click();
  await expect.poll(opened).toEqual(['https://www.gnu.org/licenses/agpl-3.0.html']);

  const credits = page.locator('[data-settings-credit]');
  await expect(credits).toHaveCount(CREDIT_SECTIONS.flatMap((section) => section.credits).length);
  await expect(credits.first()).toContainText('foobar2000');
  await expect(credits.first()).toContainText('Peter Pawłowski');
  await expect(page.locator('[data-settings-credit="react"]')).toContainText('MIT');
  await expect(page.locator('[data-settings-credit="foobox"]')).toContainText('GPL-3.0');

  await page.locator('[data-settings-credit="foobar2000"]').click();
  await page.locator('[data-settings-credit="jotai"]').click();
  await expect
    .poll(opened)
    .toEqual([
      'https://www.gnu.org/licenses/agpl-3.0.html',
      'https://www.foobar2000.org/',
      'https://jotai.org/',
    ]);
  expect(settings.errors).toEqual([]);
});

test('查看全文与致谢的一行没打开时，各自的卡上写出错误，下一次打开了就收走', async ({ page }) => {
  const settings = await openSettings(page, {
    answers: { shell: { openExternal: hostFailure('OPERATION_FAILED') } },
  });
  const license = settings.card('开源许可').getByRole('status');
  const credits = page.locator('[data-settings-expander]').filter({ hasText: '致谢' });
  await page.getByRole('button', { name: '查看全文 开源许可' }).click();
  await expect(license).toHaveText('打开失败');
  await page.locator('[data-settings-credit="react"]').click();
  await expect(credits.getByRole('status')).toHaveText('打开失败');

  settings.host.answer('shell.openExternal', { success: true });
  await page.locator('[data-settings-credit="react"]').click();
  await expect(credits.getByRole('status')).toHaveText('');
  await expect(credits).toContainText('开源项目与贡献者');
  await page.getByRole('button', { name: '查看全文 开源许可' }).click();
  await expect(license).toHaveText('');
  expect(settings.errors).toEqual([]);
});

test('一览里侧边栏播放列表的三条，按一览写的键真按：上移、下移、改名', async ({ page }) => {
  const sidebar = await openSidebar(page);
  const names = () => sidebar.lists.items.map((item) => item.name);
  await sidebar.entry('Road Trip').focus();

  await page.keyboard.press(pressOf('settings.shortcutMoveUp'));
  await expect.poll(names).toEqual(['Default', 'Road Trip', 'Chill', 'Smart']);
  await expect(sidebar.entry('Road Trip')).toBeFocused();

  await page.keyboard.press(pressOf('settings.shortcutMoveDown'));
  await expect.poll(names).toEqual(['Default', 'Chill', 'Road Trip', 'Smart']);
  await expect(sidebar.entry('Road Trip')).toBeFocused();

  await page.keyboard.press(pressOf('settings.shortcutRename'));
  await expect(sidebar.nav.getByRole('textbox', { name: '重命名「Road Trip」' })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(sidebar.errors).toEqual([]);
});
