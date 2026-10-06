import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { BiographyPhoto } from '../biographyPhotos.ts';
import { lastfmArtistUrl, type BiographyLanguage } from '../biographyModel.ts';
import {
  createBiographyPhotoCache,
  type BiographyPhotoCache,
  type DecodedBiographyPhoto,
} from '../biographyPhotoCache.ts';
import { fetchLastfmPhoto, type BiographyPhotoProblem } from './fetchLastfmPhoto.ts';
import { fetchLastfmGallery } from './lastfmGallery.ts';
import { lastfmPhotoId, type LastfmPhoto } from './lastfmPhoto.ts';

export interface BiographyOnlinePhotoState {
  readonly photo: BiographyPhoto | null;
  readonly photos?: readonly BiographyPhoto[];
  readonly loading: boolean;
  readonly problem: BiographyPhotoProblem | null;
  readonly bytes: number;
}
export interface BiographyOnlinePhotoDeps {
  readonly source: Atom<LastfmPhoto | null>;
  readonly active: Atom<boolean>;
  readonly ready: Atom<boolean>;
  readonly probe: (url: string) => Promise<Uint8ClampedArray | null>;
  readonly artist?: Atom<string | null>;
  readonly language?: Atom<BiographyLanguage>;
  readonly cache?: BiographyPhotoCache;
}
const EMPTY: BiographyOnlinePhotoState = { photo: null, loading: false, problem: null, bytes: 0 };

