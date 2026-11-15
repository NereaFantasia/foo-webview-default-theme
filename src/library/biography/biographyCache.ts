import { fb } from 'foo-webview-sdk/bridge';
import {
  BIOGRAPHY_CACHE_BYTES,
  BIOGRAPHY_CACHE_DIRECTORY,
  BIOGRAPHY_CACHE_FILES,
  BIOGRAPHY_CACHE_LIMIT,
  readAppleCacheEntry,
  readBiographyCacheEntry,
} from './biographyCacheFormat.ts';
import {
  biographyKey,
  type BiographyCacheEntry,
  type BiographyLanguage,
  type BiographySource,
} from './biographyModel.ts';

import {
  createJsonFileCache,
  type JsonFileCacheHost,
  type JsonFileCacheState,
} from '../../kit/jsonFileCache.ts';

/** 一个来源的简介缓存；`id` 是来源里的身份，Last.fm 的艺人名、Apple 的艺人 ID */
export interface BiographyCache {
  readonly ready: Promise<void>;
  clear(): Promise<boolean>;
  get(id: string, language: BiographyLanguage): BiographyCacheEntry | undefined;
  save(
    id: string,
    language: BiographyLanguage,
    entry: BiographyCacheEntry | null,
  ): Promise<boolean>;
  dispose(): void;
}

export function createBiographyCache(
  host: JsonFileCacheHost = fb,
  now: () => number = Date.now,
  changed: (state: JsonFileCacheState) => void = () => {},
  source: BiographySource = 'lastfm',
): BiographyCache {
  const cache = createJsonFileCache(
    {
      directory: BIOGRAPHY_CACHE_DIRECTORY,
      file: BIOGRAPHY_CACHE_FILES[source],
      limit: BIOGRAPHY_CACHE_LIMIT,
      bytes: BIOGRAPHY_CACHE_BYTES,
      key: (entry) => biographyKey(entry.sourceId, entry.language),
      read: source === 'apple' ? readAppleCacheEntry : readBiographyCacheEntry,
    },
    host,
    now,
    changed,
  );
  return {
    ready: cache.ready,
    get: (id, language) => cache.get(biographyKey(id, language)),
    save: (id, language, entry) => cache.save(biographyKey(id, language), entry),
    clear: cache.clear,
    dispose: cache.dispose,
  };
}
