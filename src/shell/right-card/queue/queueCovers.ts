import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { createQueueArtworkPool, type QueueImageIO } from './queueArtworkPool.ts';

export interface QueueCoversFace {
  artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'>;
}
export const ROW_COVER_SIZE = 36;
export const PREVIEW_COVER_SIZE = 288;
const CACHE_LIMIT = 400;
const CONCURRENT_IMAGES = 3;

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
  /** 可见时订阅；离屏撤回，没发出的取图任务随之取消。 */
  watch(path: string, size: number): () => void;
  dispose(): void;
}
interface ImageRequest {
  readonly path: string;
  readonly size: number;
}

/** 按可见范围取图，限制并发、尺寸与缓存；相同图片字节共享同一对象地址。 */
export function startQueueCovers(
  store: Store,
  host: QueueCoversFace = fb,
  io?: QueueImageIO,
): QueueCoversService {
  store.set(urlsAtom, new Map());
  const pool = createQueueArtworkPool(io);
  const active = new Map<string, number>();
  const pending = new Map<string, ImageRequest>();
  const asking = new Set<string>();
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
    for (const [key, url] of next) {
      if ((url && removed.has(url)) || (next.size > CACHE_LIMIT && !active.has(key))) {
        next.delete(key);
        changed = true;
      }
    }
    if (changed) store.set(urlsAtom, next);
  }

  async function ask(key: string, request: ImageRequest) {
    asking.add(key);
    const answer = await settle(() =>
      host.artwork.getFb2kUrlByPath(request.path, 'front', { maxSize: request.size }),
    );
    if (disposed) return;
    const url =
      answer?.success === true && answer.available ? await pool.load(answer.dataUrl) : null;
    asking.delete(key);
    if (disposed) return;
    const next = new Map(store.get(urlsAtom));
    next.delete(key);
    // 瞬时读取失败不记成永久缺图；离屏再进入时可以重新请求。
    if (url || (answer?.success === true && !answer.available)) next.set(key, url);
    store.set(urlsAtom, next);
    prune();
    pump();
  }

  function pump() {
    for (const [key, request] of pending) {
      if (disposed || asking.size >= CONCURRENT_IMAGES) break;
      pending.delete(key);
      if (active.has(key) && !asking.has(key)) void ask(key, request);
    }
  }

  return {
    watch(path, size) {
      if (disposed || !path) return () => {};
      const key = queueCoverKey(path, size);
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
        pending.set(key, { path, size });
        pump();
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
      pool.dispose();
    },
  };
}
