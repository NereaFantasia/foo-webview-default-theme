import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import type { LyricsPrefs } from './lyricsPrefs.ts';
import type { LyricsTarget } from './lyricsService.ts';
import type { LyricsContent } from './lyricsText.ts';
import type { LyricsHttpHost } from './online/lyricsHttp.ts';
import { startLyricsCandidateCovers, type LyricsCoverTarget } from './lyricsCandidateCovers.ts';
import type {
  LyricsCandidate,
  LyricsFetchResult,
  LyricsSource,
  LyricsSourceId,
} from './online/lyricsSource.ts';

interface LyricsChoice extends LyricsCandidate {
  readonly contentStatus?: 'loading' | 'missing' | 'failed';
}

export interface LyricsChoiceState {
  readonly keywords: string;
  readonly status:
    'idle' | 'searching' | 'ready' | 'loading' | 'search-failed' | 'fetch-failed' | 'missing';
  readonly candidates: readonly LyricsChoice[];
  readonly failed: readonly LyricsSourceId[];
}

export type LyricsCandidatePreview =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' | 'missing' | 'failed'; readonly id: string }
  | {
      readonly status: 'ready';
      readonly id: string;
      readonly candidate: LyricsCandidate;
      readonly content: LyricsContent;
    };

const EMPTY: LyricsChoiceState = { keywords: '', status: 'idle', candidates: [], failed: [] };
export const lyricsCandidateId = (candidate: Pick<LyricsCandidate, 'source' | 'ref'>) =>
  JSON.stringify([candidate.source, candidate.ref]);
export const lyricsTargetId = (target: LyricsTarget | null) =>
  target ? JSON.stringify([target.key, target.query]) : '';

