import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 文本框的右键菜单。WebView2 自带的右键菜单被宿主关了，文本框里没有剪切、粘贴的出口
// 这里在 document 的冒泡阶段挂一个监听，记下没被页面接住的右键：文本框里的由编辑菜单接住，其余的不拦

test.use({ screenshot: 'off' });

async function openApp(page: Page, clipboardText = '') {
  const errors = collectPageErrors(page);
  await page.addInitScript(() => {
    Reflect.set(window, '__unhandledMenuCount', 0);
    document.addEventListener('contextmenu', (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      Reflect.set(
        window,
        '__unhandledMenuCount',
        Number(Reflect.get(window, '__unhandledMenuCount')) + 1,
      );
    });
  });
  const host = await installPageHost(page, {
    answers: {
      clipboard: {
        read: {
          success: true,
          hasText: clipboardText !== '',
          hasImage: false,
          hasFiles: false,
          text: clipboardText,
        },
        write: { success: true },
      },
    },
  });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  const input = page.locator('[data-search-input="sidebar"]:visible');
  const menu = page.locator('[data-edit-menu]');
  const unhandledMenus = () =>
    page.evaluate(() => Number(Reflect.get(window, '__unhandledMenuCount')));
  return { host, errors, input, menu, unhandledMenus };
}

test('文本框右键出编辑菜单；文本框以外的右键不拦', async ({ page }) => {
  const { errors, input, menu, unhandledMenus } = await openApp(page);
  await input.fill('hello world');
  await input.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([/剪切/, /复制/, /粘贴/, /全选/]);
  expect(await unhandledMenus()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // 文本框以外的地方不拦
  await page.locator('main').click({ button: 'right', position: { x: 4, y: 4 } });
  await expect.poll(unhandledMenus).toBe(1);
  expect(errors).toEqual([]);
});

test('没有选区时剪切与复制置灰，选中后可用；复制写进宿主剪贴板', async ({ page }) => {
  const { host, errors, input, menu } = await openApp(page);
  await input.fill('hello world');
  await input.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /剪切/ })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /复制/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(6, 11));
  await input.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /复制/ })).toBeEnabled();
  await menu.getByRole('menuitem', { name: /复制/ }).click();
  await expect.poll(() => host.callsTo('clipboard.write')).toEqual([{ text: 'world' }]);
  await expect(input).toHaveValue('hello world');
  expect(errors).toEqual([]);
});

test('剪切删掉选中的字并写进剪贴板，粘贴把剪贴板里的字放回光标处', async ({ page }) => {
  const { host, errors, input, menu } = await openApp(page, 'ABC');
  await input.fill('hello world');
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(5, 11));
  await input.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /剪切/ }).click();
  await expect.poll(() => host.callsTo('clipboard.write')).toEqual([{ text: ' world' }]);
  await expect(input).toHaveValue('hello');
  await expect(input).toBeFocused();

  await input.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /粘贴/ }).click();
  await expect(input).toHaveValue('helloABC');
  expect(errors).toEqual([]);
});

test('全选选中整框内容', async ({ page }) => {
  const { errors, input, menu } = await openApp(page);
  await input.fill('hello world');
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 2));
  await input.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /全选/ }).click();
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, 11]);
  expect(errors).toEqual([]);
});

test('键盘唤出（Shift+F10）：菜单落在文本框附近，Esc 关闭后焦点回文本框', async ({ page }) => {
  const { errors, input, menu, unhandledMenus } = await openApp(page);
  await input.fill('hello world');
  await input.press('Shift+F10');
  await expect(menu).toBeVisible();
  const field = await input.boundingBox();
  const popup = await menu.boundingBox();
  if (!field || !popup) throw new Error('文本框或菜单没有排版');
  expect(Math.abs(popup.x - field.x)).toBeLessThan(field.width);
  expect(Math.abs(popup.y - (field.y + field.height))).toBeLessThan(field.height * 3);
  expect(await unhandledMenus()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(errors).toEqual([]);
});
