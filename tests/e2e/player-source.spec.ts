import { expect, test } from '@playwright/test';
import { LIBRARY_VIEW_PLAYLIST } from '../../src/playback/libraryView.ts';
import { guidOf } from '../fixtures/fakePlaylists.ts';
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { openLargeQueue, QUEUE_LIST_GUID } from '../fixtures/rightCardPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

const KEY = 'defaultTheme.playback.source';
const forms = [
  { style: 'bottom', selector: '[data-player-bar]' },
  { style: 'titlebar', selector: '[data-now-playing]' },
  { style: 'capsule', selector: '[data-player-capsule]' },
] as const;

for (const { style, selector } of forms) {
  test(`${style} 曲名下面写艺人与专辑、各带图标，不随来源变；没写的那一项不出`, async ({
    page,
  }) => {
    await choosePlayerBar(page, style);
    const { host, state, errors } = await openPlayer(page);
    host.config.set(KEY, { kind: 'artist', subject: '', name: '没写艺术家' });
    host.answer('playlist.getPlaying', {
      success: true,
      found: true,
      index: 0,
      guid: guidOf(7),
      name: LIBRARY_VIEW_PLAYLIST,
      trackCount: 2,
      isActive: false,
    });
    await page.reload();
    const player = page.locator(selector);
    const artistIcon = player.getByRole('img', { name: '艺人', exact: true });
    const albumIcon = player.getByRole('img', { name: '专辑', exact: true });
    await expect(player).toContainText(PLAYING_TRACK.artist);
    await expect(player).toContainText(PLAYING_TRACK.album);
    await expect(artistIcon).toHaveCount(1);
    await expect(albumIcon).toHaveCount(1);
    await expect(player).not.toContainText('没写艺术家');
    state.track = makeTrack({ title: '来源中的下一首', artist: '不同署名', album: '' });
    await host.emit('playback:trackChanged', state.track);
    await expect(player).toContainText('不同署名');
    await expect(albumIcon).toHaveCount(0);
    await expect(artistIcon).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('「接下来」节头写读回的艺人来源，与别的来源同一种写法', async ({ page }) => {
  const { host, errors } = await openLargeQueue(page, 3, 0, LIBRARY_VIEW_PLAYLIST);
  host.config.set(KEY, { kind: 'artist', subject: 'Nujabes', name: 'Nujabes' });
  host.answer('playlist.getPlaying', {
    success: true,
    found: true,
    index: 0,
    guid: QUEUE_LIST_GUID,
    name: LIBRARY_VIEW_PLAYLIST,
    trackCount: 4,
    isActive: true,
  });
  await page.reload();
  const source = page.getByRole('button', { name: '来自 艺人 · Nujabes', exact: true });
  await expect(source).toBeVisible();
  await expect(source).toContainText('Nujabes');
  expect(errors).toEqual([]);
});