export function startBiographyOnlinePhoto(
  store: ReturnType<typeof createStore>,
  deps: BiographyOnlinePhotoDeps,
  fetch = fetchLastfmPhoto,
  gallery = fetchLastfmGallery,
) {
  const state = atom<BiographyOnlinePhotoState>(EMPTY);
  const cache = deps.cache ?? createBiographyPhotoCache();
  const urls = new Map<Blob, string>();
  let signature = '';
  let shownKey = '';
  let clearedKey = '';
  let generation = 0;
  let disposed = false;
  let running = false;
  let pending = false;
  let forced = false;
  let blocked: { problem: BiographyPhotoProblem; retryAt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function key() {
    const artist = deps.artist ? store.get(deps.artist) : null;
    return artist
      ? lastfmArtistUrl(artist, deps.language ? store.get(deps.language) : 'en')
      : deps.artist
        ? ''
        : JSON.stringify(store.get(deps.source));
  }
  function sources(extra: readonly LastfmPhoto[] = []) {
    const primary = store.get(deps.source);
    const list = new Map<string | null, LastfmPhoto>();
    for (const source of [...(primary ? [primary] : []), ...extra]) {
      const id = lastfmPhotoId(source.url);
      if (!list.has(id)) list.set(id, source);
    }
    return [...list.values()];
  }
  function release() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }
  function photo(
    source: LastfmPhoto,
    entry: Extract<DecodedBiographyPhoto, { ok: true }>,
  ): BiographyPhoto {
    let url = urls.get(entry.blob);
    if (!url) {
      url = URL.createObjectURL(entry.blob);
      urls.set(entry.blob, url);
    }
    return {
      key: source.pageUrl,
      album: 'Last.fm',
      url,
      sourceUrl: source.pageUrl,
      pixels: entry.pixels,
    };
  }
  function publish(
    photos: readonly BiographyPhoto[],
    loading = false,
    problem: BiographyPhotoProblem | null = null,
  ) {
    if (disposed) return;
    if (!loading) {
      const used = new Set(photos.map((item) => item.url));
      for (const [blob, url] of urls) {
        if (!used.has(url)) {
          URL.revokeObjectURL(url);
          urls.delete(blob);
        }
      }
    }
    const bytes = sources(deps.artist ? cache.peekGallery(key()) : []).reduce(
      (sum, source) => sum + (cache.peekImage(source.url)?.blob.size ?? 0),
      0,
    );
    store.set(state, {
      photo: photos[0] ?? null,
      ...(photos.length ? { photos } : {}),
      loading,
      problem,
      bytes,
    });
  }
  async function load() {
    const artistUrl = key();
    if (!artistUrl || !store.get(deps.active) || !store.get(deps.ready) || clearedKey === artistUrl)
      return;
    const mine = generation;
    const current = () => !disposed && mine === generation;
    const fresh = forced;
    forced = false;
    const old = store.get(state).photos ?? [];
    if (blocked && blocked.retryAt > Date.now()) return publish(old, false, blocked.problem);
    blocked = null;
    let list = sources(deps.artist ? cache.peekGallery(artistUrl) : []);
    const photos: BiographyPhoto[] = [];
    const attempted = new Set<string>();
    let problem: BiographyPhotoProblem | null = null;
    const read = async (source: LastfmPhoto) => {
      if (!current()) return;
      attempted.add(source.pageUrl);
      const known = cache.peekImage(source.url);
      if (!known || fresh) publish(photos.length ? photos : old, true);
      const entry = await cache.image(
        source,
        fresh,
        deps.probe,
        fetch,
        deps.cache ? undefined : current,
      );
      if (!current()) return;
      if (!entry.ok) {
        problem = entry.problem;
        if (['blocked', 'rateLimited'].includes(entry.problem)) blocked = entry;
        const previous = old.find((item) => item.sourceUrl === source.pageUrl);
        if (previous) photos.push(previous);
      } else photos.push(photo(source, entry));
      publish(photos, true, problem);
    };
    if (list[0]) await read(list[0]);
    if (!current()) return;
    if (deps.artist && !blocked) {
      if (!cache.peekGallery(artistUrl) || fresh) publish(photos.length ? photos : old, true);
      const result = await cache.gallery(artistUrl, fresh, gallery);
      if (!current()) return;
      if (result.ok) list = sources(result.photos);
      else {
        problem = result.problem;
        if (['blocked', 'rateLimited'].includes(result.problem)) blocked = result;
      }
    }
    for (const source of list) {
      if (!current() || blocked) break;
      if (!attempted.has(source.pageUrl)) await read(source);
    }
    if (current()) publish(photos.length ? photos : old, false, problem);
  }
  async function pump() {
    if (disposed || running) return;
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
    const artistUrl = key();
    const active = store.get(deps.active);
    const ready = store.get(deps.ready);
    const next = JSON.stringify([artistUrl, store.get(deps.source), active, ready]);
    if (signature === next && !refresh) return;
    signature = next;
    generation += 1;
    pending = false;
    clearTimeout(timer);
    const same = shownKey === artistUrl;
    if (!same) {
      release();
      shownKey = artistUrl;
    }
    if (refresh) forced = true;
    if (!active || !artistUrl || artistUrl === 'null' || clearedKey === artistUrl) {
      release();
      store.set(state, EMPTY);
      return;
    }
    const previous = sources(deps.artist ? cache.peekGallery(artistUrl) : []).flatMap((source) => {
      const entry = cache.peekImage(source.url);
      return entry ? [photo(source, entry)] : [];
    });
    publish(previous.length ? previous : same ? (store.get(state).photos ?? []) : []);
    if (!ready) return;
    timer = setTimeout(
      () => {
        pending = true;
        void pump();
      },
      refresh || previous.length ? 0 : 300,
    );
  }
  const stops = [
    deps.source,
    deps.active,
    deps.ready,
    ...(deps.artist ? [deps.artist] : []),
    ...(deps.language ? [deps.language] : []),
  ].map((source) => store.sub(source, () => schedule()));
  schedule();
  return {
    state,
    refresh() {
      clearedKey = '';
      if (blocked && blocked.retryAt <= Date.now()) blocked = null;
      schedule(true);
    },
    clear() {
      clearedKey = key();
      generation += 1;
      clearTimeout(timer);
      pending = false;
      forced = false;
      if (!deps.cache) cache.clear();
      release();
      if (!disposed) store.set(state, EMPTY);
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      release();
      if (!deps.cache) cache.clear();
    },
  };
}
