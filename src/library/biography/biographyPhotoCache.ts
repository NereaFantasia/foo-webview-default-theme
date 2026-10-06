import type { AlbumsState } from '../albums.ts';
import type { BiographyPhotosState } from './biographyPhotos.ts';
import { createBiographyRequestPool } from './biographyRequestPool.ts';
import { fetchLastfmGallery, type LastfmGalleryResult } from './online/lastfmGallery.ts';
import { fetchLastfmPhoto, type LastfmPhotoResult } from './online/fetchLastfmPhoto.ts';
import type { LastfmPhoto } from './online/lastfmPhoto.ts';

interface CachedLocalPhotos {
  readonly library: AlbumsState;
  readonly state: BiographyPhotosState;
}
export type DecodedBiographyPhoto =
  | (Extract<LastfmPhotoResult, { ok: true }> & { readonly pixels: Uint8ClampedArray })
  | Extract<LastfmPhotoResult, { ok: false }>;

const PHOTO_CACHE_BYTES = 64 * 1024 * 1024;

/** 缓存二进制与采样像素；显示地址由各视图持有，淘汰缓存不会破坏另一视图的图片。 */
export function createBiographyPhotoCache() {
  const local = new Map<string, CachedLocalPhotos>();
  const localRequests = createBiographyRequestPool<BiographyPhotosState, object>();
  let localKeys = new WeakMap<AlbumsState, Map<string, object>>();
  const binaries = new Map<string, DecodedBiographyPhoto>();
  const galleries = new Map<string, LastfmGalleryResult>();
  const imageRequests = createBiographyRequestPool<DecodedBiographyPhoto>();
  const galleryRequests = createBiographyRequestPool<LastfmGalleryResult>();
  const imageFailures = new Map<string, Extract<LastfmPhotoResult, { ok: false }>>();
  const galleryFailures = new Map<string, Extract<LastfmGalleryResult, { ok: false }>>();
  let revision = 0;

  function trim() {
    let bytes = [...binaries.values()].reduce(
      (sum, entry) => sum + (entry.ok ? entry.blob.size : 0),
      0,
    );
    for (const [key, entry] of binaries) {
      if (bytes <= PHOTO_CACHE_BYTES && binaries.size <= 96) break;
      binaries.delete(key);
      if (entry.ok) bytes -= entry.blob.size;
    }
  }
  return {
    get revision() {
      return revision;
    },
    local,
    localRequests,
    localKey(artist: string, library: AlbumsState) {
      let artists = localKeys.get(library);
      if (!artists) {
        artists = new Map();
        localKeys.set(library, artists);
      }
      let key = artists.get(artist);
      if (!key) {
        key = {};
        artists.set(artist, key);
      }
      return key;
    },
    invalidateLocal(artist: string, library: AlbumsState) {
      local.delete(artist);
      localKeys.get(library)?.delete(artist);
    },
    peekGallery(artistUrl: string) {
      const entry = galleries.get(artistUrl);
      return entry?.ok && entry.expiresAt > Date.now() ? entry.photos : undefined;
    },
    peekImage(url: string) {
      const entry = binaries.get(url);
      return entry?.ok && entry.expiresAt > Date.now() ? entry : undefined;
    },
    gallery(artistUrl: string, fresh: boolean, fetch = fetchLastfmGallery) {
      const failure = galleryFailures.get(artistUrl);
      if (failure && failure.retryAt > Date.now() && !(fresh && failure.problem === 'network'))
        return Promise.resolve(failure);
      const known = galleries.get(artistUrl);
      if (
        known &&
        (known.ok
          ? !fresh && known.expiresAt > Date.now()
          : known.retryAt > Date.now() && !(fresh && known.problem === 'network'))
      )
        return Promise.resolve(known);
      return galleryRequests.run(artistUrl, async () => {
        const mine = revision;
        const result = await fetch(artistUrl);
        if (mine === revision && !result.ok) {
          galleryFailures.set(artistUrl, result);
          if (galleryFailures.size > 32) {
            const oldest = galleryFailures.keys().next().value;
            if (oldest !== undefined) galleryFailures.delete(oldest);
          }
        }
        if (mine === revision && result.ok) {
          galleryFailures.delete(artistUrl);
          galleries.delete(artistUrl);
          if (result.store) galleries.set(artistUrl, result);
          if (galleries.size > 32) {
            const oldest = galleries.keys().next().value;
            if (oldest !== undefined) galleries.delete(oldest);
          }
        }
        return result;
      });
    },
    image(
      source: LastfmPhoto,
      fresh: boolean,
      probe: (url: string) => Promise<Uint8ClampedArray | null>,
      fetch = fetchLastfmPhoto,
      alive = () => true,
    ) {
      const failure = imageFailures.get(source.url);
      if (failure && failure.retryAt > Date.now() && !(fresh && failure.problem === 'network'))
        return Promise.resolve(failure);
      const known = binaries.get(source.url);
      if (
        known &&
        (known.ok
          ? !fresh && known.expiresAt > Date.now()
          : known.retryAt > Date.now() && !(fresh && known.problem === 'network'))
      ) {
        binaries.delete(source.url);
        binaries.set(source.url, known);
        return Promise.resolve(known);
      }
      return imageRequests.run(source.url, async () => {
        const mine = revision;
        const result = await fetch(source);
        if (!result.ok) {
          if (mine === revision) {
            imageFailures.set(source.url, result);
            if (imageFailures.size > 96) {
              const oldest = imageFailures.keys().next().value;
              if (oldest !== undefined) imageFailures.delete(oldest);
            }
          }
          return result;
        }
        if (mine !== revision || !alive()) return { ok: false, problem: 'network', retryAt: 0 };
        const url = URL.createObjectURL(result.blob);
        const pixels = await probe(url).catch(() => null);
        URL.revokeObjectURL(url);
        const decoded: DecodedBiographyPhoto = pixels?.length
          ? { ...result, pixels }
          : { ok: false, problem: 'invalid', retryAt: Date.now() + 300_000 };
        if (mine === revision) {
          imageFailures.delete(source.url);
          binaries.delete(source.url);
          if (!decoded.ok) imageFailures.set(source.url, decoded);
          else if (decoded.store) binaries.set(source.url, decoded);
          trim();
        }
        return decoded;
      });
    },
    clear() {
      revision += 1;
      local.clear();
      localKeys = new WeakMap();
      localRequests.clear();
      binaries.clear();
      galleries.clear();
      imageFailures.clear();
      galleryFailures.clear();
      imageRequests.clear();
      galleryRequests.clear();
    },
  };
}
export type BiographyPhotoCache = ReturnType<typeof createBiographyPhotoCache>;
