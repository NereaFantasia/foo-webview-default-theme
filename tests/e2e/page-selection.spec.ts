import { expect, test } from '@playwright/test';
import { makePlaylist } from '../fixtures/fakePlaylists.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';

// 界面文字默认不能选、输入框照常能选；滚动条只留手柄。手柄的粗细与颜色只能实机看，这里只核对占位宽度。
// headless 缺省带 --hide-scrollbars，滚动条不占位；去掉它才量得到。
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('焦点不在输入框时按 Ctrl+A 什么都不选中', async ({ page }) => {
  const { errors } = await openSidebar(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Control+a');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  expect(errors).toEqual([]);
});

test('输入框里 Ctrl+A 照常全选框里的文字', async ({ page }) => {
  const { nav, errors } = await openSidebar(page);
  await nav.getByRole('button', { name: '新建', exact: true }).click();
  const input = nav.getByRole('textbox', { name: '播放列表名称' });
  await input.fill('Morning');
  await input.press('End');
  await input.press('Control+a');
  expect(
    await input.evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, 'Morning'.length]);
  expect(errors).toEqual([]);
});

test('滚动区的滚动条占 10px，没有两端箭头占的位置', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const many = Array.from({ length: 30 }, (_, index) =>
    makePlaylist(index, `List ${String(index).padStart(2, '0')}`, { isActive: index === 0 }),
  );
  const { entry, errors } = await openSidebar(page, many);
  const gutter = await entry('List 00').evaluate((element) => {
    let node: HTMLElement | null = element.parentElement;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    return node ? node.offsetWidth - node.clientWidth : -1;
  });
  expect(gutter).toBe(10);
  expect(errors).toEqual([]);
});
