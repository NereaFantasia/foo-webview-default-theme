import { join } from 'node:path';
import {
  LYRICS_CACHE_ENTRY_LIMIT,
  LYRICS_CACHE_KEY,
  type LyricsCacheAction,
} from '../../src/server/lyricsCacheProtocol.ts';
import { openLyricsStore } from './lyricsStore.ts';

const MIN_LIMIT = 1024 * 1024;
const MAX_LIMIT = 1024 * 1024 * 1024;

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined;
}

function cacheKey(body: unknown): string {
  const key = field(body, 'key');
  if (typeof key !== 'string' || !LYRICS_CACHE_KEY.test(key)) throw new Error('缓存键无效');
  return key;
}

/** 歌词缓存的请求处理：状态目录里一个 SQLite 文件，请求体已由调用方限长并解析成 JSON */
export function startLyricsCache(state: string) {
  const store = openLyricsStore(join(state, 'lyrics-cache.v1.sqlite'));
  return {
    request(action: LyricsCacheAction, body: unknown): unknown {
      switch (action) {
        case 'get': {
          const row = store.get(cacheKey(body));
          return row ? { found: true, data: row.data } : { found: false };
        }
        case 'put': {
          const data = field(body, 'data');
          if (data !== null && (typeof data !== 'string' || data.length > LYRICS_CACHE_ENTRY_LIMIT))
            throw new Error('缓存内容无效');
          store.put(cacheKey(body), data);
          return { success: true };
        }
        case 'stats':
          return store.stats();
        case 'clear':
          store.clear();
          return { success: true };
        case 'limit': {
          const bytes = field(body, 'bytes');
          if (!Number.isSafeInteger(bytes) || typeof bytes !== 'number')
            throw new Error('上限无效');
          store.setLimit(Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, bytes)));
          return { success: true };
        }
      }
    },
    dispose(): void {
      store.close();
    },
  };
}
