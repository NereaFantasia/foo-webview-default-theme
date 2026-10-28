import { expect, test } from '@playwright/test';

test.use({ screenshot: 'off' });
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 底部通栏不滚动，署名一直可点；标题栏与胶囊的署名放得下时可点，真在滚动时只显示
const FORMS = [
  ['bottom', '[data-player-bar]', false],
  ['titlebar', '[data-now-playing]', true],
  ['capsule', '[data-player-capsule]', true],
] as const;

const LONG_ARTIST = Array.from({ length: 12 }, (_, index) => `Collaborator ${index + 1}`).join(
  ' & ',
);

for (const [style, surface, scrolls] of FORMS) {
  test(`${style} 署名放得下：艺人可点，点了去他的页面`, async ({ page }) => {
    await choosePlayerBar(page, style);
    await openPlayer(page);
    const artist = page
      .locator(surface)
      .getByRole('button', { name: PLAYING_TRACK.artist, exact: true });
    await expect(artist).toBeVisible();
    await artist.click();
    await expect(artist).toHaveAttribute('aria-current', 'page');
  });

  test(`${style} 署名放不下：${scrolls ? '滚动中只显示，不可点' : '截断，仍可点'}`, async ({
    page,
  }) => {
    await choosePlayerBar(page, style);
    await openPlayer(page, {
      state: {
        track: makeTrack({ ...PLAYING_TRACK, artist: LONG_ARTIST, artists: [LONG_ARTIST] }),
      },
    });
    const artist = page.locator(surface).getByRole('button', { name: LONG_ARTIST, exact: true });
    await expect(artist).toHaveCount(scrolls ? 0 : 1);
    await expect(page.locator(surface)).toContainText('Collaborator 1 ');
  });
}
