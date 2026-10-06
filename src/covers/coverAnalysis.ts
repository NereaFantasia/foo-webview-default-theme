import { analyzeCoverPixels, samplePixels } from '../theme/coverColor.ts';
import type { CoverProfile } from '../theme/coverPalette.ts';
import { sameCoverPixels } from './sameCoverPixels.ts';

const CACHE_LIMIT = 32;
const PENDING_LIMIT = 32;

interface CachedProfile {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  readonly profile: CoverProfile;
}

export interface CoverAnalysisOptions {
  sample?: (url: string, signal: AbortSignal) => Promise<Uint8ClampedArray<ArrayBuffer> | null>;
  analyze?: typeof analyzeCoverPixels;
}

export interface CoverAnalysis {
  /** null 表示未取到图片；灰图返回档案，读取和分析失败则 reject。 */
  read(url: string): Promise<CoverProfile | null>;
  dispose(): void;
}

/** 单路分析、有限队列与 32 份最近档案；地址只合并进行中的请求，不作为永久封面身份。 */
export function createCoverAnalysis(options: CoverAnalysisOptions = {}): CoverAnalysis {
  const sample = options.sample ?? ((url, signal) => samplePixels(url, undefined, signal));
  const analyze = options.analyze ?? analyzeCoverPixels;
  const controller = new AbortController();
  const { signal } = controller;
  const cache: CachedProfile[] = [];
  const pending = new Map<string, Promise<CoverProfile | null>>();
  let tail: Promise<unknown> = Promise.resolve();

  async function load(url: string): Promise<CoverProfile | null> {
    signal.throwIfAborted();
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => request.abort(new Error('封面分析超时')), 10_000);
    try {
      return await readPixels(url, request.signal);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  async function readPixels(url: string, requestSignal: AbortSignal): Promise<CoverProfile | null> {
    const pixels = await sample(url, requestSignal);
    signal.throwIfAborted();
    requestSignal.throwIfAborted();
    if (!pixels) return null;
    const index = cache.findIndex((entry) => sameCoverPixels(entry.pixels, pixels, 0));
    if (index >= 0) {
      const [hit] = cache.splice(index, 1);
      cache.push(hit);
      return hit.profile;
    }
    // Worker 会接管输入缓冲；留一份原像素用于跨地址匹配。
    const retained = pixels.slice();
    const profile = await analyze(pixels, requestSignal);
    signal.throwIfAborted();
    requestSignal.throwIfAborted();
    cache.push({ pixels: retained, profile });
    if (cache.length > CACHE_LIMIT) cache.shift();
    return profile;
  }

  return {
    read(url) {
      if (signal.aborted) return Promise.reject(signal.reason);
      const existing = pending.get(url);
      if (existing) return existing;
      if (pending.size >= PENDING_LIMIT) return Promise.reject(new Error('封面分析队列已满'));
      const task = tail.then(() => load(url)).finally(() => pending.delete(url));
      pending.set(url, task);
      tail = task.catch(() => {});
      return task;
    },
    dispose() {
      controller.abort(new Error('封面分析已停止'));
      cache.length = 0;
      pending.clear();
    },
  };
}

/** 页面生命周期内共享；关闭强调色不清缓存，其他背景消费者仍可读取。 */
export const coverAnalysis = createCoverAnalysis();
