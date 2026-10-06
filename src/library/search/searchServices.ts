import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { historyAtom } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import type { AlbumsService } from '../albums.ts';
import { albumSource } from '../albumActions.ts';
import { fetchAlbumTracks } from '../albumTracks.ts';
import { trackPathOf, type Album, type TrackAlbumFields } from '../../host/libraryContract.ts';
import { startSearchHistory, type SearchHistoryService } from './searchHistory.ts';
import type { SearchHit } from './searchQuery.ts';
import { startSearchResults, type SearchResultsService } from './searchResults.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import { LIBRARY_SOURCE } from '../../playback/playbackSource.ts';
import type { TrackActionsService } from '../../track/trackActions.ts';

interface SearchDeps {
  readonly catalog: Pick<AlbumsService, 'retry'>;
  readonly actions: Pick<TrackActionsService, 'playPaths'>;
  readonly configWriter: Pick<ConfigWriter, 'set'>;
  findAlbum(track: TrackAlbumFields): Album | null;
}

export interface SearchServices {
  readonly recent: SearchHistoryService;
  readonly preview: SearchResultsService;
  readonly notice: Atom<MessageKey | null>;
  createResults(): SearchResultsService;
  play(hit: SearchHit): Promise<boolean>;
  dispose(): void;
}

export function startSearchServices(store: Store, deps: SearchDeps): SearchServices {
  const recent = startSearchHistory(store, undefined, deps.configWriter);
  const preview = startSearchResults(store, deps.catalog);
  const notice = atom<MessageKey | null>(null);
  let disposed = false;
  let playing = false;
  return {
    recent,
    preview,
    notice,
    createResults: () => startSearchResults(store, deps.catalog),
    async play(hit) {
      if (disposed || playing) return false;
      playing = true;
      store.set(notice, null);
      const entry = store.get(historyAtom).entry;
      const current = () => !disposed && entry === store.get(historyAtom).entry;
      try {
        const album = hit.kind === 'album' ? hit.album : deps.findAlbum(hit.track);
        let paths: readonly string[];
        let index = 0;
        if (album) {
          const tracks = await settle(() => fetchAlbumTracks(fb, album, { fresh: true }));
          if (!current()) return false;
          index =
            hit.kind === 'track'
              ? (tracks?.findIndex((track) => track.handle === hit.track.handle) ?? -1)
              : 0;
          paths = tracks?.map(trackPathOf) ?? [];
        } else {
          const track = hit.kind === 'track' ? hit.track : null;
          paths = track?.path
            ? [trackPathOf({ path: track.path, subsong: track.subsong ?? 0 })]
            : [];
        }
        const ok =
          current() &&
          paths.length > 0 &&
          index >= 0 &&
          (await deps.actions.playPaths(paths, index, album ? albumSource(album) : LIBRARY_SOURCE));
        if (current() && !ok) store.set(notice, 'album.playFailed');
        return ok;
      } finally {
        playing = false;
      }
    },
    dispose() {
      disposed = true;
      preview.dispose();
      recent.dispose();
    },
  };
}

export const searchKey = serviceKey<SearchServices>('search');
