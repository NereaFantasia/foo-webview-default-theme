import { expect, type Page } from '@playwright/test';
import { ARTIST_ALBUMS, artistAlbumTracks } from './artistsLibrary.ts';
import { albumsAnswer } from './albumLibrary.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

export async function openArtists(page: Page, width = 1280, configure?: (host: PageHost) => void) {
  await page.setViewportSize({ width, height: 800 });
  const errors = collectPageErrors(page);
  const host = await installPageHost(page);
  host.answer('library.getAlbums', albumsAnswer(ARTIST_ALBUMS));
  host.answer('library.getAlbumTracks', artistAlbumTracks);
  host.answer('library.getArtists', {
    success: true,
    count: 4,
    items: ['Nujabes', 'Shing02', 'Fat Jon', 'Cise Starr'].map((name) => ({
      name,
      albumCount: 3,
      trackCount: 5,
      totalDuration: 1000,
      albums: (name === 'Fat Jon' ? ARTIST_ALBUMS.slice(3) : ARTIST_ALBUMS.slice(0, 3)).map(
        (album) => ({ name: album.name, artist: album.albumArtist }),
      ),
    })),
  });
  configure?.(host);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '艺人', exact: true })
    .click();
  const view = page.locator('[data-page="artists"]').last();
  await expect(view).toBeVisible();
  return {
    host,
    errors,
    view,
    list: view.getByRole('grid', { name: '艺人' }),
    artist: (name: string) => view.locator(`[data-artist="${name}"]`),
  };
}
