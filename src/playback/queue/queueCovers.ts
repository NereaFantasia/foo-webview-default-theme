import { atom, type Atom } from 'jotai/vanilla';
import type { TrackArtwork } from '../../covers/trackArtwork.ts';
import { settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import { createQueueArtworkPool, type QueueImageIO } from './queueArtworkPool.ts';

export const ROW_COVER_SIZE = 36;
export const PREVIEW_COVER_SIZE = 288;
const CACHE_LIMIT = 400;
const CONCURRENT_IMAGES = 3;
/** 专辑的结论（取到的图、确认没有封面）各记多少条，超出从最早的删起 */
const ALBUM_LIMIT = 2000;

export function queueCoverSize(preview: boolean, pixelRatio: number): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return preview
    ? Math.min(512, Math.max(256, Math.ceil((PREVIEW_COVER_SIZE * ratio) / 128) * 128))
    : Math.min(128, Math.max(64, Math.ceil((ROW_COVER_SIZE * ratio) / 64) * 64));
}
export const queueCoverKey = (path: string, size: number) => JSON.stringify([path, size]);
const urlsAtom = atom<ReadonlyMap<string, string | null>>(new Map());
export const queueCoverUrlsAtom: Atom<ReadonlyMap<string, string | null>> = atom((get) =>
  get(urlsAtom),
);

export interface QueueCoversService {
  /**
   * 可见时订阅；离屏撤回，没发出的取图任务随之取消。`album` 是这首所属专辑的键：同一张专辑的同一档尺寸
   * 只向宿主要一次，其余曲目共用这张图，与封面墙、歌曲表一样按一张专辑一张封面；代表的那一首没有封面时，
   * 同专辑的各首退回各取各的。不给 `album` 就只管这一个路径
   */
  watch(path: string, size: number, album?: string): () => void;
  dispose(): void;
}
interface ImageRequest {
  readonly path: string;
  readonly size: number;
  /** 专辑加尺寸；没有专辑归属的曲目为空 */
  readonly group?: string;
}

/** 按可见范围取图，限制并发、尺寸与缓存；相同图片字节共享同一对象地址 */
export function startQueueCovers(
  store: Store,
  artwork: TrackArtwork,
  io?: QueueImageIO,
): QueueCoversService {
  store.set(urlsAtom, new Map());
  const pool = createQueueArtworkPool(io);
  const active = new Map<string, number>();
  const pending = new Map<string, ImageRequest>();
  const asking = new Set<string>();
  /** 同专辑同档尺寸已取到的图 */
  const shared = new Map<string, string>();
  /** 同专辑同档尺寸确认没有封面的：后来的曲目不再等它，各取各的 */
  const bare = new Set<string>();
  /** 正在向宿主要图的专辑：同专辑的别的曲目等这一首的结论，不另发请求，也不占名额 */
  const inflight = new Set<string>();
  let disposed = false;

  function prune() {
    const next = new Map(store.get(urlsAtom));
    let changed = false;
    const pinned = new Set(
      [...active.keys()].flatMap((key) => {
        const url = next.get(key);
        return url ? [url] : [];
      }),
    );
    const removed = new Set(pool.trim(pinned));
    // 回收掉的地址不能再发给后来的曲目
    for (const [group, url] of shared) if (removed.has(url)) shared.delete(group);
    for (const [key, url] of next) {
      if ((url && removed.has(url)) || (next.size > CACHE_LIMIT && !active.has(key))) {
        next.delete(key);
        changed = true;
      }
    }
    if (changed) store.set(urlsAtom, next);
  }

  /** 记下这一路的结论；`undefined` 是瞬时读取失败，不记成永久缺图，离屏再进入时可以重新请求 */
  function publish(key: string, url: string | null | undefined) {
    const next = new Map(store.get(urlsAtom));
    next.delete(key);
    if (url !== undefined) next.set(key, url);
    store.set(urlsAtom, next);
    prune();
  }

  function remember(group: string, url: string | null, missing: boolean) {
    if (url) {
      shared.delete(group);
      shared.set(group, url);
    } else if (missing) bare.add(group);
    for (const oldest of shared.keys()) {
      if (shared.size <= ALBUM_LIMIT) break;
      shared.delete(oldest);
    }
    for (const oldest of bare) {
      if (bare.size <= ALBUM_LIMIT) break;
      bare.delete(oldest);
    }
  }

  async function ask(key: string, request: ImageRequest) {
    asking.add(key);
    // 专辑已确认没有封面时，这一首是自取：它的图只属于它自己，不能记成整张专辑的
    const own = request.group !== undefined && bare.has(request.group);
    if (request.group && !own) inflight.add(request.group);
    const answer = await settle(() =>
      artwork.urlOf(request.path, 'front', { maxSize: request.size }),
    );
    if (disposed) return;
    const missing = answer?.success === true && !answer.available;
    const url =
      answer?.success === true && answer.available ? await pool.load(answer.dataUrl) : null;
    asking.delete(key);
    if (request.group && !own) inflight.delete(request.group);
    if (disposed) return;
    if (request.group && !own) remember(request.group, url, missing);
    publish(key, url !== null || missing ? url : undefined);
    pump();
  }

  function pump() {
    for (const [key, request] of pending) {
      if (disposed) break;
      if (!active.has(key) || asking.has(key)) {
        pending.delete(key);
        continue;
      }
      const { group } = request;
      if (group) {
        const url = shared.get(group);
        if (url) {
          pending.delete(key);
          pool.touch(url);
          publish(key, url);
          continue;
        }
        // 同专辑已有一首在取：等它的结论，是共用它的图，还是各取各的
        if (!bare.has(group) && inflight.has(group)) continue;
      }
      if (asking.size >= CONCURRENT_IMAGES) break;
      pending.delete(key);
      void ask(key, request);
    }
  }

  return {
    watch(path, size, album) {
      if (disposed || !path) return () => {};
      const key = queueCoverKey(path, size);
      const group = album ? JSON.stringify([album, size]) : undefined;
      active.set(key, (active.get(key) ?? 0) + 1);
      const known = store.get(urlsAtom);
      if (known.has(key)) {
        const url = known.get(key);
        if (url) pool.touch(url);
        const next = new Map(known);
        next.delete(key);
        next.set(key, known.get(key) ?? null);
        store.set(urlsAtom, next);
      }
      if (!known.has(key) && !asking.has(key)) {
        const url = group ? shared.get(group) : undefined;
        if (url) {
          pool.touch(url);
          publish(key, url);
        } else {
          pending.set(key, { path, size, group });
          pump();
        }
      }
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        const count = (active.get(key) ?? 1) - 1;
        if (count > 0) active.set(key, count);
        else {
          active.delete(key);
          pending.delete(key);
        }
        prune();
      };
    },
    dispose() {
      disposed = true;
      active.clear();
      pending.clear();
      shared.clear();
      bare.clear();
      inflight.clear();
      pool.dispose();
    },
  };
}
