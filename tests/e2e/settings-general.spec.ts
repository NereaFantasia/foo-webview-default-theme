import { expect, test, type Page } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { enterSettings, openSettings, openSettingsWithoutHost } from '../fixtures/settingsPage.ts';
import { clickSideButton } from '../fixtures/sidebarPage.ts';

// 「常规」一组：界面语言、启动时打开、托盘的两只开关、去 foobar2000 设置的两个入口，以及没有宿主时的禁用。

const LOCALE_KEY = 'defaultTheme.locale';
const NEEDS_HOST = '只在 foobar2000 中可用';

test.use({ screenshot: 'off' });

async function localeGeneration(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { createBrowserDataStorage }: typeof import('../../src/kit/browserDataStorage.ts') =
      await import(`${location.origin}/src/kit/browserDataStorage.ts`);
    const storage = createBrowserDataStorage({ database: indexedDB, legacy: null });
    try {
      return Number(await storage.getItem('default-theme.data-gen.v1.config:defaultTheme.locale'));
    } finally {
      storage.dispose();
    }
  });
}

test('选一门语言，界面换掉并记进 config；选回跟随，存档删掉', async ({ page }) => {
  const settings = await openSettings(page);
  await expect(settings.card('界面语言')).toContainText('当前：中文（中国）');
  await expect(settings.select('界面语言')).toHaveText('跟随 foobar2000');

  await settings.choose('界面语言', 'English');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const saved = () =>
    settings.host.callsTo('config.set').filter((params) => params['key'] === LOCALE_KEY);
  await expect.poll(saved).toEqual([{ key: LOCALE_KEY, value: 'en' }]);
  await expect.poll(() => localeGeneration(page)).toBeGreaterThan(0);
  const firstGeneration = await localeGeneration(page);

  await page.getByRole('combobox', { name: 'Interface language', exact: true }).click();
  await page.getByRole('option', { name: 'Follow foobar2000', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  await expect.poll(() => settings.host.callsTo('config.remove')).toEqual([{ key: LOCALE_KEY }]);
  await expect.poll(() => localeGeneration(page)).toBeGreaterThan(firstGeneration);
  expect(saved()).toHaveLength(1);
  expect(settings.errors).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`语言保存失败保持本次选择并说明未保存，再次保存成功后收走错误：${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const settings = await openSettings(page);
    settings.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    await settings.choose('界面语言', '中文（中国）');
    await expect(settings.select('界面语言')).toHaveText('中文（中国）');
    await expect(settings.card('界面语言').getByRole('status')).toHaveText(
      '语言已切换，但未能保存选择',
    );
    expect(await localeGeneration(page)).toBe(0);
    settings.host.answer('config.set', () => {
      settings.host.config.set(LOCALE_KEY, 'zh-CN');
      return { success: true, key: LOCALE_KEY };
    });
    await settings.choose('界面语言', '跟随 foobar2000');
    await expect(settings.card('界面语言').getByRole('status')).toHaveText('');
    await settings.choose('界面语言', '中文（中国）');
    await expect(settings.card('界面语言').getByRole('status')).toHaveText('');
    await expect.poll(() => localeGeneration(page)).toBeGreaterThan(0);
    expect(settings.host.config.get(LOCALE_KEY)).toBe('zh-CN');
    expect(settings.errors).toEqual([]);
  });
}

test('清除语言存档失败时仍跟随宿主，但显示未保存且不推进代数', async ({ page }) => {
  const settings = await openSettings(page, { config: { [LOCALE_KEY]: 'zh-CN' } });
  settings.host.answer('config.remove', hostFailure('OPERATION_FAILED'));
  await settings.choose('界面语言', '跟随 foobar2000');
  await expect(settings.select('界面语言')).toHaveText('跟随 foobar2000');
  await expect(settings.card('界面语言').getByRole('status')).toHaveText(
    '语言已切换，但未能保存选择',
  );
  expect(settings.host.config.get(LOCALE_KEY)).toBe('zh-CN');
  expect(await localeGeneration(page)).toBe(0);
  expect(settings.errors).toEqual([]);
});

test('缺少共享写锁时语言只在本次生效，不直接写入宿主', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  const settings = await openSettings(page);
  await settings.choose('界面语言', '中文（中国）');
  await expect(settings.card('界面语言').getByRole('status')).toHaveText(
    '语言已切换，但未能保存选择',
  );
  expect(
    settings.host.callsTo('config.set').filter((params) => params['key'] === LOCALE_KEY),
  ).toEqual([]);
  expect(settings.errors).toEqual([]);
});

test('外部语言文件读不到：选中回到原来那一项，说明行写出原因', async ({ page }) => {
  const settings = await openSettings(page, {
    answers: {
      file: { list: { success: true, files: ['ja.json'], directories: [], items: ['ja.json'] } },
    },
  });
  await settings.choose('界面语言', '日本語');
  await expect(settings.card('界面语言').getByRole('status')).toHaveText('语言文件读取失败');
  await expect(settings.select('界面语言')).toHaveText('跟随 foobar2000');
  expect(settings.host.callsTo('config.set').filter((call) => call['key'] === LOCALE_KEY)).toEqual(
    [],
  );

  // 再选一门读得到的，错误文案收走。
  await settings.choose('界面语言', '中文（中国）');
  await expect(settings.card('界面语言').getByRole('status')).toHaveText('');
  await expect(settings.card('界面语言')).toContainText('当前：中文（中国）');
  await expect(settings.select('界面语言')).toHaveText('中文（中国）');
  expect(settings.errors).toEqual([]);
});

test('正在用的外部语言文件被移走：再进设置页，下拉框仍选着它，不是空白', async ({ page }) => {
  const listed = (files: string[]) => ({
    success: true as const,
    files,
    directories: [],
    items: files,
  });
  const content = JSON.stringify({ 'settings.copy': 'コピー' });
  const settings = await openSettings(page, {
    answers: {
      file: {
        list: listed(['ja.json']),
        read: { success: true, content, size: content.length },
      },
    },
  });
  await settings.choose('界面语言', '日本語');
  await expect(page.getByRole('button', { name: 'コピー 版本' })).toBeVisible();

  settings.host.answer('file.list', listed([]));
  await clickSideButton(page, 'back');
  await enterSettings(page);
  await expect.poll(() => settings.host.callsTo('file.list').length).toBeGreaterThan(2);
  await expect(settings.select('界面语言')).toHaveText('日本語');
  await expect(settings.card('界面语言')).toContainText('当前：日本語');
  expect(settings.errors).toEqual([]);
});

test('托盘开关：拨了就下发并记进 config；宿主没接受时写出错误，再拨成了就收走', async ({
  page,
}) => {
  const settings = await openSettings(page);
  await settings.expand('托盘');
  const minimize = page.getByRole('switch', { name: '最小化到托盘' });
  await expect(minimize).not.toBeChecked();
  await minimize.click();
  await expect(minimize).toBeChecked();
  await expect
    .poll(() => settings.host.callsTo('tray.setMinimizeToTray').at(-1))
    .toEqual({ enabled: true });
  await expect.poll(() => settings.host.config.get('defaultTheme.tray.minimizeToTray')).toBe(true);

  settings.host.answer('tray.setCloseToTray', hostFailure('OPERATION_FAILED'));
  const close = page.getByRole('switch', { name: '关闭到托盘' });
  await close.click();
  await expect(settings.row('关闭到托盘').getByRole('status')).toHaveText('托盘设置未生效');
  // 卡头写同一条错误，收起时也看得见。
  await expect(settings.expander('托盘').locator(':scope > :first-child')).toContainText(
    '托盘设置未生效',
  );
  settings.host.answer('tray.setCloseToTray', { success: true });
  await close.click();
  await expect(settings.row('关闭到托盘').getByRole('status')).toHaveText('');
  await expect(settings.expander('托盘')).not.toContainText('托盘设置未生效');
  expect(settings.errors).toEqual([]);
});

test('托盘开关已生效但没存下时写出未保存，再拨存住后收走', async ({ page }) => {
  const settings = await openSettings(page);
  const key = 'defaultTheme.tray.closeToTray';
  settings.host.answer('config.set', hostFailure('OPERATION_FAILED'));
  await settings.expand('托盘');
  const close = page.getByRole('switch', { name: '关闭到托盘' });
  await close.click();
  await expect(close).toBeChecked();
  await expect(settings.row('关闭到托盘').getByRole('status')).toHaveText(
    '已生效，但未能保存这项设置',
  );
  expect(settings.host.callsTo('tray.setCloseToTray').at(-1)).toEqual({ enabled: true });

  settings.host.answer('config.set', (params) => {
    const value = params['value'];
    if (typeof value !== 'boolean') throw new Error('托盘开关的值应为布尔');
    settings.host.config.set(key, value);
    return { success: true, key };
  });
  await close.click();
  await expect(close).not.toBeChecked();
  await expect(settings.row('关闭到托盘').getByRole('status')).toHaveText('');
  expect(settings.host.config.get(key)).toBe(false);
  expect(settings.errors).toEqual([]);
});

test('启动时打开：选了歌曲，重新打开窗口落在歌曲页，侧边栏亮「歌曲」', async ({ page }) => {
  const settings = await openSettings(page);
  await expect(settings.select('启动时打开')).toHaveText('专辑');
  await settings.choose('启动时打开', '歌曲');
  await expect(page.locator('[data-page="settings"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-page="songs"]')).toBeVisible({ timeout: 15_000 });
  await expect(
    page
      .getByRole('navigation', { name: '侧边栏' })
      .getByRole('button', { name: '歌曲', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  expect(settings.errors).toEqual([]);
});

test('两个打开键各调到宿主的方法；没做成时写出错误', async ({ page }) => {
  const settings = await openSettings(page);
  await page.getByRole('button', { name: '打开 媒体库文件夹' }).click();
  await expect.poll(() => settings.host.callsTo('config.showLibraryPreferences')).toHaveLength(1);
  await page.getByRole('button', { name: '打开 foobar2000 首选项' }).click();
  await expect.poll(() => settings.host.callsTo('misc.showPreferences')).toHaveLength(1);

  settings.host.answer('misc.showPreferences', hostFailure('OPERATION_FAILED'));
  await page.getByRole('button', { name: '打开 foobar2000 首选项' }).click();
  await expect(settings.card('foobar2000 首选项').getByRole('status')).toHaveText('打开失败');
  expect(settings.errors).toEqual([]);
});

test('没有宿主：靠宿主生效的几项禁用并写明原因，语言与深浅照常可用', async ({ page }) => {
  const settings = await openSettingsWithoutHost(page);
  await settings.expand('托盘');
  // 等宿主超时要几秒。
  await expect(page.getByRole('switch', { name: '最小化到托盘' })).toBeDisabled({
    timeout: 10_000,
  });
  await expect(page.getByRole('switch', { name: '关闭到托盘' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '打开 媒体库文件夹' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '打开 foobar2000 首选项' })).toBeDisabled();
  await expect(settings.select('窗口背景')).toBeEnabled();
  for (const title of ['最小化到托盘', '关闭到托盘']) {
    await expect(settings.row(title)).toContainText(NEEDS_HOST);
  }
  for (const title of ['媒体库文件夹', 'foobar2000 首选项']) {
    await expect(settings.card(title)).toContainText(NEEDS_HOST);
  }
  await expect(settings.card('窗口背景')).toContainText(NEEDS_HOST);
  await settings.select('窗口背景').click();
  await expect(page.getByRole('option', { name: 'Mica', exact: true })).toBeDisabled();
  await expect(page.getByRole('option', { name: '流动色场', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');

  await expect(settings.select('界面语言')).toBeEnabled();
  await expect(settings.select('颜色模式')).toBeEnabled();
  await expect(settings.card('版本')).toContainText(NEEDS_HOST);
  await expect(page.getByRole('button', { name: '复制 版本' })).toBeDisabled();
  await expect(page.locator('[data-settings-credit]').first()).toBeDisabled();
  await expect(page.locator('[data-settings-expander]').filter({ hasText: '致谢' })).toContainText(
    NEEDS_HOST,
  );
  expect(settings.errors).toEqual([]);
});
