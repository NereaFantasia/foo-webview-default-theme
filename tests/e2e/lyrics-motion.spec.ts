import { expect, test } from '@playwright/test';

test.use({ screenshot: 'off' });

test('WinUI 3 连续换句时已显示的歌词不向下回跳', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: "import '/tests/fixtures/lyricsPlayerEntry.ts';",
    }),
  );
  await page.goto('/');
  await expect(page.locator('.amll-lyric-player')).toBeVisible();
  await page.waitForTimeout(1000);
  const jumps = await page.evaluate(async () => {
    const probe: unknown = Reflect.get(window, '__lyricsProbe');
    if (!probe || typeof probe !== 'object') throw new Error('缺少歌词驱动');
    const setPosition: unknown = Reflect.get(probe, 'position');
    const seek: unknown = Reflect.get(probe, 'seek');
    const changeTrack: unknown = Reflect.get(probe, 'track');
    if (typeof setPosition !== 'function') throw new Error('缺少位置控制');
    if (typeof seek !== 'function' || typeof changeTrack !== 'function')
      throw new Error('缺少跳转或换曲控制');
    const previous = new Map<Element, number>();
    const jumps: { text: string | null; from: number; to: number; target: string }[] = [];
    let animated = false;
    for (let frame = 0; frame < 160; frame++) {
      if (frame === 60 || frame === 120) {
        if (frame === 60) seek(0);
        else changeTrack();
        previous.clear();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      setPosition((frame % 60) / 10);
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const element of document.querySelectorAll<HTMLElement>('[class*="lyricLineWrapper"]')) {
        const top = element.getBoundingClientRect().top;
        const before = previous.get(element);
        if (before !== undefined && top - before > 2) {
          jumps.push({
            text: element.textContent,
            from: before,
            to: top,
            target: element.style.transform,
          });
        }
        previous.set(element, top);
        animated ||= element
          .getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSTransition &&
              animation.transitionProperty === 'transform' &&
              animation.playState === 'running',
          );
      }
    }
    return { jumps, animated };
  });
  expect(jumps.jumps.slice(0, 8)).toEqual([]);
  expect(jumps.animated).toBe(true);
});
