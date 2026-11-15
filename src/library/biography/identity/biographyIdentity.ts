import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { BIOGRAPHY_CACHE_DIRECTORY } from '../biographyCacheFormat.ts';
import type { BiographyIdentity } from '../biographyModel.ts';
import {
  createJsonFileCache,
  EMPTY_JSON_FILE_CACHE,
  type JsonFileCacheHost,
} from '../../../kit/jsonFileCache.ts';
import {
  IDENTITY_CACHE_BYTES,
  IDENTITY_CACHE_FILE,
  IDENTITY_CACHE_LIMIT,
  IDENTITY_OPEN_TTL,
  IDENTITY_RESOLVED_TTL,
  identityStateOf,
  IDLE_IDENTITY,
  readIdentityRecord,
  type BiographyIdentityState,
  type IdentityRecord,
} from './identityRecord.ts';
import {
  lookupArtist,
  resolveIdentity,
  sourceArtistOf,
  type MusicbrainzFailure,
} from './identityResolver.ts';
import type { MusicbrainzClient } from './musicbrainzApi.ts';
import type { MusicbrainzCandidate } from './musicbrainzArtist.ts';
import type { BiographyResources } from '../biographyResources.ts';

/**
 * 换了艺人之后至少停这么久才去认定，右侧卡跟着播放走，连续切歌不能每首都发请求。从艺人变化的那一刻
 * 起算，媒体库、专辑名单读完这类同一位艺人的后续变化不重新起算
 */
const DEBOUNCE_MS = 300;

export interface BiographyIdentityDeps {
  /** 身份的键：缓存、手选与状态都按它存取；本地艺人是艺人名 */
  readonly artist: Atom<string | null>;
  /** 搜索用的艺人名，缺省取 `artist` */
  readonly term?: Atom<string | null>;
  /** 本地专辑艺术家是他的那些专辑的标题；媒体库还没读完时为 null，等读完再认定 */
  readonly albums: Atom<readonly string[] | null>;
  readonly manual: Atom<BiographyIdentity | null>;
  readonly enabled: Atom<boolean>;
  readonly active: Atom<boolean>;
  /** 界面语言，挑别名时优先同一种语言的 */
  readonly locale: Atom<string>;
  readonly resources?: Pick<
    BiographyResources,
    'identityCache' | 'identityCacheState' | 'identityRevision' | 'clearIdentity'
  >;
}

/**
 * 认定本地艺人是 MusicBrainz 上的哪一位，给出取简介用的 Last.fm 名字与资料。用户手选的为准；
 * 否则按 `resolveIdentity` 自动认定。只在在线内容开着、简介正在显示时请求；结果按本地艺人名
 * 缓存，网络失败不缓存，只在内存里记到 retryAt
 */
