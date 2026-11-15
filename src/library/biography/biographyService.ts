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
  isBiographyId,
  type BiographyCacheEntry,
  type BiographyFetchResult,
  type BiographyFetchSubject,
  type BiographyInput,
  type BiographyLanguage,
  type BiographySource,
  type BiographyState,
} from './biographyModel.ts';
import { fetchLastfmBiography } from './fetchLastfmBiography.ts';
import { readLastfmBiography } from './lastfmBiography.ts';
import { createBiographyBackoff } from './biographyBackoff.ts';
import { fetchLastfmDetails } from './details/fetchLastfmDetails.ts';
import type { BiographyResources } from './biographyResources.ts';

export interface BiographyDeps {
  readonly enabled: Atom<boolean>;
  readonly active: Atom<boolean>;
  readonly input: Atom<BiographyInput | null>;
  /**
   * 正文抓取实现；默认为 Last.fm 网页解析，其他数据源由装配层注入；`fallback` 为 true 表示界面语言无正文后回退拉取英文
   */
  readonly fetchText?: (
    subject: BiographyFetchSubject,
    language: BiographyLanguage,
    fallback: boolean,
  ) => Promise<BiographyFetchResult>;
  readonly sourceKey?: Atom<string>;
  /** 拉取 Last.fm 附加资料（标签、相似艺人、听众计数）；仅需正文时设为 false 以避免多余请求 */
  readonly details?: boolean;
  readonly resources?: Pick<
    BiographyResources,
    'caches' | 'cacheState' | 'textRevision' | 'clearText' | 'textRequests' | 'detailsRequests'
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
  /** 仅重试正文回退拉取；状态包含 `fallbackProblem` 时由面板重试触发 */
  retryFallback?(): void;
  dispose(): void;
}

const EMPTY: BiographyState = {
  status: 'idle',
  document: null,
  refreshing: false,
  stale: false,
  problem: null,
  problemDetail: null,
  cacheFailed: false,
};
/**
 * 切换艺人后的联网防抖等待时长，避免连续切歌频繁发起请求
 * 计时以艺人变更为起点，覆盖身份认定所需耗时，同艺人的后续派生变化无需重复等待
 */
export const BIOGRAPHY_DEBOUNCE_MS = 300;

