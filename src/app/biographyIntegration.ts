import { atom } from 'jotai/vanilla';
import { localeAtom } from '../i18n/locale.ts';
import { mainHistoryAtom } from '../nav/navHistory.ts';
import { albumsAtom } from '../library/albums.ts';
import { probeCover } from '../covers/coverIdentity.ts';
import { sameBiographyPhotoPixels } from '../library/biography/biographyPhotoSimilarity.ts';
import { startBiographyPhotos } from '../library/biography/biographyPhotos.ts';
import {
  biographyCandidates,
  NO_CANDIDATES,
  pickBiographyArtist,
  type BiographyCandidates,
} from '../library/biography/biographyArtists.ts';
import { biographyLanguage, type BiographyLanguage } from '../library/biography/biographyModel.ts';
import { biographySearching } from '../library/biography/biographySearching.ts';
import { startBiographyPrefs } from '../library/biography/biographyPrefs.ts';
import { startBiographySourcePrefs } from '../library/biography/biographySourcePrefs.ts';
import { startBiography } from '../library/biography/biographyService.ts';
import { startLastfmFallback } from '../library/biography/lastfmFallback.ts';
import { startBiographyLibrary } from '../library/biography/local/biographyLibrary.ts';
import { startBiographyArtistImages } from '../library/biography/local/biographyArtistImages.ts';
import { startBiographyOnlinePhoto } from '../library/biography/online/biographyOnlinePhoto.ts';
import { ARTIST_MOTION_PREF } from '../library/biography/online/motionPref.ts';
import { onlinePhotoOf, onlinePhotoReady } from '../library/biography/online/onlinePhotoSource.ts';
import { startLastfmKey } from '../library/biography/lastfm-api/lastfmKey.ts';
import { localAlbumsOf, startBiographyInput } from '../library/biography/biographyInput.ts';
import { startBiographyResources } from '../library/biography/biographyResources.ts';
import { startExternalLinkGate } from '../kit/external-link/externalLinkGate.ts';
import type { SettingsNavService } from '../settings/settingsNav.ts';
import type { AppServices } from './services.ts';

