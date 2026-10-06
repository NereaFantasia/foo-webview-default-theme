import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { BiographyProblem } from '../biography/biographyModel.ts';
import {
  fetchLastfmTops,
  type LastfmTopAlbum,
  type LastfmTops,
} from '../biography/lastfm-api/lastfmArtistTops.ts';
import type { ArtistDetailState } from './artistDetail.ts';
import {
  matchSimilar,
  matchTopTracks,
  missingTopAlbums,
  type SimilarMatch,
  type TopTrackMatch,
} from './artistTops.ts';

export interface ArtistOnlineDeps {
  /** 已认定身份的那位在 Last.fm 上的名字；没认定时为 null，不联网。 */
  readonly sourceArtist: Atom<string | null>;
  readonly apiKey: Atom<string>;
  /** 在线内容开着。 */
  readonly enabled: Atom<boolean>;
  readonly active: Atom<boolean>;
  /** 右半已取到的曲目与专辑，热门与它比对。 */
  readonly detail: Atom<ArtistDetailState>;
  /** 库里的艺人名，相似艺人与它比对。 */
  readonly libraryArtists: Atom<readonly string[]>;
}

/** 联网的这部分。noKey 是没填 key：热门只能经 API 取，这时只显示常听。 */
export type ArtistOnlineStatus = 'off' | 'noKey' | 'idle' | 'loading' | 'ready' | 'failed';

export interface ArtistOnlineState {
  readonly status: ArtistOnlineStatus;
  readonly problem: BiographyProblem | null;
  readonly tracks: readonly TopTrackMatch[];
  /** 热门专辑里库里没有的。 */
  readonly missingAlbums: readonly LastfmTopAlbum[];
  readonly similar: readonly SimilarMatch[];
}

const DEBOUNCE_MS = 300;
/** 内存里留几位的热门：在列表里来回看几位不重复请求。 */
const KEPT = 32;

interface Fetched {
  readonly artist: string | null;
  readonly status: ArtistOnlineStatus;
  readonly problem: BiographyProblem | null;
  readonly tops: LastfmTops | null;
}

const NONE: Fetched = { artist: null, status: 'off', problem: null, tops: null };

/**
 * 艺人页的在线补充：热门曲目、热门专辑与相似艺人。三样都经 Last.fm API 取（要 key），
 * 按有效期留在内存里；与右半已取到的本地曲目、专辑和库里的艺人名比对，标出能播的与库里有的。
 * 失败记到 retryAt，其间换回这位不再请求；主动刷新马上重试。
 */
export function startArtistOnline(
  store: ReturnType<typeof createStore>,
  deps: ArtistOnlineDeps,
  host: Pick<typeof fb, 'http'> = fb,
  fetch: typeof fetchLastfmTops = fetchLastfmTops,
) {
  const fetched = atom<Fetched>(NONE);
  const kept = new Map<string, LastfmTops>();
  const failures = new Map<
    string,
    { readonly problem: BiographyProblem; readonly retryAt: number }
  >();
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let signature = '';
  let previousKey = store.get(deps.apiKey);

  function keep(artist: string, tops: LastfmTops): void {
    kept.delete(artist);
    kept.set(artist, tops);
    while (kept.size > KEPT) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
  }

  async function load(artist: string, key: string, mine: number, force: boolean): Promise<void> {
    const cached = kept.get(artist);
    if (cached && cached.expiresAt > Date.now() && !force)
      return store.set(fetched, { artist, status: 'ready', problem: null, tops: cached });
    const failure = failures.get(artist);
    if (failure && failure.retryAt > Date.now() && !force)
      return store.set(fetched, {
        artist,
        status: 'failed',
        problem: failure.problem,
        tops: cached ?? null,
      });
    store.set(fetched, { artist, status: 'loading', problem: null, tops: cached ?? null });
    const result = await fetch(artist, key, host);
    if (disposed || mine !== generation) return;
    if (!result.ok) {
      failures.set(artist, { problem: result.problem, retryAt: result.retryAt });
      store.set(fetched, {
        artist,
        status: 'failed',
        problem: result.problem,
        tops: cached ?? null,
      });
      return;
    }
    failures.delete(artist);
    const { tracks, albums, similar, expiresAt } = result;
    const tops = { tracks, albums, similar, expiresAt };
    keep(artist, tops);
    store.set(fetched, { artist, status: 'ready', problem: null, tops });
  }

  function schedule(force = false): void {
    if (disposed) return;
    const artist = store.get(deps.sourceArtist);
    const key = store.get(deps.apiKey);
    if (key !== previousKey) {
      // 凭据错误属于旧 key；换 key 后立即允许重试。网络与服务端限流仍遵守原退避。
      for (const [name, failure] of failures)
        if (failure.problem === 'keyInvalid' || failure.problem === 'keySuspended')
          failures.delete(name);
      previousKey = key;
    }
    const enabled = store.get(deps.enabled);
    const active = store.get(deps.active);
    const next = JSON.stringify([artist, key, enabled, active]);
    if (next === signature && !force) return;
    signature = next;
    generation += 1;
    clearTimeout(timer);
    if (!enabled || !artist) return store.set(fetched, { ...NONE, artist });
    if (!key) return store.set(fetched, { ...NONE, artist, status: 'noKey' });
    if (store.get(fetched).artist !== artist)
      store.set(fetched, { artist, status: 'idle', problem: null, tops: null });
    if (!active) return;
    const mine = generation;
    if (force) failures.delete(artist);
    timer = setTimeout(() => void load(artist, key, mine, force), force ? 0 : DEBOUNCE_MS);
  }

  const stops = [deps.sourceArtist, deps.apiKey, deps.enabled, deps.active].map((source) =>
    store.sub(source, () => schedule()),
  );
  schedule();

  const state = atom<ArtistOnlineState>((get) => {
    const { status, problem, tops } = get(fetched);
    // `sourceArtist` 由装配按右半当前这位给出；右半换人时先清空，比对随之为空。
    const detail = get(deps.detail).detail;
    const groups = detail ? [...detail.own, ...detail.guest] : [];
    return {
      status,
      problem,
      tracks: matchTopTracks(
        tops?.tracks ?? [],
        groups.flatMap((group) => group.tracks),
      ),
      missingAlbums: missingTopAlbums(
        tops?.albums ?? [],
        groups.map((group) => group.album.name),
      ),
      similar: matchSimilar(tops?.similar ?? [], get(deps.libraryArtists)),
    };
  });

  return {
    state,
    refresh(): void {
      schedule(true);
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
    },
  };
}

export type ArtistOnlineService = ReturnType<typeof startArtistOnline>;
