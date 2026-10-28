import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { albumsAtom, type AlbumsService } from '../albums.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';
import { albumArtistRows } from '../artists/artistIndex.ts';
import {
  bestSearchHit,
  searchAlbums,
  searchArtists,
  searchQuery,
  type SearchHit,
  type SearchScope,
} from './searchQuery.ts';

export const SEARCH_PAGE_SIZE = 100;
export const SEARCH_RESULT_LIMIT = 100_000;
export const SEARCH_DEBOUNCE_MS = 300;

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable' | 'disabled';

export interface SearchResultsState {
  readonly text: string;
  readonly status: SearchStatus;
  readonly tracks: readonly LibraryTrackPartial[];
  readonly total: number | null;
  readonly libraryEmpty: boolean | null;
  readonly limited: boolean;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

export interface SearchResultsFace extends HostReadyFace, LibraryEventsFace {
  readonly library: Pick<typeof fb.library, 'query' | 'isEnabled' | 'getStats'>;
}

export interface SearchResultsService {
  readonly state: Atom<SearchResultsState>;
  readonly albums: Atom<ReturnType<typeof searchAlbums>>;
  /** 按专辑艺人归出的艺人，与艺人页缺省的列出依据一致；只在客串里出现的艺人不在这里 */
  readonly artists: Atom<ReturnType<typeof searchArtists>>;
  readonly best: Atom<SearchHit | null>;
  /** 字段▾：曲目、专辑与艺人都按它比；缺省 `any` */
  readonly scope: Atom<SearchScope>;
  setText(text: string, immediate?: boolean): void;
  /** 换字段范围，马上重查 */
  setScope(scope: SearchScope): void;
  more(minimum?: number): Promise<void>;
  /** 读取完整结果供全选；失败、查询失效或超过读取上限时为 null，不返回部分选择 */
  all(): Promise<readonly LibraryTrackPartial[] | null>;
  retry(): void;
  dispose(): void;
}

const INITIAL: SearchResultsState = {
  text: '',
  status: 'idle',
  tracks: [],
  total: null,
  libraryEmpty: null,
  limited: false,
  loadingMore: false,
  moreFailed: false,
};

/**
 * library.query 没有 offset，续页扩大有序前缀并整份替换，不拼接可能重复或改序的旧页
 * 每次库事件立即作废应答，合并窗口只延迟重读；达到前缀上限后仍保留完整 total
 */
export function startSearchResults(
  store: Store,
  catalog: Pick<AlbumsService, 'retry'>,
  host: SearchResultsFace = fb,
): SearchResultsService {
  const state = atom<SearchResultsState>(INITIAL);
  const scope = atom<SearchScope>('any');
  const albums = atom((get) => {
    const source = get(albumsAtom);
    return source.status === 'ready' && source.enabled
      ? searchAlbums(source.albums, get(state).text, get(scope))
      : [];
  });
  const artistRows = atom((get) => albumArtistRows(get(albumsAtom).albums));
  const artists = atom((get) => {
    const source = get(albumsAtom);
    return source.status === 'ready' && source.enabled
      ? searchArtists(get(artistRows), get(state).text, get(scope))
      : [];
  });
  const best = atom((get) => {
    const result = get(state);
    const source = get(albumsAtom);
    if (
      result.status !== 'ready' ||
      source.status !== 'ready' ||
      !source.enabled ||
      source.truncated
    )
      return null;
    return bestSearchHit(get(albums), result.tracks, result.text, get(artists));
  });
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  let offLibrary: (() => void) | undefined;

  const patch = (change: Partial<SearchResultsState>) =>
    store.set(state, { ...store.get(state), ...change });

  function invalidate(): number {
    clearTimeout(timer);
    timer = undefined;
    waiter?.cancel();
    return ++generation;
  }

  async function load(mine: number, limit: number, more: boolean): Promise<void> {
    const stale = () => disposed || mine !== generation;
    const compiled = searchQuery(store.get(state).text, store.get(scope));
    if (!compiled || stale()) return;
    const waiting = waitForHost(host);
    waiter = waiting;
    if (!(await waiting.done)) {
      waiting.cancel();
      if (!stale()) patch({ status: 'unavailable', loadingMore: false });
      return;
    }
    waiting.cancel();
    if (stale()) return;
    offLibrary ??= onLibraryChanged(host, () => {
      const next = invalidate();
      if (!store.get(state).text) return;
      patch({ ...INITIAL, text: store.get(state).text, status: 'loading' });
      timer = setTimeout(() => void load(next, SEARCH_PAGE_SIZE, false), LIBRARY_COALESCE_MS);
    });
    const enabled = await settle(() => host.library.isEnabled());
    if (stale()) return;
    if (!enabled || enabled.success === false) {
      patch(more ? { loadingMore: false, moreFailed: true } : { status: 'failed' });
      return;
    }
    if (!enabled.enabled) {
      patch({ ...INITIAL, text: compiled.text, status: 'disabled' });
      return;
    }
    const answer = await settle(() => host.library.query(compiled.query, compiled.sort, limit));
    if (stale()) return;
    if (!answer || answer.success === false) {
      patch(more ? { loadingMore: false, moreFailed: true } : { status: 'failed' });
      return;
    }
    const tracks = [
      ...new Map(
        answer.tracks.filter((track) => track.handle).map((track) => [track.handle, track]),
      ).values(),
    ];
    if (
      (answer.total > 0 && tracks.length === 0) ||
      (more && answer.total > tracks.length && tracks.length <= store.get(state).tracks.length)
    ) {
      patch(more ? { loadingMore: false, moreFailed: true } : { status: 'failed' });
      return;
    }
    let libraryEmpty: boolean | null = false;
    if (answer.total === 0) {
      const stats = await settle(() => host.library.getStats());
      if (stale()) return;
      libraryEmpty = stats && stats.success !== false ? stats.totalTracks === 0 : null;
    }
    patch({
      status: 'ready',
      tracks,
      total: answer.total,
      libraryEmpty,
      limited: tracks.length >= SEARCH_RESULT_LIMIT && answer.total > tracks.length,
      loadingMore: false,
      moreFailed: false,
    });
  }

  function setText(text: string, immediate = false): void {
    if (disposed) return;
    const value = text.trim();
    if (value === store.get(state).text && !immediate) return;
    const mine = invalidate();
    store.set(state, { ...INITIAL, text: value, status: value ? 'loading' : 'idle' });
    if (!value) return;
    if (immediate) void load(mine, SEARCH_PAGE_SIZE, false);
    else timer = setTimeout(() => void load(mine, SEARCH_PAGE_SIZE, false), SEARCH_DEBOUNCE_MS);
  }

  return {
    state,
    albums,
    artists,
    best,
    scope,
    setText,
    setScope(next) {
      if (disposed || next === store.get(scope)) return;
      store.set(scope, next);
      // 换字段不清空手上的结果，新结果到了整份替换：先清空再填回来，整页会闪一下
      if (store.get(state).text) void load(invalidate(), SEARCH_PAGE_SIZE, false);
    },
    async more(minimum = 0) {
      const current = store.get(state);
      if (
        disposed ||
        current.status !== 'ready' ||
        current.loadingMore ||
        current.total === null ||
        current.tracks.length >= Math.min(current.total, SEARCH_RESULT_LIMIT)
      )
        return;
      patch({ loadingMore: true, moreFailed: false });
      await load(
        generation,
        Math.min(SEARCH_RESULT_LIMIT, Math.max(current.tracks.length + SEARCH_PAGE_SIZE, minimum)),
        true,
      );
    },
    async all() {
      const current = store.get(state);
      if (disposed || current.status !== 'ready' || current.total === null || current.limited)
        return null;
      const mine = invalidate();
      if (current.tracks.length < current.total) {
        patch({ loadingMore: true, moreFailed: false });
        await load(mine, Math.min(current.total, SEARCH_RESULT_LIMIT), true);
      }
      const next = store.get(state);
      return !disposed &&
        mine === generation &&
        next.status === 'ready' &&
        !next.moreFailed &&
        next.total !== null &&
        next.tracks.length >= next.total
        ? next.tracks
        : null;
    },
    retry() {
      if (disposed) return;
      void catalog.retry();
      setText(store.get(state).text, true);
    },
    dispose() {
      disposed = true;
      invalidate();
      offLibrary?.();
    },
  };
}