/** 数据请求、退避重试与去重键名，包含数据源前缀以隔离不同数据源的标识命名空间 */
function scoped(source: BiographySource, id: string, language: BiographyLanguage): string {
  return `${source}:${biographyKey(id, language)}`;
}

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
  // 记录输入艺人变更时刻，作为防抖等待起算点
  let dwellArtist: string | null = null;
  let dwellSince = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 未注入共享资源时由服务按数据源自建缓存实例，等待宿主就绪后初始化
  const ownCaches: Partial<Record<BiographySource, BiographyCache>> = {};
  // 宿主就绪后建立缓存，缓存读取完成后标记连接就绪并开始处理请求与退避
  let hostArrived = false;
  let connected = false;
  let connectionSettled = false;
  let pending = false;
  let running = false;
  let force = false;
  const backoff = createBiographyBackoff();
  let waiter = waitForHost(host);
  let clearedInput: string | null = null;
  let clearing = false;

  function cacheFor(source: BiographySource): BiographyCache | undefined {
    const shared = deps.resources?.caches[source];
    if (shared) return shared;
    if (!hostArrived) return undefined;
    return (ownCaches[source] ??= createBiographyCache(
      host,
      Date.now,
      (value) => store.set(ownCacheState, value),
      source,
    ));
  }

  async function enrich(
    entry: BiographyCacheEntry,
    current: () => boolean,
    fresh: boolean,
    persist = true,
  ): Promise<void> {
    const cache = cacheFor(entry.source);
    if (!cache || !current()) return;
    const key = `details:${scoped(entry.source, entry.sourceId, entry.language)}`;
    const blocked = backoff.blocking(key);
    const { details: previous, ...body } = entry;
    const valid = previous && previous.expiresAt > Date.now() && !fresh;
    // 附加资料独立拉取仅适用于 Last.fm，其他数据源的附加资料随正文一同返回
    const separate = entry.source === 'lastfm' && deps.details !== false;
    store.set(state, {
      ...store.get(state),
      details: previous ?? null,
      detailsLoading: !valid && separate,
      detailsProblem: null,
      detailsProblemDetail: null,
    });
    if (valid || !separate) return;
    const fetch = () => fetchDetails(entry.sourceId, entry.language, host);
    const result =
      blocked ??
      (await (deps.resources?.detailsRequests.run(
        JSON.stringify([
          deps.sourceKey ? store.get(deps.sourceKey) : '',
          entry.sourceId,
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
          detailsProblemDetail: result.detail,
        });
      // 过期目标的失败不更新当前视图状态，但失败记录仍纳入后续限流退避
      backoff.record(result, key);
      return;
    }
    if (!current()) return;
    store.set(state, {
      ...store.get(state),
      details: result.details,
      detailsLoading: false,
      detailsProblem: null,
      detailsProblemDetail: null,
    });
    if (persist) {
      const saved = await cache.save(entry.sourceId, entry.language, {
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
      input.sourceId &&
      input.sourceArtist &&
      isBiographyId(input.source, input.sourceId)
      ? input
      : null;
  }

  /**
   * 回退拉取英文正文期间，先发布当前界面语言已解析的主图，避免头像与宽幅图等待英文响应
   * 曲风等元数据暂不提前发布，避免英文版本到达后发生文字闪烁替换
   */
  function publishPhoto(details: BiographyCacheEntry['details']): void {
    const photo = details?.photo;
    if (photo) store.set(state, { ...store.get(state), photo });
  }

  async function load(
    input: BiographyInput,
    mine: number,
    fresh: boolean,
    language: BiographyLanguage = input.language,
    fromFallback = false,
  ): Promise<void> {
    const { source, sourceId: id, sourceArtist: name } = input;
    const cache = cacheFor(source);
    if (!id || !name || !cache) return;
    await cache.ready;
    const cacheVersion = cacheGeneration;
    const sourceKey = deps.sourceKey ? store.get(deps.sourceKey) : '';
    const current = () => !disposed && generation === mine && !!selected();
    const cached = cache.get(id, language);
    if (cached && !fresh && cached.expiresAt > Date.now()) {
      // 特定语言正文为空不阻断其他语言的正文拉取
      if (!cached.document && language !== 'en') {
        publishPhoto(cached.details);
        return load(input, mine, fresh, 'en', true);
      }
      store.set(state, {
        ...EMPTY,
        status: cached.document ? 'ready' : 'missing',
        document: cached.document,
      });
      await enrich(cached, current, fresh);
      return;
    }
    const old = cached?.document ?? store.get(state).document;
    // 保留上一轮提前发布的主图至本次流程结束，成功后由新解析的图像替换
    const early = store.get(state).photo;
    store.set(state, {
      ...EMPTY,
      status: old ? 'ready' : 'loading',
      document: old,
      refreshing: true,
      stale: !!old,
      details: cached?.details ?? store.get(state).details,
      ...(early ? { photo: early } : {}),
    });
    const key = scoped(source, id, language);
    const subject: BiographyFetchSubject = {
      source,
      id,
      name,
      ...(input.sourceUrl ? { url: input.sourceUrl } : {}),
    };
    const fetch = () =>
      deps.fetchText?.(subject, language, fromFallback) ??
      fetchLastfmBiography(id, language, host, parse);
    const result =
      backoff.blocking(key) ??
      (await (deps.resources?.textRequests.run(
        JSON.stringify([
          deps.sourceKey ? store.get(deps.sourceKey) : '',
          source,
          id,
          language,
          fromFallback,
        ]),
        fetch,
      ) ?? fetch()));
    if (disposed) return;
    if (!result.ok) backoff.record(result, key);
    else if (result.entry.document) backoff.clear();
    if (!current()) {
      if (
        result.ok &&
        cacheVersion === cacheGeneration &&
        store.get(deps.enabled) &&
        JSON.stringify(store.get(deps.input)) === JSON.stringify(input) &&
        sourceKey === (deps.sourceKey ? store.get(deps.sourceKey) : '')
      )
        await cache.save(id, language, result.store ? result.entry : null);
      return;
    }
    if (!result.ok) {
      store.set(state, {
        ...EMPTY,
        status: old ? 'ready' : 'error',
        document: old,
        stale: !!old,
        problem: result.problem,
        problemDetail: result.detail,
        details: cached?.details ?? store.get(state).details,
        ...(early ? { photo: early } : {}),
      });
      return;
    }
    // 内嵌返回附加资料的数据源直接采用本次解析结果，否则沿用缓存并由 enrich 独立拉取
    const inline = result.entry.details;
    const details = inline ?? cached?.details;
    const fallback = !result.entry.document && language !== 'en';
    if (!fallback) {
      store.set(state, {
        ...EMPTY,
        status: result.entry.document ? 'ready' : 'missing',
        document: result.entry.document,
        details,
      });
    } else publishPhoto(inline);
    const entry = { ...result.entry, ...(details ? { details } : {}) };
    const saved = await cache.save(id, language, result.store ? entry : null);
    if (!current()) return;
    if (fallback) await load(input, mine, fresh, 'en', true);
    else await enrich(entry, current, fresh && !inline, result.store);
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
      // 请求进行期间仅保留最新输入参数，避免连续切换累积请求队列
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
    if ((input?.artist ?? null) !== dwellArtist) {
      dwellArtist = input?.artist ?? null;
      dwellSince = Date.now();
    }
    generation += 1;
    clearTimeout(timer);
    pending = false;
    const document = store.get(state).document;
    const same =
      !!input?.sourceId &&
      document &&
      input.source === document.source &&
      input.sourceId === document.sourceId &&
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
      const cache = input?.sourceId ? cacheFor(input.source) : undefined;
      const primary = input?.sourceId ? cache?.get(input.sourceId, input.language) : undefined;
      const cached =
        primary && !primary.document && input?.language !== 'en'
          ? cache?.get(primary.sourceId, 'en')
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
        refresh || cached ? 0 : Math.max(0, BIOGRAPHY_DEBOUNCE_MS - (Date.now() - dwellSince)),
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
    hostArrived = true;
    await Promise.all(
      (['lastfm', 'apple'] as const).map((source) =>
        // 无共享资源时按需初始化 Apple 缓存，启动阶段优先建立 Last.fm 缓存
        deps.resources || source === 'lastfm' ? cacheFor(source)?.ready : undefined,
      ),
    );
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
      if (disposed || clearing || (!deps.resources && !hostArrived)) return false;
      clearing = true;
      forgetCurrent();
      const ok = await (deps.resources?.clearText() ??
        Promise.all(Object.values(ownCaches).map((cache) => cache.clear())).then((results) =>
          results.every(Boolean),
        ));
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
        hostArrived = false;
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
      if (!deps.resources) Object.values(ownCaches).forEach((cache) => cache.dispose());
    },
  };
}