export function startBiographyIdentity(
  store: ReturnType<typeof createStore>,
  deps: BiographyIdentityDeps,
  client: MusicbrainzClient,
  host: JsonFileCacheHost = fb,
) {
  const state = atom<BiographyIdentityState>(IDLE_IDENTITY);
  const ownCacheState = atom(EMPTY_JSON_FILE_CACHE);
  const cacheState = deps.resources?.identityCacheState ?? ownCacheState;
  const cache =
    deps.resources?.identityCache ??
    createJsonFileCache<IdentityRecord>(
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
      (value) => store.set(ownCacheState, value),
    );
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
  // 说过「不是这位」又还没查出候选的那位：下次查时不自动认定
  let rejected: string | null = null;
  // 限流与拒绝访问对所有艺人生效；断网与解析失败只记在出错的那位上
  let blocked: MusicbrainzFailure | null = null;
  const failures = new Map<string, MusicbrainzFailure>();

  function publish(next: BiographyIdentityState): void {
    if (!disposed) store.set(state, next);
  }

  function fail(artist: string, failure: MusicbrainzFailure): void {
    if (failure.problem === 'rateLimited' || failure.problem === 'blocked') blocked = failure;
    failures.set(artist, failure);
    publish({ artist, status: 'failed', problem: failure.problem });
  }

  function candidatesOf(entry: IdentityRecord | undefined): readonly MusicbrainzCandidate[] {
    return entry && entry.status !== 'none' ? entry.candidates : [];
  }

  async function confirmManual(
    artist: string,
    { sourceArtist, mbid }: BiographyIdentity,
    force: boolean,
    alive: () => boolean,
  ): Promise<void> {
    const known = cache.get(artist);
    const base = { artist, status: 'resolved', sourceArtist, manual: true } as const;
    if (!mbid) return publish({ ...base, mbid: null, facts: [] });
    if (known?.status === 'resolved' && known.mbid === mbid && !force)
      return publish({ ...base, mbid, facts: known.facts });
    // 资料取不到不影响身份：用户已经认定了这位
    publish({ ...base, mbid, facts: [] });
    const info = await lookupArtist(client, mbid, store.get(deps.locale), alive);
    if (!alive() || !info || 'kind' in info) return;
    publish({ ...base, mbid, facts: info.facts });
    const now = Date.now();
    const expiresAt = now + IDENTITY_RESOLVED_TTL;
    const candidates = candidatesOf(known);
    const entry = { ...base, mbid, facts: info.facts, candidates, fetchedAt: now, expiresAt };
    await cache.save(artist, entry);
  }

  async function load(mine: number): Promise<void> {
    const artist = store.get(deps.artist);
    const alive = () => !disposed && mine === generation;
    const force = fresh;
    fresh = false;
    if (!artist) return;
    const manual = store.get(deps.manual);
    if (manual) return confirmManual(artist, manual, force, alive);
    const known = cache.get(artist);
    if (known && known.expiresAt > Date.now() && !force) return publish(identityStateOf(known));
    const albums = store.get(deps.albums);
    if (albums === null) return publish({ artist, status: 'resolving' });
    const failure = failures.get(artist);
    const now = Date.now();
    const blocking = blocked && blocked.retryAt > now ? blocked : null;
    const waiting = blocking ?? (failure && failure.retryAt > now ? failure : null);
    if (waiting && !force) return publish({ artist, status: 'failed', problem: waiting.problem });
    publish({ artist, status: 'resolving' });
    const locale = store.get(deps.locale);
    const term = (deps.term ? store.get(deps.term) : null) ?? artist;
    const outcome = await resolveIdentity(client, term, albums, locale, rejected !== artist, alive);
    if (outcome.kind === 'cancelled' || !alive()) return;
    if (outcome.kind === 'failed') return fail(artist, outcome);
    failures.delete(artist);
    if (rejected === artist) rejected = null;
    // 认定器按搜索名写记录；缓存与状态按键存取，键不是名字时要改回来
    const entry = outcome.entry.artist === artist ? outcome.entry : { ...outcome.entry, artist };
    publish(identityStateOf(entry));
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
    const waiting = store.get(deps.albums) === null;
    const next = JSON.stringify([
      enabled,
      artist,
      store.get(deps.manual),
      waiting,
      deps.term ? store.get(deps.term) : null,
    ]);
    if (next === signature && !refresh) return;
    signature = next;
    const subject = JSON.stringify([
      artist,
      store.get(deps.manual),
      deps.term ? store.get(deps.term) : null,
    ]);
    if (subject !== subjectKey) {
      subjectKey = subject;
      subjectSince = Date.now();
    }
    generation += 1;
    clearTimeout(timer);
    pending = false;
    if (refresh) fresh = true;
    if (store.get(state).artist !== artist)
      publish(artist ? { artist, status: 'idle' } : IDLE_IDENTITY);
    if (!enabled) return;
    const manual = store.get(deps.manual);
    const known = artist ? cache.get(artist) : undefined;
    if (!refresh && known && known.expiresAt > Date.now() && !manual) {
      publish(identityStateOf(known));
      return;
    }
    if (
      !refresh &&
      manual &&
      (!manual.mbid || (known?.status === 'resolved' && known.mbid === manual.mbid))
    ) {
      publish({
        artist,
        status: 'resolved',
        sourceArtist: manual.sourceArtist,
        manual: true,
        mbid: manual.mbid ?? null,
        facts: known?.status === 'resolved' ? known.facts : [],
      });
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
    publish(artist ? { artist, status: 'idle' } : IDLE_IDENTITY);
  }
  if (deps.resources) stops.push(store.sub(deps.resources.identityRevision, forgetCurrent));
  schedule();
  return {
    state,
    cacheState,
    ready: cache.ready,
    /** 用户从候选里选了一位：查出他在 Last.fm 上的名字，交给调用方存成手选。失败答 null */
    async pick(mbid: string) {
      const artist = store.get(deps.artist);
      if (!artist || disposed) return null;
      const mine = generation;
      const alive = () => !disposed && mine === generation;
      const info = await lookupArtist(client, mbid, store.get(deps.locale), alive);
      const sourceArtist = info && !('kind' in info) ? sourceArtistOf(info) : null;
      if (!alive() || !info || 'kind' in info || !sourceArtist) return null;
      const now = Date.now();
      const expiresAt = now + IDENTITY_RESOLVED_TTL;
      const candidates = candidatesOf(cache.get(artist));
      const facts = info.facts;
      if (rejected === artist) rejected = null;
      const entry = { artist, status: 'resolved', mbid, sourceArtist, facts, candidates } as const;
      await cache.save(artist, { ...entry, fetchedAt: now, expiresAt });
      return alive() ? { sourceArtist, mbid } : null;
    },
    /**
     * 「不是这位」：不再自动认定这位本地艺人，改列同名候选。手选的由调用方另外删掉
     * 认定时留下的候选直接列出来；没有就重新搜，这次不比对专辑
     */
    reject(): void {
      const artist = store.get(deps.artist);
      if (!artist || disposed) return;
      const candidates = candidatesOf(cache.get(artist));
      if (!candidates.length) {
        rejected = artist;
        schedule(true);
        return;
      }
      generation += 1;
      clearTimeout(timer);
      const now = Date.now();
      const entry: IdentityRecord = {
        artist,
        status: 'ambiguous',
        candidates,
        fetchedAt: now,
        expiresAt: now + IDENTITY_OPEN_TTL,
      };
      publish(identityStateOf(entry));
      void cache.save(artist, entry);
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

export type BiographyIdentityService = ReturnType<typeof startBiographyIdentity>;
