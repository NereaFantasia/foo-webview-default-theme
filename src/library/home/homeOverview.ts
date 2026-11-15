import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { LIBRARY_COALESCE_MS, onLibraryChanged } from '../../host/libraryContract.ts';
import { waitForHost } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';

/** 媒体库的规模；时长的单位是秒 */
export interface HomeLibrarySize {
  readonly tracks: number;
  readonly albums: number;
  readonly artists: number;
  readonly duration: number;
}

interface HomeOverviewState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';
  /** 最近一次读到的规模；还没读到过是 null */
  readonly size: HomeLibrarySize | null;
  readonly dirty: boolean;
}

export type HomeOverviewHost = Pick<typeof fb, 'on' | 'ready' | 'isAvailable'> & {
  library: Pick<typeof fb.library, 'getStats'>;
};

/**
 * 媒体库概览的数字。宿主每答一次都要遍历整库，所以只在首次需要与显式刷新时读
 * 已经显示出来的数字在媒体库变化后只标记待刷新，还没显示过的等变化停下来再读
 */
export function startHomeOverview(store: Store, host: HomeOverviewHost = fb) {
  const state = atom<HomeOverviewState>({ status: 'idle', size: null, dirty: false });
  let disposed = false;
  let wanted = false;
  let published = false;
  let generation = 0;
  let off: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  const patch = (change: Partial<HomeOverviewState>) =>
    store.set(state, { ...store.get(state), ...change });

  function invalidate() {
    if (disposed) return;
    patch({ dirty: true });
    if (published) return;
    generation += 1;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), LIBRARY_COALESCE_MS);
  }

  async function refresh() {
    if (disposed) return;
    wanted = true;
    const mine = ++generation;
    const current = () => !disposed && mine === generation;
    clearTimeout(timer);
    waiter?.cancel();
    patch({ status: 'loading', dirty: false });
    const waiting = waitForHost(host);
    waiter = waiting;
    const arrived = await waiting.done;
    waiting.cancel();
    if (!current()) return;
    if (!arrived) return patch({ status: 'unavailable' });
    off ??= onLibraryChanged(host, invalidate);
    const answer = await settle(() => host.library.getStats());
    if (!current()) return;
    if (!answer || answer.success === false) return patch({ status: 'failed' });
    published = true;
    patch({
      status: 'ready',
      size: {
        tracks: answer.totalTracks,
        albums: answer.totalAlbums,
        artists: answer.totalArtists,
        duration: answer.totalDuration,
      },
    });
  }

  return {
    state,
    activate() {
      if (!wanted) void refresh();
    },
    refresh,
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      waiter?.cancel();
      off?.();
    },
  };
}

export type HomeOverviewService = ReturnType<typeof startHomeOverview>;
