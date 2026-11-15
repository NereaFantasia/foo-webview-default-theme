import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  enterSettings,
  openSettings,
  waitFrames,
  type SettingsPage,
} from '../fixtures/settingsPage.ts';
import { clickSideButton } from '../fixtures/sidebarPage.ts';

// 设置页的版式与进出：三档宽度下的分区目录（窄页为页顶的分区名）与下拉框位置（右侧或换行）、点目录切换分区、
// 记住所在分区。离开后再进入，所在分区、滚动位置与展开卡的开合保持不变。观感（间距、配色、动效）只能实机判断

/** 分区的大标题：宽页显示，窄页由页顶的分区名取代，仅保留给读屏 */
const sectionTitle = (page: Page, name: string) =>
  page.getByRole('heading', { level: 2, name, exact: true });

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('元素没有画出来');
  return rect;
}

/** 卡里的下拉框相对标题摆在哪：同一行的右边，还是换到了下面。量的是下拉框的外框 */
async function fieldPlacement(settings: SettingsPage, title: string) {
  const label = await box(settings.card(title).getByText(title, { exact: true }));
  const field = await box(settings.select(title).locator('xpath=..'));
  const card = await box(settings.card(title));
  return {
    beside: field.y < label.y + label.height && field.x > label.x + label.width,
    below: field.y >= label.y + label.height,
    fieldWidth: field.width,
    cardWidth: card.width,
    indent: field.x - label.x,
    // 卡的右内边距 16、边框 1
    rightGap: card.x + card.width - (field.x + field.width),
  };
}

const scrollTop = (scroller: Locator) => scroller.evaluate((element) => element.scrollTop);

/** 把窗口调到设置页正好 `target` 宽。侧边栏的形态随窗口宽变，按量到的差调几次 */
async function fitPageWidth(page: Page, target: number): Promise<void> {
  const root = page.locator('[data-page="settings"]');
  let width = page.viewportSize()?.width ?? 1280;
  for (let tries = 0; tries < 5; tries += 1) {
    await waitFrames(page);
    const actual = await root.evaluate((element) => element.clientWidth);
    if (actual === target) return;
    width += target - actual;
    await page.setViewportSize({ width, height: 800 });
  }
  throw new Error(`调不出 ${target} 宽的设置页`);
}

/** 目录里亮着的那一项 */
const currentItem = (settings: SettingsPage) =>
  settings.nav.locator('[aria-current="page"], [aria-current="true"]');

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`${colorScheme === 'dark' ? '深色' : '浅色'}档`, () => {
    test.use({ colorScheme });

    test('1280：目录在左，下拉框在标题右边；页面够宽时卡列止于 760', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const settings = await openSettings(page);
      await expect(settings.nav).toHaveAttribute('data-settings-nav', 'directory');
      const groups = [
        '常规',
        '外观',
        '播放',
        '沉浸视图',
        '歌词',
        '在线音乐',
        '在线内容',
        '快捷键',
        '关于',
      ];
      await expect(settings.nav.getByRole('button')).toHaveText(groups);
      for (const name of groups) {
        await expect(settings.nav.getByRole('button', { name, exact: true })).toBeVisible();
      }
      const language = await fieldPlacement(settings, '界面语言');
      expect(language.beside).toBe(true);
      expect(language.fieldWidth).toBe(220);
      // 1280 时卡列随侧边栏与主视图留白后的可用宽度走，未必到 760；把设置页调宽再量上限
      await fitPageWidth(page, 1200);
      expect((await fieldPlacement(settings, '界面语言')).cardWidth).toBe(760);
      expect(settings.errors).toEqual([]);
    });

    test('900：侧边栏是图标态，目录仍在左，下拉框仍在右', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const settings = await openSettings(page);
      await page.setViewportSize({ width: 900, height: 800 });
      await expect(settings.nav).toHaveAttribute('data-settings-nav', 'directory');
      const language = await fieldPlacement(settings, '界面语言');
      expect(language.beside).toBe(true);
      expect(language.cardWidth).toBeLessThan(760);
      expect(settings.errors).toEqual([]);
    });

    test('窗口宽 390：目录收成页顶的分区名，下拉框换到标题下方、与文字左对齐、占满一行', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const settings = await openSettings(page);
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(settings.nav).toHaveAttribute('data-settings-nav', 'menu');
      await expect(settings.nav.getByRole('button')).toHaveText('常规');
      const language = await fieldPlacement(settings, '界面语言');
      expect(language.below).toBe(true);
      expect(Math.abs(language.indent)).toBeLessThan(1);
      expect(language.rightGap).toBe(17);
      // 开关不换行，仍在标题右边
      await settings.expand('托盘');
      const title = await box(settings.row('最小化到托盘').getByText('最小化到托盘'));
      const toggle = await box(page.getByRole('switch', { name: '最小化到托盘' }));
      expect(toggle.x).toBeGreaterThan(title.x + title.width);
      expect(settings.errors).toEqual([]);
    });
  });
}

