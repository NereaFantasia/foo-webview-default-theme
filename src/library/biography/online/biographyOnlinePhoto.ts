import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { BiographyPhoto } from '../biographyPhotos.ts';
import {
  lastfmArtistUrl,
  type BiographyLanguage,
  type BiographyPhoto as SourcePhoto,
} from '../biographyModel.ts';
import {
  createBiographyPhotoCache,
  photoKey,
  type BiographyPhotoCache,
  type DecodedBiographyPhoto,
} from '../biographyPhotoCache.ts';
import { fetchApplePhoto } from './fetchApplePhoto.ts';
import {
  fetchLastfmPhoto,
  type BiographyPhotoProblem,
  type LastfmPhotoResult,
} from './fetchLastfmPhoto.ts';
import { fetchLastfmGallery } from './lastfmGallery.ts';
import { lastfmPhotoId, type LastfmPhoto } from './lastfmPhoto.ts';

/** 取一张在线照片的函数，按照片的来源分派 */
export type BiographyPhotoFetch = (photo: SourcePhoto) => Promise<LastfmPhotoResult>;

/** Apple 的照片带 `source: 'apple'`，Last.fm 的没有 */
const fetchSourcePhoto: BiographyPhotoFetch = (photo) =>
  photo.source === 'apple' ? fetchApplePhoto(photo) : fetchLastfmPhoto(photo);

export interface BiographyOnlinePhotoState {
  readonly photo: BiographyPhoto | null;
  readonly photos?: readonly BiographyPhoto[];
  readonly loading: boolean;
  readonly problem: BiographyPhotoProblem | null;
  /** problem 的宿主失败原文，只在内存里给界面诊断用 */
  readonly problemDetail?: string | null;
  readonly bytes: number;
}
export interface BiographyOnlinePhotoDeps {
  /** 简介里带的主图；Apple 只有这一张，Last.fm 另有相册 */
  readonly source: Atom<SourcePhoto | null>;
  readonly active: Atom<boolean>;
  readonly ready: Atom<boolean>;
  readonly probe: (url: string) => Promise<Uint8ClampedArray | null>;
  /** Last.fm 的艺人名，用来取相册；来源是 Apple 或没有时给 null */
  readonly artist?: Atom<string | null>;
  readonly language?: Atom<BiographyLanguage>;
  readonly cache?: BiographyPhotoCache;
}
const EMPTY: BiographyOnlinePhotoState = { photo: null, loading: false, problem: null, bytes: 0 };
/** 切换艺人后简介读自缓存、图却要联网时，停这么久再取，连续切换不会每位都下载图片 */
const SWITCH_DEBOUNCE_MS = 300;

