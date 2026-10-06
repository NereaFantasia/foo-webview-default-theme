import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { LocalLyricsService, LocalLyricsState, LyricsTrack } from './lyricsLocal.ts';
import type { LyricsPrefs, LyricsPrefsService } from './lyricsPrefs.ts';
import type { LyricsHttpHost } from './online/lyricsHttp.ts';
import type { createLyricsOnline } from './online/lyricsOnline.ts';
import type { FoundLyrics } from './online/lyricsSearch.ts';
import type {
  LyricsCandidate,
  LyricsQuery,
  LyricsSource,
  LyricsSourceId,
} from './online/lyricsSource.ts';

export interface LyricsTarget extends LyricsTrack {
  /** 网络流的曲名可在相同路径下变化，查询元数据也参与过期保护。 */
  readonly query: LyricsQuery;
}

export type LyricsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly key: string; readonly stage: 'local' | 'online' }
  | { readonly status: 'waiting'; readonly key: string }
  | {
      readonly status: 'missing';
      readonly key: string;
      readonly reason: 'local' | 'online' | 'metadata';
    }
  | { readonly status: 'failed'; readonly key: string; readonly stage: 'local' | 'online' }
  | Extract<LocalLyricsState, { status: 'ready' }>
  | (FoundLyrics & { readonly status: 'ready'; readonly key: string });

export interface LyricsDeps {
  readonly host: LyricsHttpHost;
  readonly track: Atom<LyricsTarget | null>;
  readonly connected: Atom<boolean>;
  readonly active: Atom<boolean>;
  readonly local: Pick<LocalLyricsService, 'state' | 'refresh'>;
  readonly prefs: Pick<LyricsPrefsService, 'pref'>;
}

export interface LyricsService {
  readonly state: Atom<LyricsState>;
  readonly choices: Atom<LyricsChoiceState>;
  search(keywords: string): Promise<void>;
  choose(candidate: LyricsCandidate): Promise<boolean>;
  cancelSearch(): void;
  refresh(): void;
  dispose(): void;
}

export interface LyricsChoiceState {
  readonly status:
    'idle' | 'searching' | 'ready' | 'loading' | 'search-failed' | 'fetch-failed' | 'missing';
  readonly candidates: readonly LyricsCandidate[];
  readonly failed: readonly LyricsSourceId[];
}

const EMPTY_CHOICES: LyricsChoiceState = { status: 'idle', candidates: [], failed: [] };

export const lyricsKey = serviceKey<LyricsService>('lyrics');