/** 搜索结果与已取回正文按当前曲目保留，离开页面后仍可恢复。 */
export function startLyricsSearchSession(
  store: Store,
  deps: {
    readonly host: LyricsHttpHost;
    readonly track: Atom<LyricsTarget | null>;
    readonly prefs: Atom<LyricsPrefs>;
    readonly active: Atom<boolean>;
    readonly connected: Atom<boolean>;
  },
) {
  const choices = atom<LyricsChoiceState>(EMPTY);
  const preview = atom<LyricsCandidatePreview>({ status: 'idle' });
  const searches = new Map<string, LyricsChoiceState>();
  const candidates = new Map<string, LyricsCandidate>();
  const bodies = new Map<string, LyricsContent>();
  const requests = new Map<string, Promise<LyricsFetchResult | null>>();
  let requestScope = new AbortController();
  let hydrating: AbortController | null = null;
  let sources: LyricsSource[] | undefined;
  let searching: AbortController | null = null;
  let fetching: AbortController | null = null;
  let identity = '';
  let disposed = false;
  const available = () => !disposed && store.get(deps.active) && store.get(deps.connected);
  const online = () => available() && store.get(deps.prefs).enabled;
  const covers = startLyricsCandidateCovers(store, deps.host, async (target, signal) => {
    const all = await loadSources();
    if (signal.aborted || !online()) return '';
    return all.find((source) => source.id === target.source)?.cover?.(target.ref, signal) ?? '';
  });
  function cancelReads() {
    requestScope.abort();
    requestScope = new AbortController();
    requests.clear();
    hydrating?.abort();
    hydrating = null;
  }
  function cancelSearch() {
    searching?.abort();
    searching = null;
    hydrating?.abort();
    hydrating = null;
    store.set(choices, EMPTY);
  }
  function follow() {
    const next = lyricsTargetId(store.get(deps.track));
    if (identity !== next || !store.get(deps.connected)) {
      identity = next;
      cancelSearch();
      fetching?.abort();
      fetching = null;
      cancelReads();
      searches.clear();
      candidates.clear();
      bodies.clear();
      covers.clear();
      store.set(preview, { status: 'idle' });
    } else if (!online()) {
      searching?.abort();
      searching = null;
      fetching?.abort();
      fetching = null;
      cancelReads();
      covers.pause();
      const before = store.get(choices);
      store.set(choices, {
        ...before,
        status:
          before.status === 'searching' || before.status === 'loading'
            ? before.candidates.length
              ? 'ready'
              : 'idle'
            : before.status,
        candidates: before.candidates.map((candidate) =>
          candidate.contentStatus === 'loading'
            ? { ...candidate, contentStatus: undefined }
            : candidate,
        ),
      });
      if (store.get(preview).status === 'loading') store.set(preview, { status: 'idle' });
    } else if (!searching && !hydrating) {
      void hydrateCandidates(store.get(choices).candidates);
    }
  }
  const offs = [
    store.sub(deps.track, follow),
    store.sub(deps.connected, follow),
    store.sub(deps.active, follow),
    store.sub(deps.prefs, follow),
  ];
  follow();
  async function loadSources() {
    sources ??= (await import('./online/lyricsOnline.ts')).createLyricsSources(deps.host);
    return sources;
  }
  function publishContent(candidate: LyricsCandidate, result: LyricsFetchResult | 'loading') {
    const id = lyricsCandidateId(candidate);
    const update = (state: LyricsChoiceState): LyricsChoiceState => ({
      ...state,
      candidates: state.candidates.map((item) =>
        lyricsCandidateId(item) !== id
          ? item
          : typeof result === 'string'
            ? { ...item, contentStatus: result }
            : { ...item, content: result, contentStatus: undefined },
      ),
    });
    store.set(choices, update);
    for (const [key, state] of searches) searches.set(key, update(state));
  }
  async function readContent(candidate: LyricsCandidate): Promise<LyricsFetchResult | null> {
    const id = lyricsCandidateId(candidate);
    const cached = bodies.get(id) ?? candidate.content;
    if (cached) {
      publishContent(candidate, cached);
      return cached;
    }
    if (!online()) return null;
    const pending = requests.get(id);
    if (pending) return pending;
    const scope = requestScope;
    publishContent(candidate, 'loading');
    const request = (async (): Promise<LyricsFetchResult | null> => {
      try {
        const source = (await loadSources()).find((value) => value.id === candidate.source);
        if (scope.signal.aborted) return null;
        return source ? await source.fetch(candidate, scope.signal) : 'failed';
      } catch {
        return 'failed';
      }
    })()
      .then((result) => {
        if (!result || disposed || scope.signal.aborted || scope !== requestScope) return null;
        if (typeof result !== 'string') bodies.set(id, result);
        publishContent(candidate, result);
        return result;
      })
      .finally(() => {
        if (requests.get(id) === request) requests.delete(id);
      });
    requests.set(id, request);
    return request;
  }
  async function hydrateCandidates(values: readonly LyricsChoice[]) {
    hydrating?.abort();
    const controller = new AbortController();
    hydrating = controller;
    const queue = values.filter(
      (item) =>
        !item.content && item.contentStatus !== 'missing' && item.contentStatus !== 'failed',
    );
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (!controller.signal.aborted && online()) {
          const candidate = queue.shift();
          if (!candidate) return;
          await readContent(candidate);
        }
      }),
    );
    if (hydrating === controller) hydrating = null;
  }
  return {
    choices: atom((get) => get(choices)),
    preview: atom((get) => get(preview)),
    covers: {
      state: covers.state,
      acquire(target: LyricsCoverTarget) {
        if (!online() || !candidates.has(lyricsCandidateId(target))) return () => {};
        return covers.acquire(target);
      },
    },
    cancelSearch,
    sources: loadSources,
    candidate: (id: string) => candidates.get(id),
    async search(keywords: string, force = false) {
      const target = store.get(deps.track);
      const prefs = store.get(deps.prefs);
      const key = JSON.stringify([keywords.trim(), prefs.sources]);
      cancelSearch();
      if (force) {
        searches.delete(key);
        covers.clear();
      }
      const cached = searches.get(key);
      if (cached) {
        store.set(choices, cached);
        await hydrateCandidates(cached.candidates);
        return;
      }
      if (!target || !online() || !keywords.trim()) return;
      const controller = new AbortController();
      searching = controller;
      store.set(choices, { ...EMPTY, keywords, status: 'searching' });
      try {
        const [all, { findLyricsCandidates }] = await Promise.all([
          loadSources(),
          import('./online/lyricsCandidates.ts'),
        ]);
        if (controller.signal.aborted) return;
        const selected = (prefs.sources ?? []).flatMap((id) =>
          all.filter((source) => source.id === id),
        );
        const result = await findLyricsCandidates(
          { ...target.query, keywords: keywords.trim() },
          selected,
          controller.signal,
        );
        if (disposed || controller.signal.aborted) return;
        const ready: LyricsChoiceState = { ...result, keywords, status: 'ready' };
        for (const candidate of result.candidates)
          candidates.set(lyricsCandidateId(candidate), candidate);
        if (result.failed.length === 0) searches.set(key, ready);
        store.set(choices, ready);
        await hydrateCandidates(ready.candidates);
      } catch {
        if (!disposed && !controller.signal.aborted)
          store.set(choices, { ...EMPTY, keywords, status: 'search-failed' });
      } finally {
        if (searching === controller) searching = null;
      }
    },
    async previewCandidate(
      candidate: LyricsCandidate,
      subject = identity,
    ): Promise<LyricsContent | null> {
      const id = lyricsCandidateId(candidate);
      if (subject !== identity || !available() || !candidates.has(id)) return null;
      fetching?.abort();
      fetching = null;
      const cached = bodies.get(id) ?? candidates.get(id)?.content;
      if (cached) {
        store.set(preview, { status: 'ready', id, candidate, content: cached });
        return cached;
      }
      if (!online()) return null;
      const controller = new AbortController();
      fetching = controller;
      store.set(preview, { status: 'loading', id });
      try {
        const result = await readContent(candidate);
        if (!result || disposed || controller.signal.aborted || subject !== identity) return null;
        if (result === 'missing' || result === 'failed') {
          store.set(preview, { status: result, id });
          store.set(choices, {
            ...store.get(choices),
            status: result === 'missing' ? 'missing' : 'fetch-failed',
          });
          return null;
        }
        bodies.set(id, result);
        store.set(preview, { status: 'ready', id, candidate, content: result });
        return result;
      } catch {
        if (!disposed && !controller.signal.aborted) store.set(preview, { status: 'failed', id });
        return null;
      } finally {
        if (fetching === controller) fetching = null;
      }
    },
    dispose() {
      disposed = true;
      store.set(choices, EMPTY);
      store.set(preview, { status: 'idle' });
      searching?.abort();
      fetching?.abort();
      cancelReads();
      covers.dispose();
      offs.forEach((off) => off());
    },
  };
}
