import { expect, test } from '@playwright/test';
import { choosePlayerBar, openPlayer } from '../fixtures/playerPage.ts';
import { openSidebar } from '../fixtures/sidebarPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 界面文字默认不能选、输入框照常能选

test('按住鼠标拖过可跳转的名字，什么都选不中', async ({ page }) => {
  const track = makeTrack({ title: 'Probe', artist: 'Alpha, Beta', artists: ['Alpha', 'Beta'] });
  await choosePlayerBar(page, 'titlebar');
  const { errors } = await openPlayer(page, { state: { track } });
  const names = page.locator('[data-now-playing] [class*="subRow"] [class*="fui-Link"]');
  await expect(names).toHaveCount(2);
  const first = await names.first().boundingBox();
  const last = await names.last().boundingBox();
  if (!first || !last) throw new Error('署名里的两个名字没有排版出来');
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  expect(errors).toEqual([]);
});

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
