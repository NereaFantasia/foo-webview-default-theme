import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * 把整首歌留在内存里，供整轨分析读取。分析要把同一首读好几遍（波形、分频与 BPM、DR），
 * 而宿主的解码接口都是自己打开地址，既不共用播放时已解出的数据，也不能边下边分析。
 * 因此由页面先通知后端留下这一首，后端把整首下载进内存一次，之后对这个地址的读取都从内存给出，不再各自向上游请求。
 * 地址不能变：宿主只对已入队的地址缓存了技术信息
 *
 * 播放时预取下一首（`onlinePrefetch.ts`）走同一条通知，下一首在当前这首播放期间就已下载进内存
 *
 * 只在页面通知时才下载：没有通知的曲目照旧逐次转发，fb2k 入队时的探测也不会触发整首下载。
 * 通知之后没有读者、又没下完时，过一段时间就撤掉（说明跳过了这首）。下完的保留一段时间，供重复的读取使用。
 * 长度未知或过大的不留，读取退回逐次向上游请求
 */

/** 单首最多留这么多字节，更大的（高解析无损）不留 */
const MAX_TRACK_BYTES = 256 * 1024 * 1024;
/** 同时留在内存里的曲目数上限。超出时按登记先后丢弃最早且没有读者的一首，因此预取下一首之后保留的是当前这首与下一首 */
const MAX_HELD = 2;
/** 没有读者时，没下完的等 `ABANDON_MS` 就撤掉，下完的保留 `KEEP_MS`，毫秒 */
const ABANDON_MS = 45_000;
const KEEP_MS = 3 * 60_000;
/** 上游中途断开后，等这么久再从已下载的字节处续传，毫秒。连续失败超过这几次就放弃，下载到新数据后重新计数 */
const RESUME_DELAYS_MS = [500, 1000, 2000];
/** 每次写给读者的最大字节数，使背压按这个粒度起作用 */
const WRITE_BYTES = 1024 * 1024;

/** 从 `offset` 起打开上游。应答必须正好从 `offset` 接上且总长已知，否则返回 null */
export type HoldOpener = (
  offset: number,
  signal: AbortSignal,
) => Promise<{ body: IncomingMessage; total: number; type: string | null } | null>;

interface Held {
  readonly key: string;
  readonly total: number;
  readonly type: string | null;
  /** 前 `filled` 字节有效，只增不改 */
  readonly data: Buffer;
  filled: number;
  state: 'filling' | 'done' | 'failed';
  readers: number;
  timer: NodeJS.Timeout | undefined;
  /** 中止这一首的下载。`signal` 还会随整个模块的释放一起中止 */
  readonly stop: AbortController;
  readonly signal: AbortSignal;
  readonly waiters: Set<() => void>;
}

type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/** 单段 Range，两端都含。没带或不认识的写法（多段）返回 null，按整首给出。落在整首之外返回 `unsatisfiable` */
function rangeOf(header: string | undefined, total: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const start = match[1] === '' ? Math.max(0, total - Number(match[2])) : Number(match[1]);
  const end =
    match[1] === '' || match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
  return start >= total || start > end ? 'unsatisfiable' : { start, end };
}

