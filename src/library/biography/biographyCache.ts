import { fb } from 'foo-webview-sdk/bridge';
import {
  BIOGRAPHY_CACHE_BYTES,
  BIOGRAPHY_CACHE_DIRECTORY,
  BIOGRAPHY_CACHE_LIMIT,
  readBiographyCacheEntry,
} from './biographyCacheFormat.ts';
import {
  biographyKey,
  type BiographyCacheEntry,
  type BiographyLanguage,
} from './biographyModel.ts';

import {
  createJsonFileCache,
  type JsonFileCacheHost,
  type JsonFileCacheState,
} from '../../kit/jsonFileCache.ts';

export interface BiographyCache {
  readonly ready: Promise<void>;
  clear(): Promise<boolean>;
  get(artist: string, language: BiographyLanguage): BiographyCacheEntry | undefined;
  save(
    artist: string,
    language: BiographyLanguage,
    entry: BiographyCacheEntry | null,
  ): Promise<boolean>;
  dispose(): void;
}

export function createBiographyCache(
  host: JsonFileCacheHost = fb,
  now: () => number = Date.now,
  changed: (state: JsonFileCacheState) => void = () => {},
): BiographyCache {
  const cache = createJsonFileCache(
    {
      directory: BIOGRAPHY_CACHE_DIRECTORY,
      file: 'lastfm-v1.json',
      limit: BIOGRAPHY_CACHE_LIMIT,
      bytes: BIOGRAPHY_CACHE_BYTES,
      key: (entry) => biographyKey(entry.artist, entry.language),
      read: readBiographyCacheEntry,
    },
    host,
    now,
    changed,
  );
  return {
    ready: cache.ready,
    get: (artist, language) => cache.get(biographyKey(artist, language)),
    save: (artist, language, entry) => cache.save(biographyKey(artist, language), entry),
    clear: cache.clear,
    dispose: cache.dispose,
  };
}