test('点目录切换分区：右侧只显示该分区，该项标为当前项，焦点留在目录项上；刷新后停在该分区 @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page);
  await expect(currentItem(settings)).toHaveText('常规');
  await expect(sectionTitle(page, '常规')).toBeVisible();

  const about = settings.nav.getByRole('button', { name: '关于', exact: true });
  await about.click();
  await expect(sectionTitle(page, '关于')).toBeVisible();
  await expect(sectionTitle(page, '常规')).toHaveCount(0);
  await expect(currentItem(settings)).toHaveText('关于');
  await expect(about).toBeFocused();
  expect(await scrollTop(settings.scroller)).toBe(0);

  // 分区保存在本机的浏览器偏好中：重新载入页面后仍停在该分区
  await page.reload();
  await enterSettings(page);
  await expect(currentItem(settings)).toHaveText('关于');
  await expect(sectionTitle(page, '关于')).toBeVisible();
  expect(settings.errors).toEqual([]);
});

test('窄页：页顶显示分区名，点开后选择分区；选中项带勾，大标题仅保留给读屏', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = await openSettings(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(settings.nav).toHaveAttribute('data-settings-nav', 'menu');
  const trigger = settings.nav.getByRole('button');
  await expect(trigger).toHaveText('常规');

  await trigger.click();
  await expect(page.getByRole('menuitemradio', { name: '常规', exact: true })).toBeChecked();
  await page.getByRole('menuitemradio', { name: '外观', exact: true }).click();
  await expect(trigger).toHaveText('外观');
  await expect(sectionTitle(page, '外观')).toBeAttached();
  await expect(page.getByRole('combobox', { name: '界面语言' })).toHaveCount(0);
  expect(settings.errors).toEqual([]);
});

test('焦点在目录里时页宽跨过分界：换了排法，焦点落在新一排亮着的那一项上', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = await openSettings(page);
  await settings.nav.getByRole('button', { name: '外观', exact: true }).focus();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(settings.nav).toHaveAttribute('data-settings-nav', 'menu');
  await expect(settings.nav.getByRole('button', { name: '常规' })).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(settings.nav).toHaveAttribute('data-settings-nav', 'directory');
  await expect(settings.nav.getByRole('button', { name: '常规', exact: true })).toBeFocused();
  expect(settings.errors).toEqual([]);
});

test('页宽不到 640、卡列够宽：设置页挂上的第一帧下拉框就在标题右边，不先换行再跳回来', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page);
  // 页宽 600 时目录收成页顶的分区名，卡列宽 576，下拉框能放在标题右侧；若仍按目录布局计算，卡列只有 360，会误判为窄档
  await fitPageWidth(page, 600);
  await expect(settings.nav).toHaveAttribute('data-settings-nav', 'menu');
  expect((await fieldPlacement(settings, '界面语言')).beside).toBe(true);

  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  // 回来时设置页重新挂上。每一帧绘制前记下语言下拉框离卡片上沿多远：在右边约 13，换行了在 30 以上
  await page.evaluate(() => {
    const offsets: number[] = [];
    Reflect.set(window, 'fieldOffsets', offsets);
    const tick = () => {
      const field = document.querySelector('[data-page="settings"] [role="combobox"]');
      const card = field?.closest('[data-settings-card]');
      if (field && card) {
        offsets.push(field.getBoundingClientRect().top - card.getBoundingClientRect().top);
      }
      if (offsets.length < 10) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await clickSideButton(page, 'forward');
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  const offsets = await page.waitForFunction(() => {
    const value: unknown = Reflect.get(window, 'fieldOffsets');
    return Array.isArray(value) && value.length >= 10 ? value : null;
  });
  const recorded: unknown = await offsets.jsonValue();
  const values = Array.isArray(recorded) ? recorded.map(Number) : [];
  expect(values).toHaveLength(10);
  expect(values.filter((offset) => offset >= 30)).toEqual([]);
  expect(settings.errors).toEqual([]);
});

test('离开设置页再返回：停在原分区，滚动位置保持不变', async ({ page }) => {
  // 窗口高度取小，保证快捷键一览可滚动
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page, {}, '快捷键');
  await settings.scroller.evaluate((element) => {
    element.scrollTop = 150;
  });
  const left = await scrollTop(settings.scroller);
  expect(left).toBeGreaterThan(0);

  // 后退回专辑页，再前进回设置页
  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await clickSideButton(page, 'forward');
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  await expect(currentItem(settings)).toHaveText('快捷键');
  await expect.poll(() => scrollTop(settings.scroller)).toBe(left);
  expect(settings.errors).toEqual([]);
});

