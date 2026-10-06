import { expect, test, type Locator } from '@playwright/test';
import { PLAYER_BAR_STORAGE_KEY } from '../../src/theme/playerBarStyle.ts';
import { trackRow } from '../fixtures/libraryRows.ts';
import { openSongs } from '../fixtures/songsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

const TRACKS = Array.from({ length: 200 }, (_, index) =>
  trackRow('Album', `Track ${String(index + 1).padStart(4, '0')}`, { index }),
);

async function bottom(target: Locator): Promise<number> {
  const box = await target.boundingBox();
  if (!box) throw new Error('元素不在页面上');
  return box.y + box.height;
}

for (const scenario of [
  { style: 'capsule', widths: [1280, 390], colorScheme: 'dark' },
  { style: 'titlebar', widths: [900, 1280, 900], colorScheme: 'light' },
  { style: 'bottom', widths: [1280, 390], colorScheme: 'light' },
] as const) {
  test(`${scenario.style}：歌曲视口铺满余高，胶囊只占滚动尾部，键盘定位避开遮挡`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scenario.colorScheme });
    await page.setViewportSize({ width: scenario.widths[0], height: 700 });
    await page.addInitScript(({ key, style }) => localStorage.setItem(key, style), {
      key: PLAYER_BAR_STORAGE_KEY,
      style: scenario.style,
    });
    const songs = await openSongs(page, {
      configure(host) {
        // 宿主正放着一首：没有当前曲目时胶囊不出。
        host.answer('playback.getState', {
          success: true,
          state: 'playing',
          canSeek: true,
          canPause: true,
        });
        host.answer('playback.getCurrentTrack', {
          success: true,
          found: true,
          track: makeTrack(),
        });
        host.answer('library.getAll', {
          success: true,
          tracks: TRACKS,
          items: TRACKS,
          total: TRACKS.length,
          offset: 0,
        });
        host.answer('library.query', {
          success: true,
          tracks: TRACKS.map(({ handle, index }) => ({ handle, index })),
          total: TRACKS.length,
        });
      },
    });
    const scroller = songs.grid.locator('> div[tabindex="-1"]');
    const viewport = scroller.locator('[role="rowgroup"] > [role="none"]');
    const capsule = page.locator('[data-player-capsule]');

    for (const width of scenario.widths) {
      await page.setViewportSize({ width, height: 700 });
      const hasCapsule =
        scenario.style === 'capsule' || (scenario.style === 'titlebar' && width < 1008);
      const inset = hasCapsule ? 80 : 0;
      await expect(capsule).toHaveCount(hasCapsule ? 1 : 0);
      await expect
        .poll(() =>
          scroller.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).paddingBottom),
          ),
        )
        .toBe(inset);
      await songs.grid.press('Home');
      await expect(songs.row('Track 0001')).toHaveAttribute('data-row-focus', 'true');
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);

      // 视口伸到页面常规内边距处，末尾预留不从它的可见高度扣掉。
      await expect
        .poll(async () => Math.round((await bottom(songs.view)) - (await bottom(scroller))))
        .toBe(16);
      await expect
        .poll(async () => Math.round((await bottom(viewport)) - (await bottom(scroller))))
        .toBe(0);
      if (hasCapsule) {
        const cover = await capsule.boundingBox();
        expect(cover).not.toBeNull();
        expect(await bottom(viewport)).toBeGreaterThan((cover?.y ?? 0) + 40);
        const edge = await bottom(viewport);
        const coversEdge = await songs.grid.locator('[role="row"][aria-selected]').evaluateAll(
          (rows, y) =>
            rows.some((row) => {
              const box = row.getBoundingClientRect();
              return box.top < y && box.bottom >= y;
            }),
          edge,
        );
        expect(coversEdge).toBe(true);
      }

      const pageRows = await scroller.evaluate(
        (element, covered) => Math.floor((element.clientHeight - covered) / 40),
        inset,
      );
      await songs.grid.press('PageDown');
      const next = `Track ${String(pageRows + 1).padStart(4, '0')}`;
      await expect(songs.row(next)).toHaveAttribute('data-row-focus', 'true');
      await songs.grid.press('End');
      const last = songs.row('Track 0200');
      await expect(last).toHaveAttribute('data-row-focus', 'true');
      await expect
        .poll(async () => Math.round((await bottom(scroller)) - (await bottom(last))))
        .toBe(inset);
      if (hasCapsule) {
        const cover = await capsule.boundingBox();
        expect(await bottom(last)).toBeLessThanOrEqual(cover?.y ?? 0);
      }
    }
    expect(songs.errors).toEqual([]);
  });
}
