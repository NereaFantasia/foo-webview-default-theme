import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import { createAppleClient } from './apple/appleClient.ts';
import { fetchAppleBiography } from './apple/fetchAppleBiography.ts';
import { APPLE_IDENTITY_CACHE_FILE, readAppleIdentityRecord } from './apple/appleIdentityRecord.ts';
import { createBiographyCache } from './biographyCache.ts';
import { BIOGRAPHY_CACHE_DIRECTORY } from './biographyCacheFormat.ts';
import {
  combineJsonFileCacheStates,
  createJsonFileCache,
  EMPTY_JSON_FILE_CACHE,
} from '../../kit/jsonFileCache.ts';
import {
  IDENTITY_CACHE_BYTES,
  IDENTITY_CACHE_FILE,
  IDENTITY_CACHE_LIMIT,
  readIdentityRecord,
} from './identity/identityRecord.ts';
import { createMusicbrainzClient } from './identity/musicbrainzApi.ts';
import { createBiographyRequestPool } from './biographyRequestPool.ts';
import type {
  BiographyFetchResult,
  BiographyFetchSubject,
  BiographyLanguage,
} from './biographyModel.ts';
import type { LastfmDetailsFetchResult } from './details/fetchLastfmDetails.ts';
import { createBiographyPhotoCache } from './biographyPhotoCache.ts';
import { createLastfmSource } from './lastfm-api/lastfmApiSource.ts';

/**
 * 由装配持有，所有简介消费者共用；消费者释放时不能释放这些资源。每个来源各有一份简介缓存
 * 与一份身份缓存，对界面给的合计（`cacheState`、`identityCacheState`）是两份加起来的
 */
export function startBiographyResources(
  store: ReturnType<typeof createStore>,
  host: Pick<typeof fb, 'file' | 'misc' | 'http'> = fb,
  apiKey: () => string = () => '',
) {
  const lastfmCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const appleCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const cacheState = atom((get) =>
    combineJsonFileCacheStates(get(lastfmCacheState), get(appleCacheState)),
  );
  const musicbrainzIdentityState = atom(EMPTY_JSON_FILE_CACHE);
  const appleIdentityCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const identityCacheState = atom((get) =>
    combineJsonFileCacheStates(get(musicbrainzIdentityState), get(appleIdentityCacheState)),
  );
  const textRevision = atom(0);
  const identityRevision = atom(0);
  const textRequests = createBiographyRequestPool<BiographyFetchResult>();
  const detailsRequests = createBiographyRequestPool<LastfmDetailsFetchResult>();
  const photos = createBiographyPhotoCache();
  const lastfm = createLastfmSource(apiKey, host);
  const apple = createAppleClient(host);
  const caches = {
    lastfm: createBiographyCache(host, Date.now, (value) => store.set(lastfmCacheState, value)),
    apple: createBiographyCache(
      host,
      Date.now,
      (value) => store.set(appleCacheState, value),
      'apple',
    ),
  };
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
    (value) => store.set(musicbrainzIdentityState, value),
  );
  const appleIdentityCache = createJsonFileCache(
    {
      directory: BIOGRAPHY_CACHE_DIRECTORY,
      file: APPLE_IDENTITY_CACHE_FILE,
      limit: IDENTITY_CACHE_LIMIT,
      bytes: IDENTITY_CACHE_BYTES,
      key: (entry) => entry.artist,
      read: readAppleIdentityRecord,
    },
    host,
    Date.now,
    (value) => store.set(appleIdentityCacheState, value),
  );
  return {
    caches,
    cacheState,
    identityCache,
    appleIdentityCache,
    /** 只是 Apple 一份的状态，Apple 身份服务发布自己的缓存状态时用 */
    appleIdentityCacheState,
    identityCacheState,
    textRevision,
    identityRevision,
    textRequests,
    detailsRequests,
    photos,
    lastfm,
    musicbrainz: createMusicbrainzClient(host),
    apple,
    /** 简介服务取正文的入口：按身份的来源交给对应的取数函数；`fallback` 见简介服务的 `fetchText` */
    fetchText(
      subject: BiographyFetchSubject,
      language: BiographyLanguage,
      fallback = false,
    ): Promise<BiographyFetchResult> {
      return subject.source === 'apple'
        ? fetchAppleBiography(apple, subject, language, fallback)
        : lastfm.fetchText(subject.id, language);
    },
    async clearText() {
      photos.clear();
      textRequests.clear();
      detailsRequests.clear();
      store.set(textRevision, (value) => value + 1);
      const results = await Promise.all([caches.lastfm.clear(), caches.apple.clear()]);
      return results.every(Boolean);
    },
    async clearIdentity() {
      store.set(identityRevision, (value) => value + 1);
      const results = await Promise.all([identityCache.clear(), appleIdentityCache.clear()]);
      return results.every(Boolean);
    },
    dispose() {
      photos.clear();
      textRequests.clear();
      detailsRequests.clear();
      store.set(textRevision, (value) => value + 1);
      store.set(identityRevision, (value) => value + 1);
      caches.lastfm.dispose();
      caches.apple.dispose();
      identityCache.dispose();
      appleIdentityCache.dispose();
    },
  };
}

export type BiographyResources = ReturnType<typeof startBiographyResources>;
