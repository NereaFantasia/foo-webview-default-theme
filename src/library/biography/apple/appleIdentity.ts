import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import {
  createJsonFileCache,
  EMPTY_JSON_FILE_CACHE,
  type JsonFileCache,
  type JsonFileCacheHost,
  type JsonFileCacheState,
} from '../../../kit/jsonFileCache.ts';
import { BIOGRAPHY_CACHE_DIRECTORY } from '../biographyCacheFormat.ts';
import type { BiographyProblem } from '../biographyModel.ts';
import { biographyField } from '../details/biographyDetailsModel.ts';
import {
  IDENTITY_CACHE_BYTES,
  IDENTITY_CACHE_LIMIT,
  IDENTITY_OPEN_TTL,
  IDENTITY_RESOLVED_TTL,
} from '../identity/identityRecord.ts';
import type { AppleArtistHit } from './appleCatalog.ts';
import type { AppleClient, AppleFailure, AppleLanguage } from './appleClient.ts';
import {
  APPLE_IDENTITY_CACHE_FILE,
  appleIdentityStateOf,
  appleManualStateOf,
  IDLE_APPLE_IDENTITY,
  readAppleIdentityRecord,
  type AppleIdentityRecord,
  type AppleIdentityState,
  type AppleManualIdentity,
} from './appleIdentityRecord.ts';
import {
  appleArtistIdFromLink,
  resolveAppleIdentity,
  resolveAppleLink,
  searchAppleArtists,
} from './appleIdentityResolver.ts';
import { demoteAppleCandidate, type AppleCandidate, type LocalAlbum } from './appleMatch.ts';

/**
 * 换了艺人之后至少停这么久才去认定，右侧卡跟着播放走，连续切歌不能每首都发请求。从艺人变化的那一刻
 * 起算，媒体库、专辑名单读完这类同一位艺人的后续变化不重新起算
 */
const DEBOUNCE_MS = 300;

export interface AppleIdentityDeps {
  /** 身份的键：缓存、手选与状态都按它存取；本地艺人是艺人名 */
  readonly artist: Atom<string | null>;
  /** 搜索用的艺人名，缺省取 `artist` */
  readonly term?: Atom<string | null>;
  /** 本地专辑艺人归属他的专辑；媒体库还没读完时为 null，等读完再认定 */
  readonly albums: Atom<readonly LocalAlbum[] | null>;
  readonly manual: Atom<AppleManualIdentity | null>;
  readonly enabled: Atom<boolean>;
  readonly active: Atom<boolean>;
  /**
   * 搜索回来、名字一致的只有一位时调用，趁 Lookup 与专辑比对还在进行，提前去取他的艺人页；
   * `alive` 为 false 时调用方已放弃。缺省不提前取
   */
  readonly prefetch?: (hit: AppleArtistHit, alive: () => boolean) => void;
  /**
   * 界面用的语言；英文时搜索请求要英文的曲风名。缺省按 cn 区的中文。身份记录按艺人存、不分语言，
   * 记录里已有的候选曲风名保持写入时的语言，到期重新认定后才换
   */
  readonly language?: Atom<AppleLanguage>;
  /** 由装配持有的共用资源；没有时服务自己建缓存，释放时一并释放 */
  readonly resources?: {
    readonly appleIdentityCache: JsonFileCache<AppleIdentityRecord>;
    readonly appleIdentityCacheState: Atom<JsonFileCacheState>;
    readonly identityRevision: Atom<number>;
    clearIdentity(): Promise<boolean>;
  };
}

/** 粘贴链接确认的结果：成功时交出手选，失败时说明是链接不对、查无此人还是请求出了问题 */
export type AppleLinkResult =
  | { readonly ok: true; readonly identity: AppleManualIdentity }
  | { readonly ok: false; readonly reason: 'link' | 'missing' | BiographyProblem };

