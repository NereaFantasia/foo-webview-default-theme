import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { LocalLyricsService, LyricsTrack } from './lyricsLocal.ts';
import { LYRICS_PRIORITY, type LyricsPrefs, type LyricsPrefsService } from './lyricsPrefs.ts';
import { isWordLevel } from './lyricsText.ts';
import type { LyricsCoverAccess } from './lyricsCandidateCovers.ts';
import { lyricsVersion, type LyricsArchive, type LyricsReady } from './lyricsArchive.ts';
import {
  startLyricsSearchSession,
  lyricsTargetId,
  type LyricsChoiceState,
  type LyricsCandidatePreview,
} from './lyricsSearchSession.ts';
import type { LyricsHttpHost } from './online/lyricsHttp.ts';
import type { createLyricsOnline } from './online/lyricsOnline.ts';
import type { FoundLyrics } from './online/lyricsSearch.ts';
import type { LyricsCandidate, LyricsQuery } from './online/lyricsSource.ts';

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
  | LyricsReady;

export interface LyricsDeps {
  readonly host: LyricsHttpHost;
  readonly track: Atom<LyricsTarget | null>;
  readonly connected: Atom<boolean>;
  readonly active: Atom<boolean>;
  readonly visible?: Atom<boolean>;
  readonly local: Pick<LocalLyricsService, 'state' | 'refresh'>;
  readonly prefs: Pick<LyricsPrefsService, 'pref'>;
  readonly archive?: LyricsArchive;
}

export interface LyricsService {
  readonly state: Atom<LyricsState>;
  readonly choices: Atom<LyricsChoiceState>;
  readonly covers: LyricsCoverAccess;
  search(keywords: string, force?: boolean): Promise<void>;
  readonly preview: Atom<LyricsCandidatePreview>;
  readonly offset: Atom<number>;
  readonly subject: Atom<string>;
  /** 为当前曲目保留一次预览取词需求，沿用已有来源设置，不刷新已经完成的结果。 */
  requestPreview(): void;
  candidate(id: string): LyricsCandidate | undefined;
  previewCandidate(
    candidate: LyricsCandidate,
    subject?: string,
  ): Promise<import('./lyricsText.ts').LyricsContent | null>;
  choose(candidate: LyricsCandidate, makeDefault?: boolean, subject?: string): Promise<boolean>;
  restoreAutomatic(): Promise<boolean>;
  setOffset(seconds: number): Promise<boolean>;
  seekTime(seconds: number): number;
  cancelSearch(): void;
  refresh(): void;
  dispose(): void;
}

export const lyricsKey = serviceKey<LyricsService>('lyrics');

