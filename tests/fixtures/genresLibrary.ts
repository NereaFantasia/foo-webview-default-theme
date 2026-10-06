import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { expect, onTestFinished, vi } from 'vitest';
import { startLibraryTracks } from '../../src/library/libraryTracks.ts';
import { genresCatalogAtom, startGenresCatalog } from '../../src/library/genres/genresCatalog.ts';
import { trackRow } from './libraryRows.ts';
import { installFakeHost } from './unitHost.ts';

export const GENRE_TRACKS = [
  trackRow('First', 'One', { genre: 'Rock', discNumber: 1, trackNumber: 1 }),
  trackRow('First', 'Two', { genre: 'Rock', discNumber: 2, trackNumber: 1 }),
  trackRow('Second', 'Three', { genre: 'Jazz', trackNumber: 1 }),
  trackRow('', 'Four', { genre: '' }),
];
export const genreTracksAnswer = (tracks: readonly LibraryTrack[]) => ({
  success: true as const,
  tracks: [...tracks],
  items: [...tracks],
  total: tracks.length,
  offset: 0,
});

export function genresLibrary(tracks: readonly LibraryTrack[] = GENRE_TRACKS) {
  const host = installFakeHost();
  host.answer('library.getAll', genreTracksAnswer(tracks));
  const store = createStore();
  const library = startLibraryTracks(store, () => 7, host.fb);
  const catalog = startGenresCatalog(store, library, host.fb);
  onTestFinished(() => {
    catalog.dispose();
    library.dispose();
  });
  const state = () => store.get(genresCatalogAtom);
  const ready = async () => {
    catalog.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
  };
  return { host, store, library, catalog, state, ready };
}