/** 搜索框的结果：成功时交出候选（可以是空的，即没有找到），失败时说明请求出了什么问题 */
export type AppleSearchResult =
  | { readonly ok: true; readonly candidates: readonly AppleCandidate[] }
  | { readonly ok: false; readonly reason: BiographyProblem };

/** 搜索关键词的长度上限，与艺人名一致 */
const SEARCH_TERM_LIMIT = 200;

/** 无 Apple 一路的资源时服务自建的缓存 */
export function createAppleIdentityCache(
  host: JsonFileCacheHost,
  changed: (state: JsonFileCacheState) => void,
): JsonFileCache<AppleIdentityRecord> {
  return createJsonFileCache<AppleIdentityRecord>(
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
    changed,
  );
}

/**
 * 认定本地艺人是 Apple 上的哪一位，给出取简介用的艺人 ID 与页面地址。用户手选的为准（包括
 * 「这些都不是」）；否则按 `resolveAppleIdentity` 自动认定。只在在线内容开着、简介正在显示时请求；
 * 结果按本地艺人名缓存，断网与解析失败不缓存，只在内存里记到 retryAt
 */
export function startAppleIdentity(
  store: ReturnType<typeof createStore>,
  deps: AppleIdentityDeps,
  client: Pick<AppleClient, 'search' | 'lookup'>,
  host: JsonFileCacheHost = fb,
) {
  const state = atom<AppleIdentityState>(IDLE_APPLE_IDENTITY);
  const ownCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const cacheState = deps.resources?.appleIdentityCacheState ?? ownCacheState;
  const cache =
    deps.resources?.appleIdentityCache ??
    createAppleIdentityCache(host, (value) => store.set(ownCacheState, value));
  let disposed = false;
  let generation = 0;
  let signature = '';
  // 艺人（连同搜索名、手选）最近一次变化的时刻，防抖从这里算起
  let subjectKey = '';
  let subjectSince = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let fresh = false;
  // 说过「不是这位」又还没有候选可列的那位：下次查时不自动认定
  let rejected: string | null = null;
  // 限流与拒绝访问对所有艺人生效；断网与解析失败只记在出错的那位上
  let blocked: AppleFailure | null = null;
  const failures = new Map<string, AppleFailure>();
  // 用户在搜索框里搜到的候选：只给 `pick` 认，不进认定缓存，也不改状态；换人后不再认
  let searched: { readonly artist: string; readonly candidates: readonly AppleCandidate[] } | null =
    null;

  function publish(next: AppleIdentityState): void {
    if (!disposed) store.set(state, next);
  }

  function fail(artist: string, failure: AppleFailure): void {
    if (failure.problem === 'rateLimited' || failure.problem === 'blocked') blocked = failure;
    failures.set(artist, failure);
    publish({ artist, status: 'failed', problem: failure.problem });
  }

  function candidatesOf(artist: string): readonly AppleCandidate[] {
    const current = store.get(state);
    if (current.artist === artist && current.status === 'ambiguous') return current.candidates;
    const known = cache.get(artist);
    return known && known.status !== 'none' ? known.candidates : [];
  }

  async function load(mine: number): Promise<void> {
    const artist = store.get(deps.artist);
    const alive = () => !disposed && mine === generation;
    const force = fresh;
    fresh = false;
    if (!artist || store.get(deps.manual)) return;
    const known = cache.get(artist);
    if (known && known.expiresAt > Date.now() && !force)
      return publish(appleIdentityStateOf(known));
    const albums = store.get(deps.albums);
    if (albums === null) return publish({ artist, status: 'resolving' });
    const failure = failures.get(artist);
    const now = Date.now();
    const blocking = blocked && blocked.retryAt > now ? blocked : null;
    const waiting = blocking ?? (failure && failure.retryAt > now ? failure : null);
    if (waiting && !force) return publish({ artist, status: 'failed', problem: waiting.problem });
    publish({ artist, status: 'resolving' });
    const term = (deps.term ? store.get(deps.term) : null) ?? artist;
    const outcome = await resolveAppleIdentity(
      client,
      term,
      albums,
      rejected !== artist,
      alive,
      deps.prefetch,
      deps.language ? store.get(deps.language) : undefined,
    );
    if (outcome.kind === 'cancelled' || !alive()) return;
    if (outcome.kind === 'failed') return fail(artist, outcome);
    failures.delete(artist);
    if (rejected === artist) rejected = null;
    // 认定器按搜索名写记录；缓存与状态按键存取，键不是名字时要改回来
    const entry = outcome.entry.artist === artist ? outcome.entry : { ...outcome.entry, artist };
    publish(appleIdentityStateOf(entry));
    await cache.save(artist, entry);
  }

  async function pump(): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      await cache.ready;
      // 一次只认定一位；连续换人时只留最新的输入
      while (pending && !disposed) {
        pending = false;
        await load(generation);
      }
    } finally {
      running = false;
    }
  }

  function schedule(refresh = false): void {
    if (disposed) return;
    const artist = store.get(deps.artist);
    const enabled = store.get(deps.enabled) && store.get(deps.active) && !!artist;
    const manual = store.get(deps.manual);
    const waiting = store.get(deps.albums) === null;
    const next = JSON.stringify([
      enabled,
      artist,
      manual,
      waiting,
      deps.term ? store.get(deps.term) : null,
    ]);
    if (next === signature && !refresh) return;
    signature = next;
    const subject = JSON.stringify([artist, manual, deps.term ? store.get(deps.term) : null]);
    if (subject !== subjectKey) {
      subjectKey = subject;
      subjectSince = Date.now();
    }
    generation += 1;
    clearTimeout(timer);
    pending = false;
    if (refresh) fresh = true;
    if (store.get(state).artist !== artist)
      publish(artist ? { artist, status: 'idle' } : IDLE_APPLE_IDENTITY);
    if (!enabled || !artist) return;
    // 手选的不用请求，也没有什么可刷新
    if (manual) {
      fresh = false;
      return publish(appleManualStateOf(manual));
    }
    const known = cache.get(artist);
    if (!refresh && known && known.expiresAt > Date.now()) {
      publish(appleIdentityStateOf(known));
      return;
    }
    timer = setTimeout(
      () => {
        pending = true;
        void pump();
      },
      refresh ? 0 : Math.max(0, DEBOUNCE_MS - (Date.now() - subjectSince)),
    );
  }

  const stops = [
    deps.artist,
    ...(deps.term ? [deps.term] : []),
    deps.albums,
    deps.manual,
    deps.enabled,
    deps.active,
  ].map((source) => store.sub(source, () => schedule()));
  function forgetCurrent(): void {
    generation += 1;
    clearTimeout(timer);
    pending = false;
    fresh = false;
    failures.clear();
    blocked = null;
    const artist = store.get(deps.artist);
    publish(artist ? { artist, status: 'idle' } : IDLE_APPLE_IDENTITY);
  }
  if (deps.resources) stops.push(store.sub(deps.resources.identityRevision, forgetCurrent));
  schedule();
  return {
    state,
    cacheState,
    ready: cache.ready,
    /**
     * 用户从候选里选了一位（认定留下的，或搜索框搜到的）：交给调用方存成手选，不需要再请求
     * （候选自带名字和页面地址）。认定记录也一并更新，手选日后被删时缓存里仍是这一位
     */
    pick(id: string): AppleManualIdentity | null {
      const artist = store.get(deps.artist);
      if (!artist || disposed) return null;
      const candidates = candidatesOf(artist);
      const chosen = [
        ...candidates,
        ...(searched?.artist === artist ? searched.candidates : []),
      ].find((item) => item.id === id);
      if (!chosen) return null;
      if (rejected === artist) rejected = null;
      const now = Date.now();
      void cache.save(artist, {
        artist,
        status: 'resolved',
        sourceId: chosen.id,
        sourceArtist: chosen.name,
        url: chosen.url,
        candidates,
        fetchedAt: now,
        expiresAt: now + IDENTITY_RESOLVED_TTL,
      });
      return { artist, sourceId: chosen.id, sourceArtist: chosen.name, url: chosen.url };
    },
    /** 「这些都不是」：交给调用方存成手选，该本地艺人不显示简介也不再列候选 */
    decline(): AppleManualIdentity | null {
      const artist = store.get(deps.artist);
      return artist && !disposed ? { artist, declined: true } : null;
    },
    /**
     * 「不是这位」：不再自动认定这位本地艺人，改列同名候选，被否定的那位沉到最后。手选的由调用方
     * 另外删掉。认定时留下的候选直接列出来；没有就重新搜，这次不比对专辑
     */
    reject(): void {
      const artist = store.get(deps.artist);
      if (!artist || disposed) return;
      const current = store.get(state);
      const candidates =
        current.artist === artist && current.status === 'resolved'
          ? demoteAppleCandidate(candidatesOf(artist), current.sourceId)
          : candidatesOf(artist);
      if (!candidates.length) {
        rejected = artist;
        schedule(true);
        return;
      }
      generation += 1;
      clearTimeout(timer);
      const now = Date.now();
      const entry: AppleIdentityRecord = {
        artist,
        status: 'ambiguous',
        candidates,
        rejected: true,
        fetchedAt: now,
        expiresAt: now + IDENTITY_OPEN_TTL,
      };
      publish(appleIdentityStateOf(entry));
      void cache.save(artist, entry);
    },
    /**
     * 搜索框里按 Enter：用关键词搜 Apple 上的艺人，不比对本地专辑。限流与拒绝访问对所有艺人生效，
     * 所以也记进 `blocked`；搜到的候选留着给 `pick`，不改身份状态，选中前简介块照旧
     */
    async search(term: string): Promise<AppleSearchResult> {
      const artist = store.get(deps.artist);
      const keyword = term.trim();
      if (!artist || disposed) return { ok: false, reason: 'network' };
      if (!biographyField(keyword, SEARCH_TERM_LIMIT)) return { ok: true, candidates: [] };
      const mine = generation;
      const outcome = await searchAppleArtists(
        client,
        keyword,
        () => !disposed && mine === generation,
        deps.language ? store.get(deps.language) : undefined,
      );
      if (outcome.kind === 'cancelled') return { ok: false, reason: 'network' };
      if (outcome.kind === 'failed') {
        if (outcome.problem === 'rateLimited' || outcome.problem === 'blocked') blocked = outcome;
        return { ok: false, reason: outcome.problem };
      }
      searched = { artist, candidates: outcome.candidates };
      return { ok: true, candidates: outcome.candidates };
    },
    /** 粘贴了 Apple 艺人链接：按链接里的 ID 查出名字和页面地址，交给调用方存成手选 */
    async resolveLink(link: string): Promise<AppleLinkResult> {
      const artist = store.get(deps.artist);
      const id = appleArtistIdFromLink(link);
      if (!artist || disposed || !id) return { ok: false, reason: 'link' };
      const mine = generation;
      const outcome = await resolveAppleLink(client, id, () => !disposed && mine === generation);
      if (outcome.kind === 'cancelled') return { ok: false, reason: 'network' };
      if (outcome.kind === 'failed') return { ok: false, reason: outcome.problem };
      if (outcome.kind === 'missing') return { ok: false, reason: 'missing' };
      const { sourceId, sourceArtist, url } = outcome;
      return { ok: true, identity: { artist, sourceId, sourceArtist, url } };
    },
    refresh(): void {
      const artist = store.get(deps.artist);
      if (artist) failures.delete(artist);
      blocked = null;
      schedule(true);
    },
    clearCache(): Promise<boolean> {
      forgetCurrent();
      return deps.resources?.clearIdentity() ?? cache.clear();
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      if (!deps.resources) cache.dispose();
    },
  };
}

export type AppleIdentityService = ReturnType<typeof startAppleIdentity>;
