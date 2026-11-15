import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore, type Atom } from 'jotai/vanilla';
import { expect, onTestFinished, vi } from 'vitest';
import { startLibraryTracks } from '../../src/library/libraryTracks.ts';
import { genresCatalogAtom, startGenresCatalog } from '../../src/library/genres/genresCatalog.ts';
import { startGenreValues } from '../../src/library/genreValues.ts';
import { trackRow } from './libraryRows.ts';
import { installFakeHost } from './unitHost.ts';
import { wholeLibrary } from './wholeLibrary.ts';

export const GENRE_TRACKS = [
  trackRow('First', 'One', { genre: 'Rock', discNumber: 1, trackNumber: 1 }),
  trackRow('First', 'Two', { genre: 'Rock', discNumber: 2, trackNumber: 1 }),
  trackRow('Second', 'Three', { genre: 'Jazz', trackNumber: 1 }),
  trackRow('', 'Four', { genre: '' }),
];

export function genresLibrary(
  tracks: readonly LibraryTrack[] = GENRE_TRACKS,
  ignored?: Atom<ReadonlySet<string>>,
) {
  const host = installFakeHost();
  host.answer('library.search', wholeLibrary(tracks));
  const store = createStore();
  const library = startLibraryTracks(store, () => 7, host.fb);
  const values = startGenreValues(store, library, host.fb);
  const catalog = startGenresCatalog(store, values, ignored);
  onTestFinished(() => {
    catalog.dispose();
    values.dispose();
    library.dispose();
  });
  const state = () => store.get(genresCatalogAtom);
  const ready = async () => {
    catalog.want();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
  };
  return { host, store, library, catalog, state, ready };
}
