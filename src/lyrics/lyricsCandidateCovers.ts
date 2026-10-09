import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { Store } from '../kit/store.ts';
import type { LyricsHttpHost } from './online/lyricsHttp.ts';
import type { LyricsCandidate } from './online/lyricsSource.ts';

export type LyricsCoverTarget = Pick<LyricsCandidate, 'source' | 'ref' | 'coverUrl'>;
export const lyricsCoverKey = (target: LyricsCoverTarget) =>
  JSON.stringify([target.source, target.ref, target.coverUrl ?? '']);

export interface LyricsCoverAccess {
  readonly state: Atom<ReadonlyMap<string, string>>;
  /** 可见图块借用封面，返回的函数在离开视口或卸载时释放借用。 */
  acquire(target: LyricsCoverTarget): () => void;
}

interface CoverEntry {
  readonly key: string;
  readonly target: LyricsCoverTarget;
  readonly controller: AbortController;
  borrowers: number;
  url: string | undefined;
  bytes: number;
}

const CONCURRENCY = 2;
const IDLE_LIMIT = 24;
const IDLE_BYTES = 4 * 1024 * 1024;
const IMAGE_BYTES = 1024 * 1024;

/** 地址查询和图片下载共用名额；缓存只在当前歌词检索主体内保留。 */
export function startLyricsCandidateCovers(
  store: Store,
  host: LyricsHttpHost,
  resolve: (target: LyricsCoverTarget, signal: AbortSignal) => Promise<string>,
) {
  const state = atom<ReadonlyMap<string, string>>(new Map());
  const entries = new Map<string, CoverEntry>();
  const queue = new Set<CoverEntry>();
  let running = 0;
  let disposed = false;

  function publish() {
    const ready = new Map<string, string>();
    for (const entry of entries.values()) if (entry.url) ready.set(entry.key, entry.url);
    const previous = store.get(state);
    if (previous.size === ready.size && [...ready].every(([key, url]) => previous.get(key) === url))
      return;
    store.set(state, ready);
  }
  function remove(entry: CoverEntry) {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    queue.delete(entry);
    entry.controller.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  function trim() {
    const idle = [...entries.values()].filter(
      (entry) => entry.borrowers === 0 && entry.url !== undefined,
    );
    let count = idle.length;
    let bytes = idle.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of idle) {
      if (count <= IDLE_LIMIT && bytes <= IDLE_BYTES) break;
      remove(entry);
      count--;
      bytes -= entry.bytes;
    }
    publish();
  }
  async function download(entry: CoverEntry): Promise<Blob | null> {
    const { target, controller } = entry;
    const address = target.coverUrl || (await resolve(target, controller.signal));
    if (!address || controller.signal.aborted) return null;
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    url.protocol = 'https:';
    if (target.source === 'netease' && url.hostname.endsWith('.music.126.net'))
      url.searchParams.set('param', '128y128');
    const answer = await settle(() =>
      host.http.request(url.href, {
        timeout: 12_000,
        responseType: 'arraybuffer',
        headers: target.source === 'netease' ? { Referer: 'https://music.163.com/' } : {},
      }),
    );
    if (controller.signal.aborted || !answer || answer.status !== 200 || !answer.body) return null;
    if (!answer.body.byteLength || answer.body.byteLength > IMAGE_BYTES) return null;
    const mime =
      Object.entries(answer.headers ?? {})
        .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
        ?.split(';')[0]
        ?.trim()
        .toLowerCase() ?? '';
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'].includes(mime))
      return null;
    return new Blob([answer.body], { type: mime });
  }
  function pump() {
    if (disposed) return;
    while (running < CONCURRENCY && queue.size) {
      const entry = queue.values().next().value;
      if (!entry) break;
      queue.delete(entry);
      if (!entry.borrowers || entry.controller.signal.aborted) continue;
      running++;
      void download(entry)
        .catch(() => null)
        .then((blob) => {
          if (disposed || entry.controller.signal.aborted || entries.get(entry.key) !== entry)
            return;
          entry.url = blob ? URL.createObjectURL(blob) : '';
          entry.bytes = blob?.size ?? 0;
          trim();
        })
        .finally(() => {
          running--;
          pump();
        });
    }
  }
  function pause() {
    for (const entry of [...entries.values()]) {
      if (entry.url === undefined) remove(entry);
    }
    publish();
  }
  function clear() {
    for (const entry of [...entries.values()]) remove(entry);
    publish();
  }
  return {
    state: atom((get) => get(state)),
    acquire(target: LyricsCoverTarget) {
      if (disposed) return () => {};
      const key = lyricsCoverKey(target);
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          key,
          target,
          controller: new AbortController(),
          borrowers: 0,
          url: undefined,
          bytes: 0,
        };
        queue.add(entry);
      }
      entries.delete(key);
      entries.set(key, entry);
      entry.borrowers++;
      // 延到微任务再发请求，连续的挂载、清理和重新挂载只使用最终仍有借用者的条目。
      queueMicrotask(pump);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.borrowers--;
        if (!entry.borrowers && entry.url === undefined) remove(entry);
        trim();
      };
    },
    pause,
    clear,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
