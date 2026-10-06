import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDragOut } from '../../../src/host/dragOut.ts';
import { albumBrowseAtom } from '../../../src/library/albums/albumBrowse.ts';
import { albumSelectionAtom } from '../../../src/library/albums/albumSelection.ts';
import { startAlbumServices } from '../../../src/library/albumServices.ts';
import {
  albumKeyOf,
  LIBRARY_COALESCE_MS,
  LIBRARY_EVENTS,
} from '../../../src/host/libraryContract.ts';
import { startTrackActions } from '../../../src/track/trackActions.ts';
import { albumsAnswer } from '../../fixtures/albumLibrary.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const ALBUMS = [albumRow('A', 'X', { genre: 'Jazz' }), albumRow('B', 'X', { genre: 'Rock' })];

function start(host: UnitHost, store = createStore()) {
  return startAlbumServices(
    store,
    startDragOut(host.fb),
    startTrackActions(store, { record: () => {} }, host.fb),
    host.fb,
    createMemoryConfigWriter(host.fb),
  );
}

describe('startAlbumServices', () => {
  it('共用一个 store：偏好读回之后浏览按它分节，多选跟着看得见的专辑走', async () => {
    const host = installFakeHost({ config: { 'defaultTheme.browser.dimension': 'genre' } });
    host.answer('library.getAlbums', albumsAnswer(ALBUMS));
    const store = createStore();
    const services = start(host, store);
    await Promise.all([services.prefs.ready, services.browse.ready]);
    expect(store.get(albumBrowseAtom).sections.map((section) => section.key)).toEqual([
      'Jazz',
      'Rock',
    ]);
    services.selection.selectAll();
    services.browse.toggleSection('Rock');
    const selected = store.get(albumSelectionAtom);
    expect(selected.size).toBe(1);
    expect(selected.has(albumKeyOf(ALBUMS[0]!))).toBe(true);
    services.dispose();
  });

  it('释放之后四个库变更事件的监听都摘掉，逐个推过去也不再重读', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer(ALBUMS));
    const services = start(host);
    await vi.waitFor(() => expect(host.callsTo('library.getAlbums')).toHaveLength(1));
    for (const event of LIBRARY_EVENTS) expect(host.listenerCount(event)).toBeGreaterThan(0);
    services.dispose();
    for (const event of LIBRARY_EVENTS) {
      expect(host.listenerCount(event)).toBe(0);
      host.emit(event, { count: 1, timestamp: 1 });
      await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS * 2);
      expect(host.callsTo('library.getAlbums')).toHaveLength(1);
    }
  });
});
