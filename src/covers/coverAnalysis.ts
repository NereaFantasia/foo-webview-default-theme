import { analyzeCoverPixels, samplePixels } from '../theme/coverColor.ts';
import type { CoverProfile } from '../theme/coverPalette.ts';
import { sameCoverPixels } from './sameCoverPixels.ts';

const CACHE_LIMIT = 32;
const PENDING_LIMIT = 32;
const REMEMBER_LIMIT = 512;

interface CachedProfile {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  readonly profile: CoverProfile;
}

/** 一个地址在队列里的请求。 */
interface QueuedRead {
  readonly task: Promise<CoverProfile | null>;
  readonly state: RequestState;
}

interface RequestState {
  /** 还要结果的读取者数；不带信号的读取者一直算。 */
  readers: number;
  started: boolean;
  /** 读取者都走了，轮到时直接放弃，不采样。 */
  skipped: boolean;
}

export interface CoverAnalysisOptions {
  sample?: (url: string, signal: AbortSignal) => Promise<Uint8ClampedArray<ArrayBuffer> | null>;
  analyze?: typeof analyzeCoverPixels;
}

export interface CoverAnalysis {
  /**
   * null 表示未取到图片；灰图返回档案，读取和分析失败则 reject。每次都重新采样，不凭地址复用。
   * `signal` 中止后，请求还没开始、也没有别的读取者要，就不再采样；已经开始的跑完，档案照样记下。
   */
  read(url: string, signal?: AbortSignal): Promise<CoverProfile | null>;
  /** 这个地址此前读成功的档案；不发请求。 */
  peek(url: string): CoverProfile | undefined;
  /** 丢掉按地址记的档案：地址背后的封面可能已经换了。 */
  forget(): void;
  dispose(): void;
}

/**
 * 单路分析、有限队列与 32 份最近的像素档案；`read` 只合并进行中的同地址请求。另按地址记 512 份档案
 * 供 `peek`：地址不是永久的封面身份，封面可能变了时由用到它的一方 `forget`。
 */
export function createCoverAnalysis(options: CoverAnalysisOptions = {}): CoverAnalysis {
  const sample = options.sample ?? ((url, signal) => samplePixels(url, undefined, signal));
  const analyze = options.analyze ?? analyzeCoverPixels;
  const controller = new AbortController();
  const { signal } = controller;
  const cache: CachedProfile[] = [];
  const remembered = new Map<string, CoverProfile>();
  const pending = new Map<string, QueuedRead>();
  let tail: Promise<unknown> = Promise.resolve();

  /** 放到最近用过的一端，超出上限从最久没用的删起。 */
  function remember(url: string, profile: CoverProfile): void {
    remembered.delete(url);
    remembered.set(url, profile);
    for (const oldest of remembered.keys()) {
      if (remembered.size <= REMEMBER_LIMIT) break;
      remembered.delete(oldest);
    }
  }

  async function load(url: string, state: RequestState): Promise<CoverProfile | null> {
    if (state.skipped) throw new Error('封面分析已取消');
    state.started = true;
    signal.throwIfAborted();
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => request.abort(new Error('封面分析超时')), 10_000);
    try {
      const profile = await readPixels(url, request.signal);
      if (profile) remember(url, profile);
      return profile;
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

  function enqueue(url: string): QueuedRead {
    const state: RequestState = { readers: 0, started: false, skipped: false };
    const task = tail
      .then(() => load(url, state))
      .finally(() => {
        // 放弃的请求已让位给同地址后来的新请求，不能把新的摘掉。
        if (pending.get(url) === request) pending.delete(url);
      });
    const request: QueuedRead = { task, state };
    pending.set(url, request);
    tail = task.catch(() => {});
    return request;
  }

  /** 一个读取者走了；都走了又没开始的请求作废，同地址再读时另排一个。 */
  function release(url: string, request: QueuedRead): void {
    const { state } = request;
    state.readers -= 1;
    if (state.readers > 0 || state.started) return;
    state.skipped = true;
    if (pending.get(url) === request) pending.delete(url);
  }

  return {
    read(url, readerSignal) {
      if (signal.aborted) return Promise.reject(signal.reason);
      if (readerSignal?.aborted) return Promise.reject(readerSignal.reason);
      const queued = pending.get(url);
      if (!queued && pending.size >= PENDING_LIMIT) {
        return Promise.reject(new Error('封面分析队列已满'));
      }
      const request = queued ?? enqueue(url);
      request.state.readers += 1;
      readerSignal?.addEventListener('abort', () => release(url, request), { once: true });
      return request.task;
    },
    peek(url) {
      const profile = remembered.get(url);
      if (profile) remember(url, profile);
      return profile;
    },
    forget() {
      remembered.clear();
    },
    dispose() {
      controller.abort(new Error('封面分析已停止'));
      cache.length = 0;
      remembered.clear();
      pending.clear();
    },
  };
}

/** 页面生命周期内共享；关闭强调色不清缓存，其他背景消费者仍可读取。 */
export const coverAnalysis = createCoverAnalysis();
