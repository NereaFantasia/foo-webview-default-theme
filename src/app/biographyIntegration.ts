import { atom } from 'jotai/vanilla';
import { localeAtom } from '../i18n/locale.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { albumsAtom } from '../library/albums.ts';
import { probeCover, sameCoverPixels } from '../immersive/cover/coverIdentity.ts';
import { startBiographyPhotos } from '../library/biography/biographyPhotos.ts';
import {
  biographyArtist,
  biographyLanguage,
  type BiographyInput,
  type BiographyLanguage,
} from '../library/biography/biographyModel.ts';
import { startBiographyPrefs } from '../library/biography/biographyPrefs.ts';
import { startBiography } from '../library/biography/biographyService.ts';
import { startBiographyLibrary } from '../library/biography/local/biographyLibrary.ts';
import { startBiographyArtistImages } from '../library/biography/local/biographyArtistImages.ts';
import { startBiographyOnlinePhoto } from '../library/biography/online/biographyOnlinePhoto.ts';
import { startLastfmKey } from '../library/biography/lastfm-api/lastfmKey.ts';
import { startBiographyIdentity } from '../library/biography/identity/biographyIdentity.ts';
import { startBiographyResources } from '../library/biography/biographyResources.ts';
import { startExternalLinkGate } from '../kit/external-link/externalLinkGate.ts';
import type { AppServices } from './services.ts';

