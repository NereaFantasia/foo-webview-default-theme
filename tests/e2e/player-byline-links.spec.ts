import { expect, test } from '@playwright/test';

test.use({ screenshot: 'off' });
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 三种形态的署名都不滚动：放得下时名字可点，放不下时艺人与专辑各自省略号截断，名字仍可点
const FORMS = [
  ['bottom', '[data-player-bar]'],
  ['titlebar', '[data-now-playing]'],
  ['capsule', '[data-player-capsule]'],
] as const;

const LONG_ARTIST = Array.from({ length: 12 }, (_, index) => `Collaborator ${index + 1}`).join(
  ' & ',
);

for (const [style, surface] of FORMS) {
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

  test(`${style} 署名放不下：截断，仍可点`, async ({ page }) => {
    await choosePlayerBar(page, style);
    await openPlayer(page, {
      state: {
        track: makeTrack({ ...PLAYING_TRACK, artist: LONG_ARTIST, artists: [LONG_ARTIST] }),
      },
    });
    const artist = page.locator(surface).getByRole('button', { name: LONG_ARTIST, exact: true });
    await expect(artist).toHaveCount(1);
    await expect(page.locator(surface)).toContainText('Collaborator 1 ');
  });
}
