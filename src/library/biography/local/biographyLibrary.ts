import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../../host/waitForHost.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  trackAlbumKeyOf,
  type LibraryEventsFace,
} from '../../../host/libraryContract.ts';
import { biographyArtist } from '../biographyModel.ts';

export const BIOGRAPHY_LIBRARY_LIMIT = 10_000;

export interface BiographyLibrarySummary {
  readonly albums: number;
  readonly appearances: number;
  readonly tracks: number;
  readonly duration: number;
  readonly collaborators: readonly string[];
}

export interface BiographyLibraryState {
  readonly artist: string | null;
  readonly summary: BiographyLibrarySummary | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly truncated: boolean;
}

interface BiographyLibraryHost extends HostReadyFace, LibraryEventsFace {
  readonly library: Pick<typeof fb.library, 'getArtistTracks'>;
}

export interface BiographyLibraryService {
  readonly state: Atom<BiographyLibraryState>;
  readonly ready: Promise<void>;
  refresh(): void;
  dispose(): void;
}

const EMPTY: BiographyLibraryState = {
  artist: null,
  summary: null,
  loading: false,
  failed: false,
  truncated: false,
};

export function summarizeBiographyLibrary(
  artist: string,
  tracks: readonly Track[],
): BiographyLibrarySummary {
  const albums = new Set<string>();
  const appearances = new Set<string>();
  const collaborators = new Map<string, number>();
  const seen = new Set<string>();
  let duration = 0;
  for (const track of tracks) {
    if (seen.has(track.handle)) continue;
    seen.add(track.handle);
    const key = trackAlbumKeyOf(track);
    if (key) {
      const own = (track.albumArtists?.[0] ?? track.artists?.[0] ?? '') === artist;
      (own ? albums : appearances).add(key);
    }
    duration += Math.max(0, track.duration);
    // 复合署名不按标点拆开；只有宿主给出的多值艺人才算合作关系。
    for (const name of new Set(track.artists ?? [])) {
      if (name !== artist && biographyArtist(name))
        collaborators.set(name, (collaborators.get(name) ?? 0) + 1);
    }
  }
  return {
    albums: albums.size,
    appearances: appearances.size,
    tracks: seen.size,
    duration,
    collaborators: [...collaborators]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name]) => name),
  };
}

export function startBiographyLibrary(
  store: ReturnType<typeof createStore>,
  deps: { readonly artist: Atom<string | null>; readonly active: Atom<boolean> },
  host: BiographyLibraryHost = fb,
): BiographyLibraryService {
  const state = atom(EMPTY);
  let waiter = waitForHost(host);
  let disposed = false;
  let connected = false;
  let connectionSettled = false;
  let generation = 0;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cached = new Map<string, BiographyLibraryState>();
  let stopLibrary: (() => void) | undefined;

  async function load() {
    const artist = store.get(deps.artist);
    if (!artist || !store.get(deps.active)) return;
    const known = cached.get(artist);
    if (known) {
      store.set(state, known);
      return;
    }
    const mine = generation;
    const old = store.get(state);
    store.set(state, { ...old, artist, loading: true, failed: false });
    const result = await settle(() =>
      host.library.getArtistTracks(artist, BIOGRAPHY_LIBRARY_LIMIT),
    );
    if (disposed || mine !== generation || !store.get(deps.active)) return;
    const next = {
      artist,
      loading: false,
      failed: !result || result.success === false,
      summary:
        result?.success === true ? summarizeBiographyLibrary(artist, result.tracks) : old.summary,
      // 此端点的 total 同样是截断后的条数，不能当作完整总量。
      truncated: result?.success === true ? result.count >= BIOGRAPHY_LIBRARY_LIMIT : old.truncated,
    };
    cached.set(artist, next);
    if (cached.size > 32) {
      const oldest = cached.keys().next().value;
      if (oldest !== undefined) cached.delete(oldest);
    }
    store.set(state, next);
  }

  async function pump() {
    if (running || !connected || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        await load();
      }
    } finally {
      running = false;
    }
  }

  function schedule(delay = 300) {
    if (disposed) return;
    generation += 1;
    clearTimeout(timer);
    pending = false;
    const artist = store.get(deps.artist);
    const active = store.get(deps.active);
    if (!active || store.get(state).artist !== artist)
      store.set(state, { ...EMPTY, artist, loading: active && !!artist });
    if (!active || !artist) return;
    const known = cached.get(artist);
    if (known) {
      store.set(state, known);
      return;
    }
    timer = setTimeout(() => {
      pending = true;
      void pump();
    }, delay);
  }

  function refresh(delay = 0) {
    if (disposed) return;
    cached.clear();
    if (!connected && connectionSettled) {
      waiter.cancel();
      cached.clear();
      waiter = waitForHost(host);
      void connect();
    }
    schedule(delay);
  }

  async function connect() {
    connectionSettled = false;
    const arrived = await waiter.done;
    if (disposed) return;
    connectionSettled = true;
    if (!arrived) {
      store.set(state, { ...store.get(state), loading: false, failed: true });
      return;
    }
    stopLibrary = onLibraryChanged(host, () => refresh(LIBRARY_COALESCE_MS));
    connected = true;
    void pump();
  }

  const stops = [deps.artist, deps.active].map((source) => store.sub(source, () => schedule()));
  schedule();
  return {
    state,
    ready: connect(),
    refresh,
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      stopLibrary?.();
      waiter.cancel();
    },
  };
}
