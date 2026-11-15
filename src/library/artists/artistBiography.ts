import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { AlbumsState } from '../albums.ts';
import { localAlbumsOf } from '../biography/biographyInput.ts';
import { startBiographyStack, type BiographyStackShared } from '../biography/biographyStack.ts';
import { startBiographyPhotos } from '../biography/biographyPhotos.ts';
import { cachedApplePhoto } from '../biography/online/onlinePhotoSource.ts';
import { startBiographyArtistImages } from '../biography/local/biographyArtistImages.ts';

export interface ArtistBiographyShared extends BiographyStackShared {
  readonly viewerTop: Atom<number>;
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
  const stack = startBiographyStack(store, {
    ...deps,
    albums: atom((get) => localAlbumsOf(get(deps.albums), get(deps.subject))),
  });
  const { service, onlinePhoto } = stack;
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
  /**
   * 墙上图块用的 Apple 艺术照，按本地艺人名查；只读缓存，不发请求。图要从 Apple 的图片服务器取，
   * 所以在线关闭、来源不是 Apple、来源偏好还没读回时一律没有。两份缓存读回或写入后重新算
   */
  const wallPhoto = atom((get) => {
    get(deps.resources.cacheState);
    get(deps.resources.appleIdentityCacheState);
    const manual = get(deps.sourcePrefs.identities);
    const allowed =
      get(deps.prefs.state).enabled &&
      get(deps.sourcePrefs.loaded) &&
      get(deps.sourcePrefs.source) === 'apple';
    return (artist: string) =>
      allowed
        ? cachedApplePhoto(
            artist,
            manual,
            deps.resources.appleIdentityCache,
            deps.resources.caches.apple,
          )
        : null;
  });
  const stop = store.sub(deps.resources.textRevision, () => photos.refresh());
  return {
    ...deps,
    ...stack,
    photos,
    artistImages,
    wallPhoto,
    refresh() {
      stack.refresh();
      photos.refresh();
      artistImages.refresh();
    },
    dispose() {
      stop();
      stack.dispose();
      photos.dispose();
      artistImages.dispose();
    },
  };
}
export type ArtistBiography = ReturnType<typeof startArtistBiography>;
