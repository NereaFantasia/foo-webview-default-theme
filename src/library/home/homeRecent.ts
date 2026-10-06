import { fb } from 'foo-webview-sdk/bridge';
import type { RecentLibraryTrack } from 'foo-webview-sdk';
import { atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { albumsAtom } from '../albums.ts';
import {
  albumKeyOf,
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  trackAlbumKeyOf,
  type Album,
} from '../../host/libraryContract.ts';
import { HOME_ALBUM_COUNT } from './homeModel.ts';

export const HOME_RECENT_LIMIT = 300;

interface HomeRecentState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable' | 'disabled' | 'missing';
  readonly tracks: readonly RecentLibraryTrack[];
  readonly dirty: boolean;
  readonly limited: boolean;
}

/** 宿主已按添加时间倒序；同一专辑只保留首次出现的位置，不接收缺少添加时间的行。 */
export function homeRecentAlbums(
  tracks: readonly RecentLibraryTrack[],
  albums: readonly Album[],
): Album[] {
  const catalog = new Map(albums.map((album) => [albumKeyOf(album), album]));
  const found = new Set<string>();
  const result: Album[] = [];
  for (const track of tracks) {
    if (!track.added || !/^\d{4}-\d{2}-\d{2}/.test(track.added)) continue;
    const key = trackAlbumKeyOf(track);
    const album = key && catalog.get(key);
    if (!album || found.has(key)) continue;
    found.add(key);
    result.push(album);
    if (result.length === HOME_ALBUM_COUNT) break;
  }
  return result;
}

export type HomeRecentHost = Pick<typeof fb, 'library' | 'on' | 'ready' | 'isAvailable'>;

export function startHomeRecent(store: Store, host: HomeRecentHost = fb) {
  const state = atom<HomeRecentState>({
    status: 'idle',
    tracks: [],
    dirty: false,
    limited: false,
  });
  const albums = atom((get) => homeRecentAlbums(get(state).tracks, get(albumsAtom).albums));
  let disposed = false;
  let wanted = false;
  let published = false;
  let generation = 0;
  let off: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  const patch = (change: Partial<HomeRecentState>) =>
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
    const enabled = await settle(() => host.library.isEnabled());
    if (!current()) return;
    if (!enabled || enabled.success === false) return patch({ status: 'failed' });
    if (!enabled.enabled) return patch({ status: 'disabled', tracks: [] });
    const answer = await settle(() => host.library.getRecentlyAdded(HOME_RECENT_LIMIT, 'added'));
    if (!current()) return;
    if (!answer || answer.success === false) return patch({ status: 'failed' });
    published = true;
    if (answer.fallback || answer.sortBy !== 'added')
      return patch({ status: 'missing', tracks: [], limited: false });
    patch({
      status: 'ready',
      tracks: answer.tracks,
      limited: answer.total > answer.tracks.length,
    });
  }

  return {
    state,
    albums,
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

export type HomeRecentService = ReturnType<typeof startHomeRecent>;