/** 本地优先；只有可见且已启用联网时才加载在线模块、发起搜索。 */
export function startLyrics(store: Store, deps: LyricsDeps): LyricsService {
  const state = atom<LyricsState>({ status: 'idle' });
  let disposed = false;
  let search: ReturnType<typeof createLyricsOnline> | undefined;
  let request: AbortController | null = null;
  let input = '';
  let outcome: LyricsState | null = null;
  const choices = atom<LyricsChoiceState>(EMPTY_CHOICES);
  let sources: LyricsSource[] | undefined;
  let manualRequest: AbortController | null = null;
  let manualInput = '';
  let chosen: Extract<LyricsState, { status: 'ready' }> | null = null;

  function cancelSearch(): void {
    manualRequest?.abort();
    manualRequest = null;
    store.set(choices, EMPTY_CHOICES);
  }

  function cancel(): void {
    request?.abort();
    request = null;
  }

  async function load(
    target: LyricsTarget,
    query: LyricsQuery,
    prefs: LyricsPrefs,
    localFailed: boolean,
    controller: AbortController,
  ): Promise<void> {
    let result: FoundLyrics | 'missing' | 'failed' | null;
    try {
      const { createLyricsOnline, createLyricsSources } = await import('./online/lyricsOnline.ts');
      if (controller.signal.aborted) return;
      sources ??= createLyricsSources(deps.host);
      search ??= createLyricsOnline(deps.host, sources);
      result = await search(query, prefs, controller.signal);
    } catch {
      result = 'failed';
    }
    if (disposed || controller.signal.aborted || request !== controller) return;
    request = null;
    outcome =
      result && typeof result === 'object'
        ? { ...result, status: 'ready', key: target.key }
        : result === 'missing'
          ? localFailed
            ? { status: 'failed', key: target.key, stage: 'local' }
            : { status: 'missing', key: target.key, reason: 'online' }
          : { status: 'failed', key: target.key, stage: 'online' };
    store.set(state, outcome);
  }

  function follow(): void {
    if (disposed) return;
    const target = store.get(deps.track);
    const local = store.get(deps.local.state);
    const identity = target ? JSON.stringify([target.key, target.query]) : '';
    if (
      identity !== manualInput ||
      !store.get(deps.connected) ||
      !store.get(deps.prefs.pref).enabled
    ) {
      manualInput = identity;
      chosen = null;
      cancelSearch();
    } else if (!store.get(deps.active) && manualRequest) {
      cancelSearch();
    }
    if (!target || !store.get(deps.connected)) {
      cancel();
      input = '';
      outcome = null;
      store.set(state, { status: 'idle' });
      return;
    }
    if (chosen) {
      cancel();
      store.set(state, chosen);
      return;
    }
    if (local.status === 'idle' || local.key !== target.key || local.status === 'loading') {
      cancel();
      input = '';
      outcome = null;
      store.set(state, { status: 'loading', key: target.key, stage: 'local' });
      return;
    }
    if (local.status === 'ready') {
      cancel();
      input = '';
      outcome = null;
      store.set(state, local);
      return;
    }
    // 只交出查询字段，不把曲目路径或调用方附带的其他属性传进在线来源。
    const query: LyricsQuery = {
      title: target.query.title.trim(),
      artists: [...target.query.artists],
      album: target.query.album,
      albumArtists: [...target.query.albumArtists],
      durationMs: target.query.durationMs,
    };
    const prefs = store.get(deps.prefs.pref);
    const next = JSON.stringify([target.key, query, prefs]);
    if (next !== input) {
      cancel();
      input = next;
      outcome = null;
    }
    if (!prefs.enabled) {
      cancel();
      store.set(
        state,
        local.status === 'failed'
          ? { status: 'failed', key: target.key, stage: 'local' }
          : { status: 'missing', key: target.key, reason: 'local' },
      );
      return;
    }
    if (!query.title || !query.artists.some((artist) => artist.trim())) {
      store.set(
        state,
        local.status === 'failed'
          ? { status: 'failed', key: target.key, stage: 'local' }
          : { status: 'missing', key: target.key, reason: 'metadata' },
      );
      return;
    }
    if (outcome) {
      store.set(state, outcome);
      return;
    }
    if (!store.get(deps.active)) {
      cancel();
      store.set(state, { status: 'waiting', key: target.key });
      return;
    }
    if (request) return;
    request = new AbortController();
    store.set(state, { status: 'loading', key: target.key, stage: 'online' });
    void load(target, query, prefs, local.status === 'failed', request);
  }

  const offs = [
    store.sub(deps.track, follow),
    store.sub(deps.connected, follow),
    store.sub(deps.active, follow),
    store.sub(deps.local.state, follow),
    store.sub(deps.prefs.pref, follow),
  ];
  follow();

  return {
    state: atom((get) => get(state)),
    choices: atom((get) => get(choices)),
    cancelSearch,
    async search(keywords) {
      cancelSearch();
      const target = store.get(deps.track);
      const prefs = store.get(deps.prefs.pref);
      if (
        disposed ||
        !target ||
        !keywords.trim() ||
        !prefs.enabled ||
        !store.get(deps.connected) ||
        !store.get(deps.active)
      )
        return;
      const controller = new AbortController();
      manualRequest = controller;
      store.set(choices, { ...EMPTY_CHOICES, status: 'searching' });
      try {
        const [{ createLyricsSources }, { findLyricsCandidates }] = await Promise.all([
          import('./online/lyricsOnline.ts'),
          import('./online/lyricsCandidates.ts'),
        ]);
        if (controller.signal.aborted) return;
        sources ??= createLyricsSources(deps.host);
        const query: LyricsQuery = {
          keywords: keywords.trim(),
          title: target.query.title,
          artists: [...target.query.artists],
          album: target.query.album,
          albumArtists: [...target.query.albumArtists],
          durationMs: target.query.durationMs,
        };
        const selected = (prefs.sources ?? []).flatMap(
          (id) => sources?.filter((source) => source.id === id) ?? [],
        );
        const result = await findLyricsCandidates(query, selected, controller.signal);
        if (controller.signal.aborted) return;
        store.set(choices, { ...result, status: 'ready' });
      } catch {
        if (!controller.signal.aborted)
          store.set(choices, { ...EMPTY_CHOICES, status: 'search-failed' });
      } finally {
        if (manualRequest === controller) manualRequest = null;
      }
    },
    async choose(candidate) {
      const target = store.get(deps.track);
      const source = sources?.find((source) => source.id === candidate.source);
      if (
        disposed ||
        !target ||
        !source ||
        !store.get(deps.prefs.pref).enabled ||
        !store.get(deps.connected) ||
        !store.get(deps.active) ||
        !store.get(choices).candidates.includes(candidate)
      )
        return false;
      manualRequest?.abort();
      const controller = new AbortController();
      manualRequest = controller;
      store.set(choices, { ...store.get(choices), status: 'loading' });
      try {
        const { compareTrack } = await import('./online/lyricsMatch.ts');
        if (controller.signal.aborted) return false;
        const content = candidate.content ?? (await source.fetch(candidate, controller.signal));
        if (disposed || controller.signal.aborted) return false;
        if (content === 'missing' || content === 'failed') {
          store.set(choices, {
            ...store.get(choices),
            status: content === 'missing' ? 'missing' : 'fetch-failed',
          });
          return false;
        }
        chosen = {
          status: 'ready',
          key: target.key,
          source: candidate.source,
          content,
          candidate,
          match: compareTrack(target.query, candidate),
        };
        follow();
        cancelSearch();
        return true;
      } catch {
        if (!controller.signal.aborted)
          store.set(choices, { ...store.get(choices), status: 'fetch-failed' });
        return false;
      } finally {
        if (manualRequest === controller) manualRequest = null;
      }
    },
    refresh() {
      if (disposed) return;
      chosen = null;
      cancelSearch();
      cancel();
      input = '';
      outcome = null;
      deps.local.refresh();
      follow();
    },
    dispose() {
      disposed = true;
      cancelSearch();
      cancel();
      for (const off of offs) off();
    },
  };
}
