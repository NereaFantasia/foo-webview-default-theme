import { expect, test } from '@playwright/test';
import { openImmersive } from '../fixtures/immersivePage.ts';
import { PLAYING_TRACK } from '../fixtures/playerPage.ts';

// 正在播放全屏页的进出与舞台上的字：盖住整窗、曲目字段写出来，Esc 与胶囊都是后退。

test('走到正在播放：整窗盖住，舞台写出曲名与艺术家，焦点收进这一层', async ({ page }) => {
  const { view, errors } = await openImmersive(page);
  await expect(view.locator('[data-field="title"]')).toHaveText(PLAYING_TRACK.title);
  await expect(view.locator('[data-field="artist"]')).toHaveText(PLAYING_TRACK.artist);
  // 进场过渡由小放大，播完才是整窗大小。
  await expect
    .poll(() => view.boundingBox())
    .toStrictEqual({ x: 0, y: 0, width: 1280, height: 800 });
  await expect(view).toBeFocused();
  expect(errors).toStrictEqual([]);
});

test('canvas 件都挂上：山脊图、网格、转动层、声场图、频谱柱与整轨波形，挂载与首帧不报错', async ({
  page,
}) => {
  const { view, errors } = await openImmersive(page);
  await expect(view.locator('[data-terrain] canvas')).toHaveCount(1);
  // 网格、转动层、声场图、频谱柱、整轨波形各一块，山脊图一块，封面底色没有源图时不挂。
  await expect.poll(() => view.locator('canvas').count()).toBeGreaterThanOrEqual(6);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(errors).toStrictEqual([]);
});

test('Esc 后退：这一层退场移走，回到进来前的页面', async ({ page }) => {
  const { view, errors } = await openImmersive(page);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page.locator('[data-page="albums"]')).toBeVisible();
  expect(errors).toStrictEqual([]);
});

test('右上的 Esc 胶囊与按 Esc 一样是后退', async ({ page }) => {
  const { view } = await openImmersive(page);
  await view.getByRole('button', { name: '退出沉浸' }).click();
  await expect(view).toHaveCount(0);
});

test('空格经命令登记处切一次播放 / 暂停', async ({ page }) => {
  const { calls } = await openImmersive(page);
  await page.keyboard.press(' ');
  await expect.poll(() => calls('playback.playOrPause').length).toBe(1);
  // 再走一轮到宿主的往返，同一次按键若被接手两次，第二次这时也到了。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(calls('playback.playOrPause')).toHaveLength(1);
});

test('Tab 只在这一层里转，不落到底下被盖住的键上', async ({ page }) => {
  const { view } = await openImmersive(page);
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    const inside = await view.evaluate((root) => root.contains(document.activeElement));
    expect(inside, `第 ${step + 1} 次 Tab`).toBe(true);
  }
});
