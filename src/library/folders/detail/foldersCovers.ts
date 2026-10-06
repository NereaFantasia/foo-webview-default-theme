import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../../../host/artworkSize.ts';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { CoverGate, type CoverOutcome } from '../../../covers/coverGate.ts';
import { foldersTreeAtom } from '../tree/foldersTree.ts';

interface FolderCover {
  readonly url: string;
  readonly size: number;
  readonly previous?: string;
}
const versionAtom = atom(0);
export const foldersCoversVersionAtom = atom((get) => get(versionAtom));
export interface FoldersCoversService {
  coverOf(path: string, width: number): FolderCover | undefined;
  acquire(path: string): boolean;
  settle(path: string, outcome: CoverOutcome): void;
  wait(retry: () => void): () => void;
  dispose(): void;
}

/** 目录以实际首曲取图，不依赖专辑标签；图片加载名额与重试共用封面闸门。 */
export function startFoldersCovers(
  store: Store,
  host: Pick<typeof fb, 'artwork' | 'isAvailable'> = fb,
): FoldersCoversService {
  const cache = new Map<string, FolderCover>();
  const pending = new Set<string>();
  const declined = new Map<string, number>();
  let generation = store.get(foldersTreeAtom).generation;
  let serial = 0;
  let disposed = false;
  const bump = () => store.set(versionAtom, (value) => value + 1);
  const gate = new CoverGate({ limit: 24, retryDelays: [5000, 5000], onCooled: bump });
  function reset() {
    serial += 1;
    cache.clear();
    pending.clear();
    declined.clear();
    gate.reset();
    bump();
  }
  const off = store.sub(foldersTreeAtom, () => {
    const next = store.get(foldersTreeAtom).generation;
    if (next !== generation) {
      generation = next;
      reset();
    }
  });
  async function load(path: string, size: number, mine: number) {
    const answer = await settle(() =>
      host.artwork.getFb2kUrlByPath(path, 'front', { maxSize: size }),
    );
    if (disposed || mine !== serial) return;
    pending.delete(path);
    const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
    const old = cache.get(path);
    if (!url && old?.url) {
      declined.set(path, size);
      return;
    }
    cache.set(path, {
      url,
      size,
      ...(old?.url && gate.isShown(path) ? { previous: old.url } : {}),
    });
    if (old) gate.refresh(path);
    if (cache.size > 512) {
      for (const key of cache.keys()) {
        if (!pending.has(key) && key !== path) {
          cache.delete(key);
          declined.delete(key);
          break;
        }
      }
    }
    bump();
  }
  return {
    coverOf(path, width) {
      const size = artworkRequestSize(
        width,
        typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      );
      const known = cache.get(path);
      if (
        !disposed &&
        host.isAvailable() &&
        !pending.has(path) &&
        path &&
        (!known || (known.url && size > known.size && size > (declined.get(path) ?? 0)))
      ) {
        pending.add(path);
        const mine = serial;
        queueMicrotask(() => {
          if (!disposed && mine === serial) void load(path, size, mine);
        });
      }
      if (!known?.url) return known;
      if (gate.blocked(path)) return undefined;
      const attempt = gate.attempt(path);
      return {
        ...known,
        url:
          attempt > 0
            ? `${known.url}${known.url.includes('?') ? '&' : '?'}retry=${attempt}`
            : known.url,
      };
    },
    acquire: (path) => !disposed && gate.acquire(path),
    settle(path, outcome) {
      if (disposed) return;
      const known = cache.get(path);
      if (outcome === 'error' && known?.previous) {
        declined.set(path, known.size);
        cache.set(path, { url: known.previous, size: known.size });
        gate.settle(path, 'abandon');
        gate.restore(path);
        bump();
        return;
      }
      const attempt = gate.attempt(path);
      const phase = gate.settle(path, outcome);
      if (known && phase === 'shown') {
        cache.set(path, {
          size: known.size,
          url:
            attempt > 0
              ? `${known.url}${known.url.includes('?') ? '&' : '?'}retry=${attempt}`
              : known.url,
        });
        if (attempt > 0 || known.previous) bump();
      }
      if (known && phase === 'failed') {
        cache.set(path, { url: '', size: known.size });
        bump();
      }
    },
    wait: (retry) => gate.wait(retry),
    dispose() {
      disposed = true;
      off();
      serial += 1;
      gate.reset();
      cache.clear();
      pending.clear();
      declined.clear();
    },
  };
}