export function startBiographyOnlinePhoto(
  store: ReturnType<typeof createStore>,
  deps: BiographyOnlinePhotoDeps,
  fetch: BiographyPhotoFetch = fetchSourcePhoto,
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
  // 上一次排程时简介是否已取完；简介服务没动静时就是取完的状态
  let wasReady = true;
  let blocked: {
    problem: BiographyPhotoProblem;
    retryAt: number;
    detail?: string | null;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function key() {
    const primary = store.get(deps.source);
    // Apple 只有一张，以艺人页地址为身份，没有相册
    if (primary?.source === 'apple') return primary.pageUrl;
    const artist = deps.artist ? store.get(deps.artist) : null;
    return artist
      ? lastfmArtistUrl(artist, deps.language ? store.get(deps.language) : 'en')
      : deps.artist
        ? ''
        : JSON.stringify(primary);
  }
  /** 缓存里已有的相册；Apple 没有相册，也不去取 */
  function galleryOf(artistUrl: string): readonly LastfmPhoto[] | undefined {
    return deps.artist && store.get(deps.source)?.source !== 'apple'
      ? cache.peekGallery(artistUrl)
      : undefined;
  }
  function sources(extra: readonly LastfmPhoto[] = []) {
    const primary = store.get(deps.source);
    const list = new Map<string | null, SourcePhoto>();
    for (const source of [...(primary ? [primary] : []), ...extra]) {
      const id = source.source === 'apple' ? photoKey(source) : lastfmPhotoId(source.url);
      if (!list.has(id)) list.set(id, source);
    }
    return [...list.values()];
  }
  function release() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }
  function photo(
    source: SourcePhoto,
    entry: Extract<DecodedBiographyPhoto, { ok: true }>,
  ): BiographyPhoto {
    let url = urls.get(entry.blob);
    if (!url) {
      url = URL.createObjectURL(entry.blob);
      urls.set(entry.blob, url);
    }
    return {
      key: source.pageUrl,
      album: source.source === 'apple' ? 'Apple Music' : 'Last.fm',
      url,
      sourceUrl: source.pageUrl,
      pixels: entry.pixels,
    };
  }
  function publish(
    photos: readonly BiographyPhoto[],
    loading = false,
    problem: BiographyPhotoProblem | null = null,
    problemDetail: string | null = null,
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
    const bytes = sources(galleryOf(key())).reduce(
      (sum, source) => sum + (cache.peekImage(photoKey(source))?.blob.size ?? 0),
      0,
    );
    store.set(state, {
      photo: photos[0] ?? null,
      ...(photos.length ? { photos } : {}),
      loading,
      problem,
      problemDetail,
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
    if (blocked && blocked.retryAt > Date.now())
      return publish(old, false, blocked.problem, blocked.detail ?? null);
    blocked = null;
    let list = sources(galleryOf(artistUrl));
    const photos: BiographyPhoto[] = [];
    const attempted = new Set<string>();
    let problem: BiographyPhotoProblem | null = null;
    let detail: string | null = null;
    const read = async (source: SourcePhoto) => {
      if (!current()) return;
      attempted.add(source.pageUrl);
      const known = cache.peekImage(photoKey(source));
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
        detail = entry.detail ?? null;
        if (['blocked', 'rateLimited'].includes(entry.problem)) blocked = entry;
        const previous = old.find((item) => item.sourceUrl === source.pageUrl);
        if (previous) photos.push(previous);
      } else photos.push(photo(source, entry));
      publish(photos, true, problem, detail);
    };
    if (list[0]) await read(list[0]);
    if (!current()) return;
    if (deps.artist && store.get(deps.source)?.source !== 'apple' && !blocked) {
      if (!cache.peekGallery(artistUrl) || fresh) publish(photos.length ? photos : old, true);
      const result = await cache.gallery(artistUrl, fresh, gallery);
      if (!current()) return;
      if (result.ok) list = sources(result.photos);
      else {
        problem = result.problem;
        detail = result.detail ?? null;
        if (['blocked', 'rateLimited'].includes(result.problem)) blocked = result;
      }
    }
    for (const source of list) {
      if (!current() || blocked) break;
      if (!attempted.has(source.pageUrl)) await read(source);
    }
    if (current()) publish(photos.length ? photos : old, false, problem, detail);
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
    // 简介刚联网取完（ready 从假变真）时不再等：这一位已经停够了，防抖只留给切换艺人时
    // 简介读自缓存、图还要联网的情形
    const justReady = ready && !wasReady;
    wasReady = ready;
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
    const previous = sources(galleryOf(artistUrl)).flatMap((source) => {
      const entry = cache.peekImage(photoKey(source));
      return entry ? [photo(source, entry)] : [];
    });
    publish(previous.length ? previous : same ? (store.get(state).photos ?? []) : []);
    if (!ready) return;
    timer = setTimeout(
      () => {
        pending = true;
        void pump();
      },
      refresh || previous.length || justReady ? 0 : SWITCH_DEBOUNCE_MS,
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
      // 被拒访问可能只是因为出口，主动刷新放行；限流仍等到期
      if (blocked && (blocked.retryAt <= Date.now() || blocked.problem === 'blocked'))
        blocked = null;
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
