import { expect, test, type Page } from '@playwright/test';
import type { lyricsRecovery } from '../fixtures/lyricsRecoveryEntry.ts';
import { openPlayer } from '../fixtures/playerPage.ts';

test.use({ screenshot: 'off' });

const REPAIRABLE = [
  '[00:23.65]<00:23.61>前半句<00:25.12>末词',
  '[00:23.65]译文',
  '[00:24.82]<00:26.27>下一句<00:29.00>',
].join('\n');
const UNREPAIRABLE = '[00:10]<00:10>倒序<00:09>歌词<00:12>';
const VALID = '[00:20]<00:20>恢复<00:25>逐字<00:30>';

async function mount(
  page: Page,
  text: string,
  fault: Parameters<typeof lyricsRecovery.mount>[1] = null,
  stored = false,
) {
  await page.evaluate(
    ({ text, fault, stored }) => {
      const probe: typeof lyricsRecovery = Reflect.get(window, '__lyricsRecovery');
      probe.mount(text, fault, stored);
    },
    { text, fault, stored },
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const probe: typeof lyricsRecovery = Reflect.get(window, '__lyricsRecovery');
    return probe.snapshot();
  });
}

async function openProbe(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "import '/tests/fixtures/lyricsRecoveryEntry.ts';",
    }),
  );
  await page.goto('/');
  await page.waitForFunction(() => Reflect.has(window, '__lyricsRecovery'));
  return errors;
}

for (const stored of [false, true]) {
  test(`${stored ? '历史存档' : '新解析歌词'}：负时长末词修复后可交给真实播放器`, async ({
    page,
  }) => {
    const errors = await openProbe(page);
    await mount(page, REPAIRABLE, null, stored);
    await expect(page.locator('.amll-lyric-player')).toBeVisible();
    await expect
      .poll(async () => (await snapshot(page)).loaded[0]?.words.at(-1))
      .toMatchObject({
        startTime: 25120,
        endTime: 26270,
      });
    await expect(page.locator('[data-lyrics-fallback]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('无法推断的倒序词改为文字，界面按钮可用，换成正常歌词恢复', async ({ page }) => {
  const errors = await openProbe(page);
  await mount(page, UNREPAIRABLE);
  await expect(page.locator('[data-lyrics-fallback]')).toContainText('倒序歌词');
  expect((await snapshot(page)).listeners).toBe(0);
  await page.locator('#shell-button').click();
  expect((await snapshot(page)).clicks).toBe(1);
  await mount(page, VALID);
  await expect(page.locator('.amll-lyric-player')).toBeVisible();
  await expect(page.locator('[data-lyrics-fallback]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const fault of ['load', 'config', 'frame'] as const) {
  test(`${fault} 异常只影响歌词区，停止驱动后换词恢复`, async ({ page }) => {
    const errors = await openProbe(page);
    await mount(page, VALID, fault === 'frame' ? null : fault);
    if (fault === 'frame') {
      await expect(page.locator('.amll-lyric-player')).toBeVisible();
      await expect.poll(async () => (await snapshot(page)).updates).toBeGreaterThan(0);
      await page.evaluate(() => {
        const probe: typeof lyricsRecovery = Reflect.get(window, '__lyricsRecovery');
        probe.failFrame();
      });
    }
    await expect(page.locator('[data-lyrics-fallback]')).toContainText('恢复逐字');
    await expect(page.locator('.amll-lyric-player')).toHaveCount(0);
    await expect.poll(async () => (await snapshot(page)).listeners).toBe(0);
    const stopped = (await snapshot(page)).updates;
    await page.waitForTimeout(100);
    expect((await snapshot(page)).updates).toBe(stopped);
    await page.locator('#shell-button').click();
    expect((await snapshot(page)).clicks).toBe(1);
    await mount(page, VALID);
    await expect(page.locator('.amll-lyric-player')).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).listeners).toBe(1);
    await expect.poll(async () => (await snapshot(page)).updates).toBeGreaterThan(stopped);
    expect(errors).toEqual([]);
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}：主界面文字回退、重新读取与时间校正页共用保护`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const env = await openPlayer(page);
    const answer = (text: string) =>
      env.host.answer('lyrics.get', {
        success: true,
        available: true,
        source: 'embedded',
        path: '',
        lyrics: text,
        synced: true,
      });
    answer(UNREPAIRABLE);
    await page.locator('[data-right-card-key="lyrics"]').click();
    const panel = page.locator('[data-lyrics-panel]');
    await panel.getByRole('button', { name: '重新读取歌词' }).click();
    await expect(panel.locator('[data-lyrics-fallback]')).toContainText('倒序歌词');
    await panel.hover();
    await panel.getByRole('button', { name: '更多歌词操作' }).click();
    await page.getByRole('menuitem', { name: '时间校正', exact: true }).click();
    await expect(page.locator('[data-lyrics-timing] [data-lyrics-fallback]')).toContainText(
      '倒序歌词',
    );
    await page.keyboard.press('Alt+ArrowLeft');
    answer(REPAIRABLE);
    await panel.getByRole('button', { name: '重新读取歌词' }).click();
    await expect(panel.locator('.amll-lyric-player')).toBeVisible();
    await expect(panel.locator('[data-lyrics-fallback]')).toHaveCount(0);
    expect(env.errors).toEqual([]);
  });
}
