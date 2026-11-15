import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { BackendConnection } from '../server/backendConnection.ts';
import {
  LYRICS_CACHE_ENTRY_LIMIT,
  LYRICS_CACHE_LIMITS_MB,
  readLyricsCacheGet,
  readLyricsCacheStats,
  type LyricsCacheLimitMb,
} from '../server/lyricsCacheProtocol.ts';
import {
  lyricsQueryDigest,
  readFoundLyrics,
  writeFoundLyrics,
  type CachedLyrics,
} from './lyricsCacheCodec.ts';
import type { LyricsPrefs } from './lyricsPrefs.ts';
import type { LyricsQuery } from './online/lyricsSource.ts';

export interface LyricsCachePref {
  /** 选用歌词时同时设为该曲目的默认；详情页的勾选框以它为初值 */
  readonly remember: boolean;
  /** 缓存自动取词的结果 */
  readonly enabled: boolean;
  readonly limitMb: LyricsCacheLimitMb;
}

const DEFAULT_PREF = { version: 1, remember: true, enabled: true, limitMb: 50 } as const;

function parsePref(raw: unknown) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  if (Reflect.get(raw, 'version') !== 1) return undefined;
  const remember: unknown = Reflect.get(raw, 'remember');
  const enabled: unknown = Reflect.get(raw, 'enabled');
  const limit: unknown = Reflect.get(raw, 'limitMb');
  return {
    version: 1,
    remember: typeof remember === 'boolean' ? remember : DEFAULT_PREF.remember,
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_PREF.enabled,
    limitMb: LYRICS_CACHE_LIMITS_MB.find((value) => value === limit) ?? DEFAULT_PREF.limitMb,
  };
}

const CACHE_PREF = defineConfigPref<{
  version: number;
  remember: boolean;
  enabled: boolean;
  limitMb: LyricsCacheLimitMb;
}>('defaultTheme.lyrics.cache', { ...DEFAULT_PREF }, parsePref);
export const LYRICS_CACHE_PREF_KEY = CACHE_PREF.key;

/** 占用的读取与清理状态，设置页的说明行据此显示 */
export type LyricsCacheUsage =
  | { readonly status: 'loading' | 'failed' | 'clearing' | 'clear-failed' }
  | { readonly status: 'ready'; readonly count: number; readonly bytes: number };

export interface LyricsCacheService {
  readonly pref: Atom<LyricsCachePref>;
  readonly persistence: ConfigPersistence;
  readonly ready: Promise<void>;
  /** 本地服务连着；没连着时缓存读写都当没有 */
  readonly available: Atom<boolean>;
  readonly usage: Atom<LyricsCacheUsage>;
  /** 没缓存、缓存关着、服务没连着、读失败与内容不合格都答 undefined */
  lookup(query: LyricsQuery, prefs: LyricsPrefs): Promise<CachedLyrics | undefined>;
  /** 写入不等结果，失败不影响取词 */
  store(query: LyricsQuery, prefs: LyricsPrefs, result: CachedLyrics): void;
  refreshUsage(): Promise<void>;
  clear(): Promise<boolean>;
  setRemember(remember: boolean): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  setLimit(limitMb: LyricsCacheLimitMb): Promise<boolean>;
  dispose(): void;
}

export const lyricsCacheKey = serviceKey<LyricsCacheService>('lyricsCache');

const REQUEST_TIMEOUT_MS = 5000;
const MIB = 1024 * 1024;

/**
 * 在线歌词的缓存，存在本地服务的 SQLite 里（重启后仍在）。偏好随 profile 记在宿主 config 的
 * `defaultTheme.lyrics.cache`；本地服务没连着时整个缓存静默失效，不影响取词
 */
export function startLyricsCache(
  store: Store,
  backend?: Pick<BackendConnection, 'request' | 'port'>,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
): LyricsCacheService {
  const prefs = startConfigPrefs(store, [CACHE_PREF], host, writer);
  const pref = atom<LyricsCachePref>((get) => {
    const { remember, enabled, limitMb } = get(CACHE_PREF.atom);
    return { remember, enabled, limitMb };
  });
  const available = backend ? atom((get) => get(backend.port) !== null) : atom(false);
  const usage = atom<LyricsCacheUsage>({ status: 'loading' });
  let disposed = false;
  let generation = 0;
  const send = (path: string, body: unknown): Promise<unknown> =>
    backend
      ? backend.request(path, body, { timeoutMs: REQUEST_TIMEOUT_MS })
      : Promise.reject(new Error('没有本地服务'));
  const active = () => !disposed && store.get(available) && store.get(pref).enabled;

  function pushLimit(): void {
    if (disposed || !store.get(available)) return;
    void send('/lyrics/limit', { bytes: store.get(pref).limitMb * MIB }).catch(() => {});
  }
  // 后端每次连上（含重启后换了进程）都要重新告诉它当前的上限
  const offs = backend ? [store.sub(backend.port, () => void prefs.ready.then(pushLimit))] : [];
  void prefs.ready.then(pushLimit);

  async function refreshUsage(): Promise<void> {
    if (disposed || !store.get(available)) return;
    const mine = ++generation;
    store.set(usage, { status: 'loading' });
    let next: LyricsCacheUsage = { status: 'failed' };
    try {
      const stats = readLyricsCacheStats(await send('/lyrics/stats', {}));
      if (stats) next = { status: 'ready', ...stats };
    } catch {
      // 读不到就如实显示读取失败
    }
    if (mine === generation && !disposed) store.set(usage, next);
  }

  const change = (patch: Partial<LyricsCachePref>) =>
    prefs.set(CACHE_PREF, { version: 1, ...store.get(pref), ...patch });

  return {
    pref,
    persistence: prefs,
    ready: prefs.ready,
    available,
    usage: atom((get) => get(usage)),
    async lookup(query, lyricsPrefs) {
      if (!active()) return undefined;
      try {
        const key = await lyricsQueryDigest(query, lyricsPrefs);
        const reply = readLyricsCacheGet(await send('/lyrics/get', { key }));
        if (!reply?.found) return undefined;
        return reply.data === null ? 'missing' : (readFoundLyrics(reply.data) ?? undefined);
      } catch {
        return undefined;
      }
    },
    store(query, lyricsPrefs, result) {
      if (!active()) return;
      void (async () => {
        try {
          const data = result === 'missing' ? null : writeFoundLyrics(result);
          if (data !== null && data.length > LYRICS_CACHE_ENTRY_LIMIT) return;
          await send('/lyrics/put', { key: await lyricsQueryDigest(query, lyricsPrefs), data });
        } catch {
          // 没写进去只是下次再联网
        }
      })();
    },
    refreshUsage,
    async clear() {
      if (disposed || !store.get(available)) return false;
      const mine = ++generation;
      store.set(usage, { status: 'clearing' });
      try {
        await send('/lyrics/clear', {});
      } catch {
        if (mine === generation && !disposed) store.set(usage, { status: 'clear-failed' });
        return false;
      }
      await refreshUsage();
      return true;
    },
    setRemember: (remember) => change({ remember }),
    setEnabled: (enabled) => change({ enabled }),
    async setLimit(limitMb) {
      const saved = await change({ limitMb });
      pushLimit();
      return saved;
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      prefs.dispose();
    },
  };
}