test('展开卡的开合：同一次访问中切换分区后切回，状态保持；后退、前进时还原；重新进入设置页回到缺省', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page, {}, '外观');
  const toggleOf = (title: string) => settings.expander(title).locator('[data-settings-toggle]');
  // 窗口背景缺省收起、键盘与鼠标缺省展开：各翻一下，回来要还是翻过的样子
  await expect(toggleOf('窗口背景')).toHaveAttribute('aria-expanded', 'false');
  await settings.expand('窗口背景');
  await settings.show('快捷键');
  await expect(toggleOf('键盘与鼠标')).toHaveAttribute('aria-expanded', 'true');
  await toggleOf('键盘与鼠标').click();
  await expect(toggleOf('键盘与鼠标')).toHaveAttribute('aria-expanded', 'false');

  // 切换分区会卸载原分区的卡，切回后按卸载前的开合状态还原
  await settings.show('外观');
  await expect(toggleOf('窗口背景')).toHaveAttribute('aria-expanded', 'true');
  await settings.show('快捷键');
  await expect(toggleOf('键盘与鼠标')).toHaveAttribute('aria-expanded', 'false');

  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  // 等设置页真卸掉：退得太快、旧页还没卸就被接回来时，状态是原样留着的，测不到还原
  await expect(page.locator('[data-page="settings"]')).toHaveCount(0);
  await clickSideButton(page, 'forward');
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  await expect(currentItem(settings)).toHaveText('快捷键');
  await expect(toggleOf('键盘与鼠标')).toHaveAttribute('aria-expanded', 'false');
  await settings.show('外观');
  await expect(toggleOf('窗口背景')).toHaveAttribute('aria-expanded', 'true');

  // 不是后退前进，而是重新点进设置页：开合不跨记录记，回到缺省
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await enterSettings(page);
  await expect(toggleOf('窗口背景')).toHaveAttribute('aria-expanded', 'false');
  await settings.show('快捷键');
  await expect(toggleOf('键盘与鼠标')).toHaveAttribute('aria-expanded', 'true');
  expect(settings.errors).toEqual([]);
});

test('焦点在设置页里时后退，焦点交还给侧边栏的「设置」；侧边栏藏着时给侧边栏键', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = await openSettings(page);
  await settings.select('界面语言').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  const entry = page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '设置', exact: true });
  await expect(entry).toBeFocused();

  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await settings.select('界面语言').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await expect(page.locator('[data-sidebar-key]')).toBeFocused();
  expect(settings.errors).toEqual([]);
});

test('从专辑页进设置页再后退，专辑页的过滤词还在', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = await openSettings(page);
  await clickSideButton(page, 'back');
  const filter = page.getByRole('searchbox', { name: '搜索专辑' });
  await filter.fill('nujabes');

  await enterSettings(page);
  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await expect(filter).toHaveValue('nujabes');
  expect(settings.errors).toEqual([]);
});

test('「常规」的「数据」下依次是媒体库缓存、歌词缓存、已关闭的提醒，在「相关设置」之前', async ({
  page,
}) => {
  const settings = await openSettings(page);
  const titles = page
    .locator('[data-settings-card] [id], [data-settings-expander] > :first-child [id], h3')
    .filter({ hasText: /^(数据|媒体库缓存|歌词缓存|已关闭的提醒|相关设置)$/ });
  await expect(titles).toHaveText(['数据', '媒体库缓存', '歌词缓存', '已关闭的提醒', '相关设置']);
  expect(settings.errors).toEqual([]);
});
