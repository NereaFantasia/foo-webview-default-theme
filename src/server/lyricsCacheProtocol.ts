/** 歌词缓存的请求动作；页面与后端共用，路径是 `/lyrics/<动作>` */
export const LYRICS_CACHE_ACTIONS = ['get', 'put', 'stats', 'clear', 'limit'] as const;
export type LyricsCacheAction = (typeof LYRICS_CACHE_ACTIONS)[number];

/** 缓存键由页面按查询与来源设置取 SHA-256，后端只把它当不透明的串 */
export const LYRICS_CACHE_KEY = /^[0-9a-f]{64}$/;
/** 单条缓存的上限，字符数；超出的不写 */
export const LYRICS_CACHE_ENTRY_LIMIT = 1_500_000;
/** 缓存总量上限的可选档，MiB */
export const LYRICS_CACHE_LIMITS_MB = [20, 50, 100, 200] as const;
export type LyricsCacheLimitMb = (typeof LYRICS_CACHE_LIMITS_MB)[number];

/** `data` 为 null 是来源明确没有这首的词 */
export type LyricsCacheGetReply =
  { readonly found: false } | { readonly found: true; readonly data: string | null };

export interface LyricsCacheStats {
  readonly count: number;
  readonly bytes: number;
}

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
}

export function readLyricsCacheGet(raw: unknown): LyricsCacheGetReply | null {
  const found = field(raw, 'found');
  if (found === false) return { found: false };
  const data = field(raw, 'data');
  return found === true && (typeof data === 'string' || data === null) ? { found, data } : null;
}

export function readLyricsCacheStats(raw: unknown): LyricsCacheStats | null {
  const count = field(raw, 'count');
  const bytes = field(raw, 'bytes');
  return Number.isSafeInteger(count) &&
    Number.isSafeInteger(bytes) &&
    typeof count === 'number' &&
    typeof bytes === 'number' &&
    count >= 0 &&
    bytes >= 0
    ? { count, bytes }
    : null;
}
