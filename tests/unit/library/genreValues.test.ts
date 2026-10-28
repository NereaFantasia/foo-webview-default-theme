import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  GENRES_VALUES_PATTERN,
  genreValuesAtom,
  startGenreValues,
} from '../../../src/library/genreValues.ts';
import { startLibraryTracks } from '../../../src/library/libraryTracks.ts';
import { genreTracksAnswer } from '../../fixtures/genresLibrary.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const track = trackRow('One', 'Multi', { genre: 'Rock, Soul' });
const plain = trackRow('Two', 'Plain', { genre: 'Jazz' });

it('显示串带逗号的曲目补读真实值，其余照显示串；释放时在途的补读晚到也不落盘', async () => {
  const host = installFakeHost();
  host.answer('library.getAll', genreTracksAnswer([track, plain]));
  const store = createStore();
  const library = startLibraryTracks(store, () => 7, host.fb);
  const values = startGenreValues(store, library, host.fb);
  onTestFinished(() => library.dispose());
  const held = host.hold('titleformat.evalBatch');
  values.want();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  expect(host.callsTo('titleformat.evalBatch')[0]).toMatchObject({
    pattern: GENRES_VALUES_PATTERN,
    paths: [track.path],
  });
  expect(store.get(genreValuesAtom).status).toBe('loading');
  values.dispose();
  held.respond(0, {
    success: true,
    pattern: GENRES_VALUES_PATTERN,
    total: 1,
    successCount: 1,
    errorCount: 0,
    results: [{ path: track.path, success: true, result: 'Rock\u001fSoul', infoAvailable: true }],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.get(genreValuesAtom)).toMatchObject({ status: 'loading', generation: 0 });
  expect(store.get(genreValuesAtom).values.size).toBe(0);
});
