import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import { createBiographyCache, type BiographyCache } from './biographyCache.ts';
import {
  EMPTY_JSON_FILE_CACHE,
  type JsonFileCacheHost,
  type JsonFileCacheState,
} from '../../kit/jsonFileCache.ts';
import {
  biographyArtist,
  biographyKey,
  type BiographyInput,
  type BiographyLanguage,
  type BiographyState,
  type BiographyCacheEntry,
} from './biographyModel.ts';
import { fetchLastfmBiography, type LastfmFetchResult } from './fetchLastfmBiography.ts';
import { readLastfmBiography } from './lastfmBiography.ts';
import { createBiographyBackoff } from './biographyBackoff.ts';
import { fetchLastfmDetails } from './details/fetchLastfmDetails.ts';
import type { BiographyResources } from './biographyResources.ts';

export interface BiographyDeps {
  readonly enabled: Atom<boolean>;
  readonly active: Atom<boolean>;
  readonly input: Atom<BiographyInput | null>;
  /** 取正文的来源；缺省走网页采集。 */
  readonly fetchText?: (artist: string, language: BiographyLanguage) => Promise<LastfmFetchResult>;
  readonly sourceKey?: Atom<string>;
  readonly resources?: Pick<
    BiographyResources,
    'cache' | 'cacheState' | 'textRevision' | 'clearText' | 'textRequests' | 'detailsRequests'
  >;
}

export interface BiographyHost extends HostReadyFace, JsonFileCacheHost {
  readonly http: typeof fb.http;
}

export interface BiographyService {
  readonly state: Atom<BiographyState>;
  readonly ready: Promise<void>;
  readonly cacheState: Atom<JsonFileCacheState>;
  clearCache(): Promise<boolean>;
  refresh(): void;
  dispose(): void;
}

const EMPTY: BiographyState = {
  status: 'idle',
  document: null,
  refreshing: false,
  stale: false,
  problem: null,
  cacheFailed: false,
};
export const BIOGRAPHY_DEBOUNCE_MS = 300;