export function startBiographyIntegration({
  store,
  rightCard,
  history,
  configWriter,
}: Pick<AppServices, 'store' | 'rightCard' | 'history' | 'configWriter'>) {
  const prefs = startBiographyPrefs(store, undefined, configWriter);
  const links = startExternalLinkGate(store, undefined, configWriter);
  const lastfmKey = startLastfmKey(store, undefined, undefined, configWriter);
  const resources = startBiographyResources(store, undefined, () => store.get(lastfmKey.key));
  const visible = atom(document.visibilityState !== 'hidden');
  const updateVisibility = () => store.set(visible, document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', updateVisibility);
  const language = atom<BiographyLanguage>((get) => {
    const chosen = get(prefs.state).language;
    return chosen === 'auto' ? biographyLanguage(get(localeAtom).active) : chosen;
  });
  const artist = atom((get) => {
    if (get(rightCard.deps.stopped)) return null;
    const track = get(rightCard.deps.current);
    // 有多值标签时取第一位曲目艺人；不拆字符串署名，也不回落到专辑艺人。
    return track ? biographyArtist(track.artists?.[0] ?? track.artist ?? '') : null;
  });
  const manual = atom((get) => {
    const name = get(artist);
    return get(prefs.state).identities.find((item) => item.artist === name) ?? null;
  });
  const active = atom((get) => {
    const view = get(rightCard.card.view);
    return (
      get(visible) &&
      get(historyAtom).place.id !== 'nowPlaying' &&
      view.form !== 'none' &&
      view.prefs.page === 'bio'
    );
  });
  const identity = startBiographyIdentity(
    store,
    {
      artist,
      // 只比专辑艺术家是他的专辑；客串的那张不是他的作品，比对会认错人。
      albums: atom((get) => {
        const library = get(albumsAtom);
        const name = get(artist);
        if (library.status === 'idle' || library.status === 'loading') return null;
        return library.albums
          .filter((album) => album.albumArtist === name)
          .map((album) => album.name);
      }),
      manual,
      enabled: atom((get) => get(prefs.state).enabled),
      active,
      locale: atom((get) => get(localeAtom).active),
      resources,
    },
    resources.musicbrainz,
  );
  const input = atom<BiographyInput | null>((get) => {
    const name = get(artist);
    if (!name) return null;
    const chosen = get(manual);
    const found = get(identity.state);
    // 手选刚删掉时状态还停在手选那位上，等身份服务重新认定，不能接着用它。
    const resolved =
      found.artist === name && found.status === 'resolved' && (chosen || !found.manual)
        ? found
        : null;
    const sourceArtist = chosen?.sourceArtist ?? resolved?.sourceArtist ?? null;
    return { artist: name, sourceArtist, language: get(language) };
  });
  const lastfm = resources.lastfm;
  const service = startBiography(
    store,
    {
      enabled: atom((get) => get(prefs.state).enabled),
      active,
      input,
      fetchText: lastfm.fetchText,
      sourceKey: lastfmKey.key,
      resources,
    },
    undefined,
    undefined,
    lastfm.fetchDetails,
  );
  const stops = [
    store.sub(service.state, () => {
      const { problem, detailsProblem } = store.get(service.state);
      for (const item of [problem, detailsProblem])
        if (item === 'keyInvalid' || item === 'keySuspended') lastfmKey.report(item);
    }),
  ];
  const photoSource = atom((get) => {
    const current = get(input);
    if (!get(prefs.state).enabled || !current?.sourceArtist) return null;
    const state = get(service.state);
    return (
      (state.document?.artist === current.sourceArtist ? state.document.photo : null) ??
      (state.details?.artist === current.sourceArtist ? state.details.photo : null) ??
      null
    );
  });
  const onlinePhoto = startBiographyOnlinePhoto(store, {
    source: photoSource,
    active,
    ready: atom((get) => {
      const state = get(service.state);
      return state.status !== 'loading' && !state.refreshing && !state.detailsLoading;
    }),
    probe: probeCover,
    artist: atom((get) => (get(prefs.state).enabled ? (get(input)?.sourceArtist ?? null) : null)),
    language,
    cache: resources.photos,
  });
  const photos = startBiographyPhotos(store, {
    artist: atom((get) => get(input)?.artist ?? null),
    active,
    albums: albumsAtom,
    probe: probeCover,
    same: sameCoverPixels,
    cache: resources.photos,
    online: onlinePhoto.state,
  });
  const local = startBiographyLibrary(store, {
    artist: atom((get) => get(input)?.artist ?? null),
    active,
  });
  stops.push(
    store.sub(resources.textRevision, () => {
      onlinePhoto.clear();
      photos.refresh();
    }),
  );
  const settingsRequested = atom(false);
  const artistImages = startBiographyArtistImages(store, {
    artists: atom((get) => get(service.state).details?.similar.map((item) => item.artist) ?? []),
    active,
    albums: albumsAtom,
    probe: probeCover,
  });
  return {
    links,
    resources,
    prefs,
    lastfmKey,
    identity,
    service,
    input,
    language,
    photos,
    local,
    artistImages,
    onlinePhoto,
    cacheState: atom((get) => {
      const cache = get(service.cacheState);
      const ids = get(identity.cacheState);
      const bytes = get(onlinePhoto.state).bytes;
      return {
        loaded: cache.loaded && ids.loaded,
        clearing: cache.clearing || ids.clearing,
        failed: cache.failed || ids.failed,
        bytes: cache.bytes + ids.bytes + bytes,
        count: cache.count + ids.count + (bytes > 0 ? 1 : 0),
      };
    }),
    settingsRequested,
    refresh() {
      service.refresh();
      artistImages.refresh();
      onlinePhoto.refresh();
    },
    refreshPhotos() {
      photos.refresh();
      onlinePhoto.refresh();
    },
    async clearCache() {
      onlinePhoto.clear();
      const results = await Promise.all([service.clearCache(), identity.clearCache()]);
      return results.every(Boolean);
    },
    openSettings() {
      store.set(settingsRequested, true);
      if (store.get(rightCard.card.view).form !== 'docked') rightCard.card.close();
      history.navigate({ id: 'settings' });
    },
    settingsFocused() {
      store.set(settingsRequested, false);
    },
    dispose() {
      document.removeEventListener('visibilitychange', updateVisibility);
      stops.forEach((stop) => stop());
      service.dispose();
      identity.dispose();
      photos.dispose();
      onlinePhoto.dispose();
      local.dispose();
      artistImages.dispose();
      prefs.dispose();
      lastfmKey.dispose();
      resources.dispose();
      links.dispose();
    },
  };
}

export type BiographyIntegration = ReturnType<typeof startBiographyIntegration>;