/** 按用户顺序取词；只有界面有取词需求且已启用联网时才加载在线模块、发起搜索。 */
export function startLyrics(store: Store, deps: LyricsDeps): LyricsService {
  const state = atom<LyricsState>({ status: 'idle' });
  let disposed = false;
  let search: ReturnType<typeof createLyricsOnline> | undefined;
  let request: AbortController | null = null;
  let input = '';
  let outcome: LyricsState | null = null;
  const session = startLyricsSearchSession(store, { ...deps, prefs: deps.prefs.pref });
  let chosen: LyricsReady | null = null;
  let manualInput = '';
  let previewInput = '';
  let selection = 0;
  const subject = atom((get) => lyricsTargetId(get(deps.track)));
  const offset = atom((get) => {
    const ready = get(state);
    return ready.status === 'ready' && deps.archive
      ? (get(deps.archive.record).offsets[lyricsVersion(ready)] ?? 0)
      : 0;
  });

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
      const { createLyricsOnline } = await import('./online/lyricsOnline.ts');
      if (controller.signal.aborted) return;
      search ??= createLyricsOnline(deps.host, await session.sources());
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
    follow();
  }

  function follow(): void {
    if (disposed) return;
    const target = store.get(deps.track);
    const local = store.get(deps.local.state);
    const identity = target ? JSON.stringify([target.key, target.query]) : '';
    if (identity !== manualInput || !store.get(deps.connected)) {
      manualInput = identity;
      previewInput = '';
      chosen = null;
      selection += 1;
    }
    if (!target || !store.get(deps.connected)) {
      cancel();
      input = '';
      outcome = null;
      store.set(state, { status: 'idle' });
      return;
    }
    const preferred = chosen ?? (deps.archive ? store.get(deps.archive.selected) : null);
    if (preferred) {
      cancel();
      store.set(state, { ...preferred, key: target.key });
      return;
    }
    if (local.status === 'idle' || local.key !== target.key || local.status === 'loading') {
      cancel();
      input = '';
      outcome = null;
      store.set(state, { status: 'loading', key: target.key, stage: 'local' });
      return;
    }
    const prefs = store.get(deps.prefs.pref);
    const order = prefs.order ?? LYRICS_PRIORITY;
    if (local.status === 'ready' && (!prefs.enabled || order[0] === 'local')) {
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
      if (local.status === 'ready') {
        store.set(state, local);
        return;
      }
      store.set(
        state,
        local.status === 'failed'
          ? { status: 'failed', key: target.key, stage: 'local' }
          : { status: 'missing', key: target.key, reason: 'metadata' },
      );
      return;
    }
    if (outcome) {
      const kind =
        outcome.status === 'ready'
          ? isWordLevel(outcome.content)
            ? 'word'
            : outcome.content.kind === 'synced'
              ? 'line'
              : 'plain'
          : null;
      store.set(
        state,
        local.status === 'ready' && (!kind || order.indexOf('local') < order.indexOf(kind))
          ? local
          : outcome,
      );
      return;
    }
    const previewWanted = previewInput === identity && (!deps.visible || store.get(deps.visible));
    if (!store.get(deps.active) && !previewWanted) {
      cancel();
      store.set(state, local.status === 'ready' ? local : { status: 'waiting', key: target.key });
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
    ...(deps.visible ? [store.sub(deps.visible, follow)] : []),
    store.sub(deps.local.state, follow),
    store.sub(deps.prefs.pref, follow),
    ...(deps.archive ? [store.sub(deps.archive.selected, follow)] : []),
  ];
  follow();

  return {
    state: atom((get) => get(state)),
    choices: session.choices,
    covers: session.covers,
    preview: session.preview,
    offset,
    subject,
    requestPreview() {
      const current = store.get(subject);
      if (disposed || !current || previewInput === current) return;
      previewInput = current;
      follow();
    },
    candidate: session.candidate,
    previewCandidate: session.previewCandidate,
    cancelSearch: session.cancelSearch,
    search: session.search,
    async choose(candidate, makeDefault = false, expected = store.get(subject)) {
      const target = store.get(deps.track);
      if (!target || expected !== store.get(subject)) return false;
      const mine = ++selection;
      const content = await session.previewCandidate(candidate, expected);
      if (!content || disposed || mine !== selection || expected !== store.get(subject))
        return false;
      chosen = { status: 'ready', key: target.key, source: candidate.source, content, candidate };
      follow();
      if (makeDefault && deps.archive) void deps.archive.select(target.key, chosen);
      return true;
    },
    async restoreAutomatic() {
      const target = store.get(deps.track);
      if (!target || disposed) return false;
      chosen = null;
      selection += 1;
      cancel();
      input = '';
      outcome = null;
      const saved = deps.archive ? await deps.archive.select(target.key, null) : true;
      if (!disposed) follow();
      return saved;
    },
    setOffset(seconds) {
      const current = store.get(state);
      return current.status === 'ready' && deps.archive
        ? deps.archive.setOffset(current.key, lyricsVersion(current), seconds)
        : Promise.resolve(false);
    },
    seekTime(seconds) {
      const duration = store.get(deps.track)?.query.durationMs ?? 0;
      return Math.max(
        0,
        Math.min(duration > 0 ? duration / 1000 : Infinity, seconds + store.get(offset)),
      );
    },
    refresh() {
      if (disposed) return;
      chosen = null;
      session.cancelSearch();
      cancel();
      input = '';
      outcome = null;
      deps.local.refresh();
      follow();
    },
    dispose() {
      disposed = true;
      session.dispose();
      cancel();
      for (const off of offs) off();
    },
  };
}
