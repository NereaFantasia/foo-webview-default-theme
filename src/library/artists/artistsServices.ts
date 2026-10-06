import type { ConfigWriter } from '../../host/configWrite.ts';
import { atom, type createStore } from 'jotai/vanilla';
import { historyAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import { albumsAtom } from '../albums.ts';
import type { Album } from '../../host/libraryContract.ts';
import { startCreditedArtists } from './artistIndex.ts';
import { startArtistDetail } from './artistDetail.ts';
import { startArtistPrefs } from './artistPrefs.ts';
import { startArtistTidyPrefs } from './artistTidyPrefs.ts';
import { createArtistCatalog } from './artistCatalog.ts';
import { startArtistPlaces } from './artistPlaces.ts';
import { isCompilation } from './artistNames.ts';
import { startArtistBiography, type ArtistBiographyShared } from './artistBiography.ts';
import { startArtistOnline } from './artistOnline.ts';
import { startArtistActions, type ArtistActionsDeps } from './artistActions.ts';
import type { CommandRegistry } from '../../nav/commandRegistry.ts';
import { startArtistWrites } from './artistWrites.ts';
import type { TrackMenuService } from '../trackMenu.ts';

export interface ArtistsDeps extends Pick<ArtistActionsDeps, 'actions' | 'openSongs'> {
  readonly configWriter?: Pick<ConfigWriter, 'set'>;
  readonly history: NavHistoryService;
  readonly biography: ArtistBiographyShared;
  readonly ratingStamp: () => number;
  readonly commands: CommandRegistry;
  readonly trackMenu: Pick<TrackMenuService, 'prepare'>;
  openAlbum(album: Album): void;
}

export function startArtists(store: ReturnType<typeof createStore>, deps: ArtistsDeps) {
  const prefs = startArtistPrefs(store);
  const tidy = startArtistTidyPrefs(store, deps.configWriter);
  const selected = atom<string | null>(null);
  const temporary = atom(false);
  const active = atom((get) => get(historyAtom).place.id === 'artists');
  const credited = startCreditedArtists(store, active);
  const catalog = createArtistCatalog({
    albums: albumsAtom,
    credited: credited.state,
    prefs: prefs.state,
    temporary,
    ...tidy,
  });
  const places = startArtistPlaces(
    store,
    {
      history: deps.history,
      own: catalog.own,
      all: catalog.all,
      loaded: atom((get) => get(catalog.state).loaded),
      complete: atom(
        (get) => get(albumsAtom).status === 'ready' && get(credited.state).rows !== null,
      ),
      locale: deps.biography.locale,
      prefs,
    },
    selected,
    temporary,
  );
  const detail = startArtistDetail(store, {
    subject: selected,
    active,
    albums: albumsAtom,
    credited: credited.state,
    stamp: deps.ratingStamp,
  });
  const compilation = atom((get) => {
    const name = get(selected);
    return name !== null && (!name || isCompilation(name, get(tidy.compilations)));
  });
  const biography = startArtistBiography(store, {
    ...deps.biography,
    subject: atom((get) => (get(compilation) ? null : get(selected))),
    active,
    albums: albumsAtom,
  });
  const online = startArtistOnline(store, {
    sourceArtist: biography.sourceArtist,
    apiKey: deps.biography.lastfmKey.key,
    enabled: biography.enabled,
    active,
    detail: detail.state,
    libraryArtists: atom((get) => get(catalog.all).map((row) => row.name)),
  });
  const actions = startArtistActions(store, {
    ...deps,
    albums: albumsAtom,
    credited: atom((get) => get(credited.state).rows),
  });
  const writes = startArtistWrites(store);
  let disposed = false;
  return {
    store,
    prefs,
    tidy,
    catalog,
    places,
    detail,
    biography,
    online,
    compilation,
    actions,
    writes,
    commands: deps.commands,
    trackMenu: deps.trackMenu,
    openAlbum: deps.openAlbum,
    async play(index = 0, shuffle = false) {
      const state = store.get(detail.state);
      if (
        disposed ||
        state.subject !== store.get(selected) ||
        !state.detail ||
        state.partial ||
        state.guestPending ||
        state.refreshFailed
      )
        return;
      const tracks = [...state.detail.own, ...state.detail.guest].flatMap((group) => group.tracks);
      await actions.play([state.detail.subject], shuffle, tracks, index);
    },
    retry() {
      void credited.retry();
      detail.refresh();
    },
    dispose() {
      disposed = true;
      actions.dispose();
      writes.dispose();
      online.dispose();
      biography.dispose();
      detail.dispose();
      places.dispose();
      credited.dispose();
      tidy.dispose();
    },
  };
}
export type ArtistsServices = ReturnType<typeof startArtists>;
