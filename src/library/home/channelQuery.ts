import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { onLibraryChanged } from '../../host/libraryContract.ts';
import { CHANNEL_SORT_PATTERNS, type ChannelSort } from './homeChannels.ts';

export const CHANNEL_RESULT_LIMIT = 100_000;
export const CHANNEL_PREVIEW_LIMIT = 5;
export const CHANNEL_DEBOUNCE_MS = 300;

export interface ChannelQueryState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable' | 'disabled';
  readonly query: string;
  readonly sort: ChannelSort;
  readonly tracks: readonly LibraryTrackPartial[];
  readonly total: number;
  readonly dirty: boolean;
}

export type ChannelQueryHost = Pick<typeof fb, 'library' | 'on' | 'ready' | 'isAvailable'>;

/** 排序交给宿主，一次取有上限的完整前缀，不把几次不同顺序的随机结果拼起来。 */
export function startChannelQuery(
  store: Store,
  limit = CHANNEL_RESULT_LIMIT,
  host: ChannelQueryHost = fb,
) {
  const state = atom<ChannelQueryState>({
    status: 'idle',
    query: '',
    sort: 'album',
    tracks: [],
    total: 0,
    dirty: false,
  });
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  let off: (() => void) | undefined;
  const patch = (change: Partial<ChannelQueryState>) =>
    store.set(state, { ...store.get(state), ...change });

  async function load(mine: number) {
    const current = () => !disposed && mine === generation;
    const waiting = waitForHost(host);
    waiter = waiting;
    const arrived = await waiting.done;
    waiting.cancel();
    if (!current()) return;
    if (!arrived) return patch({ status: 'unavailable' });
    off ??= onLibraryChanged(host, () => {
      if (store.get(state).status === 'ready') patch({ dirty: true });
      else setQuery(store.get(state).query, store.get(state).sort);
    });
    const enabled = await settle(() => host.library.isEnabled());
    if (!current()) return;
    if (!enabled || enabled.success === false) return patch({ status: 'failed' });
    if (!enabled.enabled) return patch({ status: 'disabled' });
    const { query, sort } = store.get(state);
    const answer = await settle(() =>
      host.library.query(query, CHANNEL_SORT_PATTERNS[sort], limit),
    );
    if (!current()) return;
    if (!answer || answer.success === false) return patch({ status: 'failed' });
    const tracks = [
      ...new Map(
        answer.tracks.filter((track) => track.handle).map((track) => [track.handle, track]),
      ).values(),
    ];
    if (answer.total > 0 && !tracks.length) return patch({ status: 'failed' });
    patch({ status: 'ready', tracks, total: answer.total, dirty: false });
  }

  function setQuery(query: string, sort: ChannelSort, immediate = false) {
    if (disposed) return;
    const mine = ++generation;
    clearTimeout(timer);
    waiter?.cancel();
    const text = query.trim();
    patch({
      query: text,
      sort,
      status: text ? 'loading' : 'idle',
      tracks: [],
      total: 0,
      dirty: false,
    });
    if (!text) return;
    if (immediate) void load(mine);
    else timer = setTimeout(() => void load(mine), CHANNEL_DEBOUNCE_MS);
  }

  return {
    state,
    setQuery,
    retry() {
      const { query, sort } = store.get(state);
      setQuery(query, sort, true);
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      waiter?.cancel();
      off?.();
    },
  };
}

export type ChannelQueryService = ReturnType<typeof startChannelQuery>;
