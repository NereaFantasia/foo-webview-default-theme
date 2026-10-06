import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import type { AlbumsState } from '../../albums.ts';
import { albumYearOf } from '../../../host/libraryContract.ts';
import { biographyArtist } from '../biographyModel.ts';

export interface BiographyArtistImagesDeps {
  readonly artists: Atom<readonly string[]>;
  readonly active: Atom<boolean>;
  readonly albums: Atom<AlbumsState>;
  readonly probe: (url: string) => Promise<Uint8ClampedArray | null>;
}

export interface BiographyArtistImages {
  readonly state: Atom<ReadonlyMap<string, string>>;
  refresh(): void;
  dispose(): void;
}

const IMAGE_SIZE = 64;

export function startBiographyArtistImages(
  store: ReturnType<typeof createStore>,
  deps: BiographyArtistImagesDeps,
  host: { readonly artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'> } = fb,
): BiographyArtistImages {
  const state = atom<ReadonlyMap<string, string>>(new Map());
  const cached = new Map<string, string | null>();
  let names: readonly string[] = [];
  let library = store.get(deps.albums);
  let active = false;
  let disposed = false;
  let generation = 0;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function publish() {
    store.set(
      state,
      new Map(
        active
          ? names.flatMap((name) => {
              const url = cached.get(name);
              return url ? [[name, url] as const] : [];
            })
          : [],
      ),
    );
  }

  async function load() {
    if (!active || library.status === 'idle' || !library.enabled) return;
    const mine = generation;
    const current = () => !disposed && mine === generation;
    const wanted = new Set(names);
    const albums = library.albums
      .filter((album) => wanted.has(album.albumArtist))
      .sort((a, b) => (albumYearOf(a) || '9999').localeCompare(albumYearOf(b) || '9999'));
    for (const name of names) {
      if (!current()) return;
      if (cached.has(name)) continue;
      let image: string | null = null;
      const paths = new Set<string>();
      for (const album of albums) {
        if (album.albumArtist !== name) continue;
        const path = album.firstTrackAbsolutePath || album.firstTrackPath;
        if (!path || paths.has(path)) continue;
        paths.add(path);
        const answer = await settle(() =>
          host.artwork.getFb2kUrlByPath(path, 'artist', { maxSize: IMAGE_SIZE }),
        );
        if (!current()) return;
        if (!answer || answer.success === false || !answer.dataUrl) continue;
        // 地址接口不保证图片存在；只探测限尺寸的 artist 图，不回落到前封面。
        const pixels = await deps.probe(answer.dataUrl).catch(() => null);
        if (!current()) return;
        if (pixels?.length) {
          image = answer.dataUrl;
          break;
        }
      }
      cached.set(name, image);
      publish();
    }
  }

  async function pump() {
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

  function schedule(refresh = false) {
    if (disposed) return;
    const nextNames = [...new Set(store.get(deps.artists))].filter(
      (name) => biographyArtist(name) === name,
    );
    const nextLibrary = store.get(deps.albums);
    const nextActive = store.get(deps.active);
    if (
      !refresh &&
      nextLibrary === library &&
      nextActive === active &&
      JSON.stringify(nextNames) === JSON.stringify(names)
    )
      return;
    generation += 1;
    pending = false;
    clearTimeout(timer);
    if (refresh || nextLibrary !== library) cached.clear();
    for (const name of cached.keys()) {
      if (!nextNames.includes(name)) cached.delete(name);
    }
    names = nextNames;
    library = nextLibrary;
    active = nextActive;
    publish();
    if (!active || !names.length) return;
    timer = setTimeout(() => {
      pending = true;
      void pump();
    }, 300);
  }

  const stops = [deps.artists, deps.active, deps.albums].map((source) =>
    store.sub(source, () => schedule()),
  );
  schedule();
  return {
    state,
    refresh: () => schedule(true),
    dispose() {
      disposed = true;
      generation += 1;
      pending = false;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      cached.clear();
    },
  };
}
