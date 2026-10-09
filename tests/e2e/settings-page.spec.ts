import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  enterSettings,
  openSettings,
  waitFrames,
  type SettingsPage,
} from '../fixtures/settingsPage.ts';
import { clickSideButton } from '../fixtures/sidebarPage.ts';

// 设置页的版式与进出：三档宽度下目录或分类条、下拉框在右或换行；点目录滚到那一组、滚动时亮的那一项跟着换；
// 离开再回来滚动位置还在。观感（间距、配色、动效）只能实机看。

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('元素没有画出来');
  return rect;
}

/** 卡里的下拉框相对标题摆在哪：同一行的右边，还是换到了下面。量的是下拉框的外框。 */
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
    // 卡的右内边距 16、边框 1。
    rightGap: card.x + card.width - (field.x + field.width),
  };
}

const scrollTop = (scroller: Locator) => scroller.evaluate((element) => element.scrollTop);

/** 把窗口调到设置页正好 `target` 宽。侧边栏的形态随窗口宽变，按量到的差调几次。 */
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

/** 目录里亮着的那一项。 */
const currentItem = (settings: SettingsPage) =>
  settings.nav.locator('[aria-current="page"], [aria-current="true"]');

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`${colorScheme === 'dark' ? '深色' : '浅色'}档`, () => {
    test.use({ colorScheme });

    test('1280：目录在左，卡列最宽 760，下拉框在标题右边', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const settings = await openSettings(page);
      await expect(settings.nav).toHaveAttribute('data-settings-nav', 'directory');
      const groups = ['常规', '外观', '播放', '沉浸视图', '歌词', '在线内容', '快捷键', '关于'];
      await expect(settings.nav.getByRole('button')).toHaveText(groups);
      for (const name of groups) {
        await expect(settings.nav.getByRole('button', { name, exact: true })).toBeVisible();
      }
      const language = await fieldPlacement(settings, '界面语言');
      expect(language.beside).toBe(true);
      expect(language.fieldWidth).toBe(220);
      expect(language.cardWidth).toBe(760);
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

    test('390：目录收成分类条，下拉框换到标题下面、与文字左对齐、占满一行', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const settings = await openSettings(page);
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(settings.nav).toHaveAttribute('data-settings-nav', 'strip');
      await expect(settings.nav.getByRole('button', { name: '常规' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      const language = await fieldPlacement(settings, '界面语言');
      expect(language.below).toBe(true);
      expect(Math.abs(language.indent)).toBeLessThan(1);
      expect(language.rightGap).toBe(17);
      // 开关不换行，仍在标题右边。
      await settings.expand('托盘');
      const title = await box(settings.row('最小化到托盘').getByText('最小化到托盘'));
      const toggle = await box(page.getByRole('switch', { name: '最小化到托盘' }));
      expect(toggle.x).toBeGreaterThan(title.x + title.width);
      expect(settings.errors).toEqual([]);
    });
  });
}

test('点目录滚到那一组并亮着它；自己滚回去后亮的那一项跟着换', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page);
  await expect(currentItem(settings)).toHaveText('常规');

  await settings.nav.getByRole('button', { name: '关于', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: '关于' })).toBeInViewport();
  await expect(currentItem(settings)).toHaveText('关于');
  // 焦点落到那一组的标题上，键盘从那里接着走。
  await expect(page.getByRole('heading', { level: 2, name: '关于' })).toBeFocused();
  expect(await scrollTop(settings.scroller)).toBeGreaterThan(0);

  await settings.scroller.hover();
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => scrollTop(settings.scroller)).toBe(0);
  await expect(currentItem(settings)).toHaveText('常规');
  expect(settings.errors).toEqual([]);
});

test('分类条里点一项同样滚到那一组', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await settings.nav.getByRole('button', { name: '外观' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '外观' })).toBeInViewport();
  await expect(settings.nav.getByRole('button', { name: '外观' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(settings.errors).toEqual([]);
});

test('点目录后滚动途中亮的就是点的那一组，不跟着途经的各组跳', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const settings = await openSettings(page);
  await settings.nav.getByRole('button', { name: '播放', exact: true }).click();
  // 平滑滚动才刚开始，眼前还是「常规」：当场读一次，不用会重试的断言，否则滚完了按可见的组算也会过。
  expect(await currentItem(settings).textContent()).toBe('播放');
  await expect(page.getByRole('heading', { level: 2, name: '播放' })).toBeInViewport();
  await expect(currentItem(settings)).toHaveText('播放');
  expect(settings.errors).toEqual([]);
});

test('点选的滚动停下之后，焦点带着卡列走也算自己滚了，亮的那一项跟着换', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page);
  await settings.nav.getByRole('button', { name: '外观', exact: true }).click();
  await expect(currentItem(settings)).toHaveText('外观');
  await waitFrames(page);
  const before = await scrollTop(settings.scroller);

  await page.locator('[data-settings-credit="jotai"]').focus();
  await expect.poll(() => scrollTop(settings.scroller)).toBeGreaterThan(before);
  await expect(currentItem(settings)).toHaveText('关于');
  expect(settings.errors).toEqual([]);
});

test('焦点在目录里时页宽跨过分界：换了排法，焦点落在新一排亮着的那一项上', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = await openSettings(page);
  await settings.nav.getByRole('button', { name: '外观', exact: true }).focus();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(settings.nav).toHaveAttribute('data-settings-nav', 'strip');
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
  // 页宽 600：目录收成分类条，卡列 552，下拉框放得进标题右边。按目录排法量卡列只有 360，会误判成窄档。
  await fitPageWidth(page, 600);
  await expect(settings.nav).toHaveAttribute('data-settings-nav', 'strip');
  expect((await fieldPlacement(settings, '界面语言')).beside).toBe(true);

  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  // 回来时设置页重新挂上。每一帧绘制前记下语言下拉框离卡片上沿多远：在右边约 13，换行了在 30 以上。
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

test('离开设置页再回来，滚动位置还在', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = await openSettings(page);
  await settings.nav.getByRole('button', { name: '快捷键', exact: true }).click();
  await expect(currentItem(settings)).toHaveText('快捷键');
  const left = await scrollTop(settings.scroller);
  expect(left).toBeGreaterThan(0);

  // 后退回专辑页，再前进回设置页。
  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await clickSideButton(page, 'forward');
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  await expect.poll(() => scrollTop(settings.scroller)).toBe(left);
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
  const filter = page.getByRole('textbox', { name: '筛选专辑' });
  await filter.fill('nujabes');

  await enterSettings(page);
  await clickSideButton(page, 'back');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await expect(filter).toHaveValue('nujabes');
  expect(settings.errors).toEqual([]);
});