export function startBiography(
  store: ReturnType<typeof createStore>,
  deps: BiographyDeps,
  host: BiographyHost = fb,
  parse: typeof readLastfmBiography = readLastfmBiography,
  fetchDetails: typeof fetchLastfmDetails = fetchLastfmDetails,
): BiographyService {
  const state = atom<BiographyState>(EMPTY);
  const ownCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const cacheState = deps.resources?.cacheState ?? ownCacheState;
  let disposed = false;
  let generation = 0;
  let cacheGeneration = 0;
  let signature = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cache: BiographyCache | null = deps.resources?.cache ?? null;
  let connected = false;
  let connectionSettled = false;
  let pending = false;
  let running = false;
  let force = false;
  const backoff = createBiographyBackoff();
  let waiter = waitForHost(host);
  let clearedInput: string | null = null;
  let clearing = false;

  async function enrich(
    entry: BiographyCacheEntry,
    current: () => boolean,
    fresh: boolean,
    persist = true,
  ): Promise<void> {
    if (!cache || !current()) return;
    const key = `details:${biographyKey(entry.artist, entry.language)}`;
    const blocked = backoff.blocking(key);
    const { details: previous, ...body } = entry;
    const valid = previous && previous.expiresAt > Date.now() && !fresh;
    store.set(state, {
      ...store.get(state),
      details: previous ?? null,
      detailsLoading: !valid,
      detailsProblem: null,
    });
    if (valid) return;
    const fetch = () => fetchDetails(entry.artist, entry.language, host);
    const result =
      blocked ??
      (await (deps.resources?.detailsRequests.run(
        JSON.stringify([
          deps.sourceKey ? store.get(deps.sourceKey) : '',
          entry.artist,
          entry.language,
        ]),
        fetch,
      ) ?? fetch()));
    if (!result.ok) {
      if (current())
        store.set(state, {
          ...store.get(state),
          detailsLoading: false,
          detailsProblem: result.problem,
        });
      // 旧目标的失败不改当前显示，但限流仍约束后续请求。
      backoff.record(result, key);
      return;
    }
    if (!current()) return;
    store.set(state, {
      ...store.get(state),
      details: result.details,
      detailsLoading: false,
      detailsProblem: null,
    });
    if (persist) {
      const saved = await cache.save(entry.artist, entry.language, {
        ...body,
        ...(result.store ? { details: result.details } : {}),
      });
      if (current())
        store.set(state, {
          ...store.get(state),
          cacheFailed: store.get(state).cacheFailed || !saved,
        });
    }
  }

  function selected(): BiographyInput | null {
    const input = store.get(deps.input);
    return store.get(deps.enabled) &&
      store.get(deps.active) &&
      input &&
      biographyArtist(input.artist) &&
      input.sourceArtist &&
      biographyArtist(input.sourceArtist)
      ? input
      : null;
  }

  async function load(
    input: BiographyInput,
    mine: number,
    fresh: boolean,
    language: BiographyLanguage = input.language,
  ): Promise<void> {
    const artist = input.sourceArtist;
    if (!artist || !cache) return;
    const cacheVersion = cacheGeneration;
    const sourceKey = deps.sourceKey ? store.get(deps.sourceKey) : '';
    const current = () => !disposed && generation === mine && !!selected();
    const cached = cache.get(artist, language);
    if (cached && !fresh && cached.expiresAt > Date.now()) {
      // 空结果只说明这一种语言没有正文，不能阻断其他语言的读取。
      if (!cached.document && language !== 'en') return load(input, mine, fresh, 'en');
      store.set(state, {
        ...EMPTY,
        status: cached.document ? 'ready' : 'missing',
        document: cached.document,
      });
      await enrich(cached, current, fresh);
      return;
    }
    const old = cached?.document ?? store.get(state).document;
    store.set(state, {
      ...EMPTY,
      status: old ? 'ready' : 'loading',
      document: old,
      refreshing: true,
      stale: !!old,
      details: cached?.details ?? store.get(state).details,
    });
    const id = biographyKey(artist, language);
    const fetch = () =>
      deps.fetchText?.(artist, language) ?? fetchLastfmBiography(artist, language, host, parse);
    const result =
      backoff.blocking(id) ??
      (await (deps.resources?.textRequests.run(
        JSON.stringify([deps.sourceKey ? store.get(deps.sourceKey) : '', artist, language]),
        fetch,
      ) ?? fetch()));
    if (disposed) return;
    if (!result.ok) backoff.record(result, id);
    else if (result.entry.document) backoff.clear();
    if (!current()) {
      if (
        result.ok &&
        cacheVersion === cacheGeneration &&
        store.get(deps.enabled) &&
        JSON.stringify(store.get(deps.input)) === JSON.stringify(input) &&
        sourceKey === (deps.sourceKey ? store.get(deps.sourceKey) : '')
      )
        await cache.save(artist, language, result.store ? result.entry : null);
      return;
    }
    if (!result.ok) {
      store.set(state, {
        ...EMPTY,
        status: old ? 'ready' : 'error',
        document: old,
        stale: !!old,
        problem: result.problem,
        details: cached?.details ?? store.get(state).details,
      });
      return;
    }
    const fallback = !result.entry.document && language !== 'en';
    if (!fallback) {
      store.set(state, {
        ...EMPTY,
        status: result.entry.document ? 'ready' : 'missing',
        document: result.entry.document,
        details: cached?.details,
      });
    }
    const entry = { ...result.entry, ...(cached?.details ? { details: cached.details } : {}) };
    const saved = await cache.save(artist, language, result.store ? entry : null);
    if (!current()) return;
    if (fallback) await load(input, mine, fresh, 'en');
    else await enrich(entry, current, fresh, result.store);
    if (current())
      store.set(state, {
        ...store.get(state),
        cacheFailed: store.get(state).cacheFailed || !saved,
      });
  }

  async function pump(): Promise<void> {
    if (running || !connected || disposed || clearing) return;
    running = true;
    try {
      // 一个请求在途时只保留最新输入，连续切换不会堆积整列联网任务。
      while (pending && !disposed) {
        pending = false;
        const input = selected();
        const fresh = force;
        force = false;
        if (input) await load(input, generation, fresh);
      }
    } finally {
      running = false;
    }
  }

  function schedule(refresh = false): void {
    if (disposed) return;
    const input = store.get(deps.input);
    const key = JSON.stringify([
      store.get(deps.enabled),
      store.get(deps.active),
      input,
      deps.sourceKey ? store.get(deps.sourceKey) : '',
    ]);
    if (key === signature && !refresh) return;
    signature = key;
    generation += 1;
    clearTimeout(timer);
    pending = false;
    const document = store.get(state).document;
    const same =
      !!input?.sourceArtist &&
      document &&
      input.sourceArtist === document.artist &&
      (document.language === input.language || document.language === 'en');
    if (!store.get(deps.enabled)) {
      cacheGeneration += 1;
      store.set(state, { ...EMPTY, status: 'disabled' });
    } else if (!store.get(deps.active) || !input || !biographyArtist(input.artist))
      store.set(state, EMPTY);
    else if (!selected()) store.set(state, { ...EMPTY, status: 'unconfirmed' });
    else if (clearing || clearedInput === JSON.stringify(input))
      store.set(state, { ...EMPTY, status: 'cleared' });
    else {
      const primary = input?.sourceArtist
        ? cache?.get(input.sourceArtist, input.language)
        : undefined;
      const cached =
        primary && !primary.document && input?.language !== 'en'
          ? cache?.get(primary.artist, 'en')
          : primary;
      if (cached)
        store.set(state, {
          ...EMPTY,
          status: cached.document ? 'ready' : 'missing',
          document: cached.document,
          details: cached.details,
          stale: cached.expiresAt <= Date.now(),
        });
      else if (!same) store.set(state, { ...EMPTY, status: 'loading' });
      force = refresh;
      timer = setTimeout(
        () => {
          pending = true;
          if (!connected && connectionSettled)
            store.set(state, { ...EMPTY, status: 'error', problem: 'network' });
          void pump();
        },
        refresh || cached ? 0 : BIOGRAPHY_DEBOUNCE_MS,
      );
    }
  }

  async function connect(): Promise<void> {
    const waiting = waiter;
    const arrived = await waiting.done;
    waiting.cancel();
    if (disposed) return;
    if (!arrived) {
      connectionSettled = true;
      if (!deps.resources)
        store.set(ownCacheState, { ...EMPTY_JSON_FILE_CACHE, loaded: true, failed: true });
      if (selected()) store.set(state, { ...EMPTY, status: 'error', problem: 'network' });
      return;
    }
    cache ??= createBiographyCache(host, Date.now, (value) => store.set(ownCacheState, value));
    await cache.ready;
    if (disposed) return;
    connected = true;
    connectionSettled = true;
    void pump();
  }

  const stops = [deps.input, deps.enabled, deps.active].map((source) =>
    store.sub(source, () => schedule()),
  );
  if (deps.sourceKey) stops.push(store.sub(deps.sourceKey, () => schedule(true)));
  function forgetCurrent(): void {
    cacheGeneration += 1;
    clearedInput = JSON.stringify(store.get(deps.input));
    generation += 1;
    clearTimeout(timer);
    pending = false;
    force = false;
    backoff.clear();
    store.set(state, { ...EMPTY, status: store.get(deps.enabled) ? 'cleared' : 'disabled' });
  }
  if (deps.resources) stops.push(store.sub(deps.resources.textRevision, forgetCurrent));
  schedule();
  return {
    state,
    cacheState,
    ready: connect(),
    async clearCache() {
      if (disposed || clearing || !cache) return false;
      clearing = true;
      forgetCurrent();
      const ok = await (deps.resources?.clearText() ?? cache.clear());
      clearing = false;
      if (clearedInput !== JSON.stringify(store.get(deps.input))) {
        clearedInput = null;
        signature = '';
        schedule();
      }
      return ok;
    },
    refresh() {
      if (disposed || clearing || (running && store.get(state).status !== 'cleared')) return;
      clearedInput = null;
      backoff.release();
      if (!connected) {
        connectionSettled = false;
        waiter.cancel();
        waiter = waitForHost(host);
        void connect();
      }
      schedule(true);
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      waiter.cancel();
      if (!deps.resources) cache?.dispose();
    },
  };
}