export function startBiographyIntegration({
  store,
  rightCard,
  settingsNav,
  configWriter,
}: Pick<AppServices, 'store' | 'rightCard' | 'configWriter'> & {
  readonly settingsNav: Pick<SettingsNavService, 'open'>;
}) {
  const prefs = startBiographyPrefs(store, undefined, configWriter);
  const sourcePrefs = startBiographySourcePrefs(store, undefined, configWriter, {
    ready: prefs.ready,
    enabled: atom((get) => get(prefs.state).enabled),
  });
  const links = startExternalLinkGate(store, undefined, configWriter);
  ARTIST_MOTION_PREF.load(store);
  const lastfmKey = startLastfmKey(store, undefined, undefined, configWriter);
  const resources = startBiographyResources(store, undefined, () => store.get(lastfmKey.key));
  const visible = atom(document.visibilityState !== 'hidden');
  const updateVisibility = () => store.set(visible, document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', updateVisibility);
  const language = atom<BiographyLanguage>((get) => {
    const chosen = get(prefs.state).language;
    return chosen === 'auto' ? biographyLanguage(get(localeAtom).active) : chosen;
  });
  const candidates = atom((get): BiographyCandidates => {
    if (get(rightCard.deps.stopped)) return NO_CANDIDATES;
    const track = get(rightCard.deps.current);
    return track ? biographyCandidates(track) : NO_CANDIDATES;
  });
  // 用户在多位艺人里选的那位；换曲后不在署名里就作废，回到第一位
  const picked = atom<string | null>(null);
  const artist = atom((get) => pickBiographyArtist(get(candidates), get(picked)));
  // 来源偏好读回之前来源只是缺省值，等读回再放行，免得已存为 Last.fm 的用户白发 Apple 的请求
  const enabled = atom((get) => get(prefs.state).enabled && get(sourcePrefs.loaded));
  const locale = atom((get) => get(localeAtom).active);
  const manual = atom((get) => {
    const name = get(artist);
    return get(prefs.state).identities.find((item) => item.artist === name) ?? null;
  });
  const appleManual = atom((get) => {
    const name = get(artist);
    return get(sourcePrefs.identities).find((item) => item.artist === name) ?? null;
  });
  const active = atom((get) => {
    const view = get(rightCard.card.view);
    return (
      get(visible) &&
      get(mainHistoryAtom).place.id !== 'nowPlaying' &&
      view.form !== 'none' &&
      view.prefs.page === 'bio'
    );
  });
  const albumList = atom((get) => localAlbumsOf(get(albumsAtom), get(artist)));
  const wiring = startBiographyInput(store, {
    artist,
    albums: albumList,
    source: sourcePrefs.source,
    language,
    locale,
    enabled,
    active,
    lastfmManual: manual,
    appleManual,
    resources,
  });
  const identity = wiring.lastfmIdentity;
  const input = wiring.input;
  const lastfm = resources.lastfm;
  const service = startBiography(
    store,
    {
      enabled,
      active,
      input,
      fetchText: resources.fetchText,
      sourceKey: lastfmKey.key,
      resources,
    },
    undefined,
    undefined,
    lastfm.fetchDetails,
  );
  // 面板读的正文：Apple 没有简介时可能换成 Last.fm 补的那份。照片、曲风仍按 Apple 那份
  const text = startLastfmFallback(store, {
    artist,
    albums: albumList,
    active,
    enabled,
    input,
    apple: service,
    sourcePrefs,
    manual,
    language,
    locale,
    lastfmKey: lastfmKey.key,
    resources,
  });
  const stops = [
    store.sub(text.state, () => {
      const { problem, detailsProblem, fallbackProblem } = store.get(text.state);
      for (const item of [problem, detailsProblem, fallbackProblem])
        if (item === 'keyInvalid' || item === 'keySuspended') lastfmKey.report(item);
    }),
    store.sub(candidates, () => {
      const name = store.get(picked);
      if (name !== null && !store.get(candidates).names.includes(name)) store.set(picked, null);
    }),
  ];
  const photoSource = atom((get) =>
    get(enabled) ? onlinePhotoOf(get(input), get(service.state)) : null,
  );
  const ready = atom((get) => onlinePhotoReady(get(service.state)));
  const onlinePhoto = startBiographyOnlinePhoto(store, {
    source: photoSource,
    active,
    ready,
    probe: probeCover,
    // 相册只有 Last.fm 有，取它要 Last.fm 的艺人名
    artist: atom((get) => {
      const current = get(input);
      return get(enabled) && current?.source === 'lastfm' ? current.sourceArtist : null;
    }),
    language,
    cache: resources.photos,
  });
  const searching = biographySearching({
    enabled,
    active,
    subject: artist,
    identity: atom((get) =>
      get(sourcePrefs.source) === 'apple' ? get(wiring.appleIdentity.state) : get(identity.state),
    ),
    input,
    ready,
    images: [{ source: photoSource, state: onlinePhoto.state }],
  });
  const photos = startBiographyPhotos(store, {
    artist: atom((get) => get(input)?.artist ?? null),
    active,
    albums: albumsAtom,
    probe: probeCover,
    same: sameBiographyPhotoPixels,
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
    sourcePrefs,
    lastfmKey,
    identity,
    appleIdentity: wiring.appleIdentity,
    service: text,
    input,
    /** 当前曲目里能查简介的艺人，多于一位时界面给切换 */
    artists: atom((get) => get(candidates).names),
    /** 正在看简介的那一位 */
    artist,
    select(name: string): void {
      if (store.get(candidates).names.includes(name)) store.set(picked, name);
    },
    searching,
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
    /** 「动态艺术照」开关：艺人页头部有 Apple 的动态艺术照时是否播放 */
    motionEnabled: ARTIST_MOTION_PREF.atom,
    setMotion(on: boolean): void {
      ARTIST_MOTION_PREF.set(store, on);
    },
    refresh() {
      text.refresh();
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
      settingsNav.open('online');
    },
    settingsFocused() {
      store.set(settingsRequested, false);
    },
    dispose() {
      document.removeEventListener('visibilitychange', updateVisibility);
      stops.forEach((stop) => stop());
      text.dispose();
      service.dispose();
      wiring.dispose();
      photos.dispose();
      onlinePhoto.dispose();
      local.dispose();
      artistImages.dispose();
      prefs.dispose();
      sourcePrefs.dispose();
      lastfmKey.dispose();
      resources.dispose();
      links.dispose();
    },
  };
}

export type BiographyIntegration = ReturnType<typeof startBiographyIntegration>;
