import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { AlbumsState } from '../albums.ts';
import type { BiographyLanguage } from '../biography/biographyModel.ts';
import type { BiographyPrefsService } from '../biography/biographyPrefs.ts';
import type { BiographyResources } from '../biography/biographyResources.ts';
import type { LastfmKeyService } from '../biography/lastfm-api/lastfmKey.ts';
import { startBiography } from '../biography/biographyService.ts';
import { startBiographyIdentity } from '../biography/identity/biographyIdentity.ts';
import { startBiographyPhotos } from '../biography/biographyPhotos.ts';
import { startBiographyOnlinePhoto } from '../biography/online/biographyOnlinePhoto.ts';
import { startBiographyArtistImages } from '../biography/local/biographyArtistImages.ts';

export interface ArtistBiographyShared {
  readonly prefs: BiographyPrefsService;
  readonly resources: BiographyResources;
  readonly lastfmKey: LastfmKeyService;
  readonly language: Atom<BiographyLanguage>;
  readonly locale: Atom<string>;
  readonly viewerTop: Atom<number>;
  readonly probe: (url: string) => Promise<Uint8ClampedArray | null>;
  readonly same: (a: ArrayLike<number>, b: ArrayLike<number>) => boolean;
  openSettings(): void;
}
export interface ArtistBiographyDeps extends ArtistBiographyShared {
  readonly subject: Atom<string | null>;
  readonly active: Atom<boolean>;
  readonly albums: Atom<AlbumsState>;
}

export function startArtistBiography(
  store: ReturnType<typeof createStore>,
  deps: ArtistBiographyDeps,
) {
  const enabled = atom((get) => get(deps.prefs.state).enabled);
  const manual = atom(
    (get) =>
      get(deps.prefs.state).identities.find((item) => item.artist === get(deps.subject)) ?? null,
  );
  const identity = startBiographyIdentity(
    store,
    {
      artist: deps.subject,
      active: deps.active,
      enabled,
      manual,
      locale: deps.locale,
      resources: deps.resources,
      albums: atom((get) => {
        const library = get(deps.albums);
        return library.status === 'idle' || library.status === 'loading'
          ? null
          : library.albums
              .filter((album) => album.albumArtist === get(deps.subject))
              .map((album) => album.name);
      }),
    },
    deps.resources.musicbrainz,
  );
  const sourceArtist = atom((get) => {
    const name = get(deps.subject);
    const chosen = get(manual);
    const found = get(identity.state);
    return (
      chosen?.sourceArtist ??
      (found.artist === name && found.status === 'resolved' && !found.manual
        ? found.sourceArtist
        : null)
    );
  });
  const input = atom((get) => {
    const artist = get(deps.subject);
    return artist === null
      ? null
      : { artist, sourceArtist: get(sourceArtist), language: get(deps.language) };
  });
  const source = deps.resources.lastfm;
  const service = startBiography(
    store,
    {
      input,
      enabled,
      active: deps.active,
      resources: deps.resources,
      fetchText: source.fetchText,
      sourceKey: deps.lastfmKey.key,
    },
    undefined,
    undefined,
    source.fetchDetails,
  );
  const photoSource = atom((get) => {
    const artist = get(sourceArtist);
    const state = get(service.state);
    if (!get(enabled) || !artist) return null;
    return (
      (state.document?.artist === artist ? state.document.photo : null) ??
      (state.details?.artist === artist ? state.details.photo : null) ??
      null
    );
  });
  const onlinePhoto = startBiographyOnlinePhoto(store, {
    source: photoSource,
    active: deps.active,
    probe: deps.probe,
    artist: atom((get) => (get(enabled) ? get(sourceArtist) : null)),
    language: deps.language,
    cache: deps.resources.photos,
    ready: atom((get) => {
      const state = get(service.state);
      return state.status !== 'loading' && !state.refreshing && !state.detailsLoading;
    }),
  });
  const photos = startBiographyPhotos(store, {
    artist: deps.subject,
    active: deps.active,
    albums: deps.albums,
    probe: deps.probe,
    same: deps.same,
    cache: deps.resources.photos,
    online: onlinePhoto.state,
  });
  const artistImages = startBiographyArtistImages(store, {
    artists: atom((get) => get(service.state).details?.similar.map((item) => item.artist) ?? []),
    active: deps.active,
    albums: deps.albums,
    probe: deps.probe,
  });
  const stops = [
    store.sub(service.state, () => {
      const state = store.get(service.state);
      for (const problem of [state.problem, state.detailsProblem])
        if (problem === 'keyInvalid' || problem === 'keySuspended') deps.lastfmKey.report(problem);
    }),
    store.sub(deps.resources.textRevision, () => {
      onlinePhoto.clear();
      photos.refresh();
    }),
  ];
  return {
    ...deps,
    input,
    sourceArtist,
    enabled,
    identity,
    service,
    photos,
    onlinePhoto,
    artistImages,
    refresh() {
      identity.refresh();
      service.refresh();
      photos.refresh();
      onlinePhoto.refresh();
      artistImages.refresh();
    },
    dispose() {
      stops.forEach((stop) => stop());
      identity.dispose();
      service.dispose();
      photos.dispose();
      onlinePhoto.dispose();
      artistImages.dispose();
    },
  };
}
export type ArtistBiography = ReturnType<typeof startArtistBiography>;