export function createTrackHold() {
  const lifetime = new AbortController();
  const held = new Map<string, Held>();
  /** 已通知、还没拿到上游应答的曲目。结果为 null 表示这首留不住 */
  const starting = new Map<string, Promise<Held | null>>();

  function notify(entry: Held): void {
    const wakes = [...entry.waiters];
    entry.waiters.clear();
    for (const wake of wakes) wake();
  }

  function discard(entry: Held): void {
    clearTimeout(entry.timer);
    if (held.get(entry.key) === entry) held.delete(entry.key);
    if (entry.state === 'filling') {
      entry.state = 'failed';
      entry.stop.abort();
    }
    notify(entry);
  }

  /** 没有读者时开始计时，到点撤掉。有读者时取消计时 */
  function arm(entry: Held): void {
    clearTimeout(entry.timer);
    if (entry.readers > 0 || held.get(entry.key) !== entry) return;
    entry.timer = setTimeout(
      () => discard(entry),
      entry.state === 'filling' ? ABANDON_MS : KEEP_MS,
    );
    entry.timer.unref();
  }

  /** 把上游读进内存直到读满。断开时从已读到的字节处续传，连续失败就放弃 */
  async function fill(entry: Held, first: IncomingMessage, open: HoldOpener): Promise<void> {
    const { signal } = entry;
    let body: IncomingMessage | null = first;
    try {
      for (let failures = 0; entry.filled < entry.total;) {
        try {
          if (!body) {
            const next = await open(entry.filled, signal);
            if (next?.total !== entry.total) {
              next?.body.destroy();
              throw new Error('续传接不上');
            }
            body = next.body;
          }
          for await (const chunk of body) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            const length = Math.min(bytes.length, entry.total - entry.filled);
            bytes.copy(entry.data, entry.filled, 0, length);
            entry.filled += length;
            failures = 0;
            notify(entry);
            if (entry.filled >= entry.total) break;
          }
        } catch {
          signal.throwIfAborted();
        }
        body?.destroy();
        body = null;
        if (entry.filled >= entry.total) break;
        if (failures >= RESUME_DELAYS_MS.length) throw new Error('上游不可用');
        await delay(RESUME_DELAYS_MS[failures] ?? 0, undefined, { signal });
        failures += 1;
      }
      entry.state = 'done';
    } catch {
      body?.destroy();
      discard(entry);
    } finally {
      notify(entry);
      arm(entry);
    }
  }

  /** 打开上游并登记。任何失败都只表示这首留不住，读取退回逐次转发，由那条路径报告错误 */
  async function begin(key: string, open: HoldOpener): Promise<Held | null> {
    const stop = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, stop.signal]);
    try {
      const opened = await open(0, signal);
      if (!opened || opened.total === 0 || opened.total > MAX_TRACK_BYTES) {
        opened?.body.destroy();
        return null;
      }
      const entry: Held = {
        key,
        total: opened.total,
        type: opened.type,
        data: Buffer.allocUnsafe(opened.total),
        filled: 0,
        state: 'filling',
        readers: 0,
        timer: undefined,
        stop,
        signal,
        waiters: new Set(),
      };
      held.set(key, entry);
      for (const old of held.values()) {
        if (held.size <= MAX_HELD) break;
        if (old !== entry && old.readers === 0) discard(old);
      }
      void fill(entry, opened.body, open);
      arm(entry);
      return entry;
    } catch {
      return null;
    }
  }

  function clear(): void {
    for (const entry of [...held.values()]) discard(entry);
  }

  const has = (key: string): boolean => held.has(key) || starting.has(key);

  async function reply(entry: Held, request: IncomingMessage, response: ServerResponse) {
    const range = rangeOf(request.headers.range, entry.total);
    if (range === 'unsatisfiable') {
      response.writeHead(416, {
        'Content-Range': `bytes */${entry.total}`,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: entry.total - 1 };
    response.writeHead(range ? 206 : 200, {
      ...(entry.type ? { 'Content-Type': entry.type } : {}),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${entry.total}` } : {}),
    });
    const gone = new Promise<void>((resolve) => response.once('close', resolve));
    entry.readers += 1;
    arm(entry);
    try {
      for (let at = start; at <= end;) {
        if (response.destroyed) return;
        if (at >= entry.filled) {
          if (entry.state === 'failed') {
            response.destroy();
            return;
          }
          await Promise.race([new Promise<void>((wake) => entry.waiters.add(wake)), gone]);
          continue;
        }
        const upto = Math.min(entry.filled, end + 1, at + WRITE_BYTES);
        const accepted = response.write(entry.data.subarray(at, upto));
        at = upto;
        if (!accepted) await Promise.race([once(response, 'drain'), gone]);
      }
      response.end();
    } catch {
      response.destroy();
    } finally {
      entry.readers -= 1;
      arm(entry);
    }
  }

  return {
    /** 这首已通知过：已在内存里，或正在下载 */
    has,
    /** 页面通知后端留下这一首。已经留着或正在下载时什么也不做。立即返回，下载在后台进行 */
    prepare(key: string, open: HoldOpener): void {
      if (has(key)) return;
      starting.set(
        key,
        begin(key, open).finally(() => starting.delete(key)),
      );
    },
    /**
     * 从内存里响应这一首的请求，还在等上游应答的就等待。
     * 这首没留住（长度未知、太大、已失败）时返回 false，调用方改走逐次转发，此时还没写任何响应
     */
    async serve(key: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const entry = held.get(key) ?? (await starting.get(key));
      if (!entry || entry.state === 'failed') return false;
      await reply(entry, request, response);
      return true;
    },
    /** 全部丢弃，在途的下载中止 */
    clear,
    dispose(): void {
      lifetime.abort();
      clear();
    },
  };
}
