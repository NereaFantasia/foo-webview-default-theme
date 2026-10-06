import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import { createBiographyCache } from './biographyCache.ts';
import { BIOGRAPHY_CACHE_DIRECTORY } from './biographyCacheFormat.ts';
import { createJsonFileCache, EMPTY_JSON_FILE_CACHE } from '../../kit/jsonFileCache.ts';
import {
  IDENTITY_CACHE_BYTES,
  IDENTITY_CACHE_FILE,
  IDENTITY_CACHE_LIMIT,
  readIdentityRecord,
} from './identity/identityRecord.ts';
import { createMusicbrainzClient } from './identity/musicbrainzApi.ts';
import { createBiographyRequestPool } from './biographyRequestPool.ts';
import type { LastfmFetchResult } from './fetchLastfmBiography.ts';
import type { LastfmDetailsFetchResult } from './details/fetchLastfmDetails.ts';
import { createBiographyPhotoCache } from './biographyPhotoCache.ts';
import { createLastfmSource } from './lastfm-api/lastfmApiSource.ts';

/** 由装配持有，所有简介消费者共用；消费者释放时不能释放这些资源。 */
export function startBiographyResources(
  store: ReturnType<typeof createStore>,
  host: Pick<typeof fb, 'file' | 'misc' | 'http'> = fb,
  apiKey: () => string = () => '',
) {
  const cacheState = atom(EMPTY_JSON_FILE_CACHE);
  const identityCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const textRevision = atom(0);
  const identityRevision = atom(0);
  const textRequests = createBiographyRequestPool<LastfmFetchResult>();
  const detailsRequests = createBiographyRequestPool<LastfmDetailsFetchResult>();
  const photos = createBiographyPhotoCache();
  const cache = createBiographyCache(host, Date.now, (value) => store.set(cacheState, value));
  const identityCache = createJsonFileCache(
    {
      directory: BIOGRAPHY_CACHE_DIRECTORY,
      file: IDENTITY_CACHE_FILE,
      limit: IDENTITY_CACHE_LIMIT,
      bytes: IDENTITY_CACHE_BYTES,
      key: (entry) => entry.artist,
      read: readIdentityRecord,
    },
    host,
    Date.now,
    (value) => store.set(identityCacheState, value),
  );
  return {
    cache,
    cacheState,
    identityCache,
    identityCacheState,
    textRevision,
    identityRevision,
    textRequests,
    detailsRequests,
    photos,
    lastfm: createLastfmSource(apiKey, host),
    musicbrainz: createMusicbrainzClient(host),
    clearText() {
      photos.clear();
      textRequests.clear();
      detailsRequests.clear();
      store.set(textRevision, (value) => value + 1);
      return cache.clear();
    },
    clearIdentity() {
      store.set(identityRevision, (value) => value + 1);
      return identityCache.clear();
    },
    dispose() {
      photos.clear();
      textRequests.clear();
      detailsRequests.clear();
      store.set(textRevision, (value) => value + 1);
      store.set(identityRevision, (value) => value + 1);
      cache.dispose();
      identityCache.dispose();
    },
  };
}

export type BiographyResources = ReturnType<typeof startBiographyResources>;
