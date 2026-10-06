import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { AlbumsState } from '../albums.ts';
import { albumKeyOf, albumYearOf } from '../../host/libraryContract.ts';
import type { BiographyOnlinePhotoState } from './online/biographyOnlinePhoto.ts';
import type { BiographyPhotoProblem } from './online/fetchLastfmPhoto.ts';
import { createBiographyPhotoCache, type BiographyPhotoCache } from './biographyPhotoCache.ts';

export interface BiographyPhoto {
  readonly key: string;
  readonly album: string;
  readonly url: string;
  readonly sourceUrl?: string;
  readonly pixels?: Uint8ClampedArray;
}

export interface BiographyPhotosState {
  readonly artist: string | null;
  readonly photos: readonly BiographyPhoto[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly truncated: boolean;
  readonly onlineLoading?: boolean;
  readonly onlineProblem?: BiographyPhotoProblem | null;
}

export interface BiographyPhotosDeps {
  readonly artist: Atom<string | null>;
  readonly active: Atom<boolean>;
  readonly albums: Atom<AlbumsState>;
  readonly probe: (url: string) => Promise<Uint8ClampedArray | null>;
  readonly same: (a: ArrayLike<number>, b: ArrayLike<number>) => boolean;
  readonly online?: Atom<BiographyOnlinePhotoState>;
  readonly cache?: BiographyPhotoCache;
}

export interface BiographyPhotosService {
  readonly state: Atom<BiographyPhotosState>;
  refresh(): void;
  dispose(): void;
}

const EMPTY: BiographyPhotosState = {
  artist: null,
  photos: [],
  loading: false,
  failed: false,
  truncated: false,
};

export function startBiographyPhotos(
  store: ReturnType<typeof createStore>,
  deps: BiographyPhotosDeps,
  host: { readonly artwork: Pick<typeof fb.artwork, 'getForTrack' | 'getFb2kUrlByPath'> } = fb,
): BiographyPhotosService {
  const state = atom(EMPTY);
  const cache = deps.cache ?? createBiographyPhotoCache();
  let disposed = false;
  let generation = 0;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const mine = generation;
    const artist = store.get(deps.artist);
    const library = store.get(deps.albums);
    if (!artist || !store.get(deps.active) || library.status === 'idle') return;
    const current = () => !disposed && mine === generation;
    const revision = cache.revision;
    const requestKey = cache.localKey(artist, library);
    const collecting = () =>
      cache.revision === revision &&
      store.get(deps.albums) === library &&
      (deps.cache || current());
    const collect = async (): Promise<BiographyPhotosState> => {
      const albums = library.albums
        .filter((album) => album.albumArtist === artist)
        .sort((a, b) => (albumYearOf(a) || '9999').localeCompare(albumYearOf(b) || '9999'));
      const photos: BiographyPhoto[] = [];
      const probes: Uint8ClampedArray[] = [];
      let failed = library.status === 'failed';
      for (const album of albums) {
        if (!collecting()) return { ...EMPTY, artist };
        const path = album.firstTrackAbsolutePath || album.firstTrackPath;
        if (!path) continue;
        // URL 接口不探测文件是否有图；先读 artist 类型，不能拿 front 或客串专辑补位。
        const answer = await settle(() => host.artwork.getForTrack(path, 'artist'));
        if (!collecting()) return { ...EMPTY, artist };
        if (!answer || answer.success === false) {
          failed = true;
          continue;
        }
        if (!answer.available || !answer.dataUrl) continue;
        const pixels = await deps.probe(answer.dataUrl).catch(() => null);
        if (!collecting()) return { ...EMPTY, artist };
        if (!pixels) {
          failed = true;
          continue;
        }
        if (probes.some((previous) => deps.same(previous, pixels))) continue;
        const address = await settle(() => host.artwork.getFb2kUrlByPath(path, 'artist'));
        if (!collecting()) return { ...EMPTY, artist };
        if (!address || address.success === false || !address.dataUrl) {
          failed = true;
          continue;
        }
        probes.push(pixels);
        photos.push({ key: albumKeyOf(album), album: album.name, url: address.dataUrl, pixels });
        if (current())
          store.set(state, {
            artist,
            photos: [...photos],
            loading: true,
            failed,
            truncated: library.truncated,
          });
      }
      return {
        artist,
        photos,
        loading: library.status === 'loading',
        failed,
        truncated: library.truncated,
      };
    };
    const result = await cache.localRequests.run(requestKey, collect);
    if (
      collecting() &&
      library.status !== 'loading' &&
      cache.localKey(artist, library) === requestKey
    ) {
      cache.local.delete(artist);
      cache.local.set(artist, { library, state: result });
      if (cache.local.size > 32) {
        const oldest = cache.local.keys().next().value;
        if (oldest !== undefined) cache.local.delete(oldest);
      }
    }
    if (current()) store.set(state, result);
  }

  async function pump(): Promise<void> {
    if (running || disposed) return;
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

  function schedule(refresh = false): void {
    if (disposed) return;
    generation += 1;
    pending = false;
    clearTimeout(timer);
    const artist = store.get(deps.artist);
    const active = store.get(deps.active);
    const library = store.get(deps.albums);
    if (refresh) {
      if (artist) cache.invalidateLocal(artist, library);
    }
    const cached = artist ? cache.local.get(artist) : undefined;
    if (active && cached?.library === library) {
      store.set(state, cached.state);
      return;
    }
    store.set(state, { ...EMPTY, artist, loading: active && !!artist });
    if (!active || !artist || disposed) return;
    timer = setTimeout(() => {
      pending = true;
      void pump();
    }, 300);
  }

  const stops = [deps.artist, deps.active, deps.albums].map((source) =>
    store.sub(source, () => schedule()),
  );
  const combined = atom((get): BiographyPhotosState => {
    const local = get(state);
    const online = deps.online && get(deps.active) ? get(deps.online) : null;
    const photos = [...local.photos];
    for (const photo of online?.photos ?? (online?.photo ? [online.photo] : [])) {
      if (
        !photo.pixels ||
        !photos.some((item) => item.pixels && deps.same(item.pixels, photo.pixels ?? []))
      )
        photos.push(photo);
    }
    return {
      ...local,
      photos,
      onlineLoading: online?.loading,
      onlineProblem: online?.problem,
    };
  });
  schedule();
  return {
    state: combined,
    refresh: () => schedule(true),
    dispose() {
      disposed = true;
      generation += 1;
      pending = false;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      if (!deps.cache) cache.clear();
    },
  };
}
