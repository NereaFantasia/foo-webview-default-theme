import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  MUSIC_FAILURE_LIMIT,
  type MusicFailureCode,
  type MusicResource,
  type MusicStreamFailure,
  type MusicStreamFailures,
  type MusicStreamSource,
} from '../../src/server/musicProtocol.ts';
import {
  MUSIC_PLATFORMS,
  MUSIC_QUALITIES,
  type MusicQuality,
  type MusicRef,
} from '../../src/server/musicObjects.ts';
import type { LxSourceBook } from './lxSourceBook.ts';
import { MusicError } from './musicError.ts';
import { openUpstream } from './upstreamOpen.ts';

const CONTENT_TYPES = { mp3: 'audio/mpeg', flac: 'audio/flac' } as const;
// 播放器按 Content-Type 选解码器，不按内容识别：fb2k 收到 audio/mpeg 就当 MP3 解，FLAC 只放出开头一点就被跳过。
// 网易云的 CDN 把 FLAC 也标成 audio/mpeg，所以不用上游的类型，按取地址报告的实际档位给。
const QUALITY_TYPES: Readonly<Record<MusicQuality, string>> = {
  '128k': 'audio/mpeg',
  '320k': 'audio/mpeg',
  flac: 'audio/flac',
  flac24bit: 'audio/flac',
};

// 网易云的地址取到后 10～30 分钟内失效；超过 2 分钟就重取，暂停或拖动后再读也拿到新地址。
const FRESH_MS = 2 * 60_000;
const MAX_RESOLVING = 4;
// 一首歌最多换几个音源
const MAX_ATTEMPTS = 4;
// 上游中途断开后，等这么久再续传；连续失败超过这几次就结束响应，转发出数据后重新计数。
const RESUME_DELAYS_MS = [500, 1000, 2000];
const ROUTE = /^\/music\/stream\/([a-z]{2})\/([A-Za-z0-9_-]{1,64})\.(mp3|flac)$/;
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

/** 上游一次应答覆盖的字节段，两端都含；长度未知时 `end` 与 `total` 为 null。 */
interface Span {
  readonly start: number;
  readonly end: number | null;
  readonly total: number | null;
}

/** 416 和没有可读 Content-Range 的 206 答 null：不知道从哪接着要，不能续传。 */
function spanOf(response: IncomingMessage): Span | null {
  if (response.statusCode === 200) {
    const length = Number(response.headers['content-length']);
    return Number.isSafeInteger(length) && length >= 0
      ? { start: 0, end: length - 1, total: length }
      : { start: 0, end: null, total: null };
  }
  const match = CONTENT_RANGE.exec(response.headers['content-range'] ?? '');
  if (response.statusCode !== 206 || !match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

export interface MusicStreamOptions {
  /** `exclude` 是这次打开里已经试过、地址打不开的音源名；只有给出 `sourceName` 的来源会被换掉 */
  readonly resolve: (
    ref: MusicRef,
    quality: MusicQuality,
    signal: AbortSignal,
    exclude?: readonly string[],
  ) => Promise<MusicResource>;
  /** 用户配置的 lxserver 的源；它可能经自己转发音频，也可能装在内网，与它同源的地址不受内网限制。 */
  readonly trustedOrigin: () => string | null;
  /** 地址能不能打开的结果记进这里，取地址时据此先排除连续打不开的音源 */
  readonly book?: Pick<LxSourceBook, 'failed' | 'succeeded'>;
}

export function startMusicStream(options: MusicStreamOptions) {
  const lifetime = new AbortController();
  const cache = new Map<
    string,
    { readonly at: number; readonly resource: Promise<MusicResource> }
  >();
  let resolving = 0;
  const waiting: (() => void)[] = [];
  const failureLog: MusicStreamFailure[] = [];
  const sourceLog: MusicStreamSource[] = [];
  /** 最近一次打开时取到的是第三方补全地址的曲目，键是 `平台/ID`。 */
  const unblocked = new Set<string>();
  let latest = 0;

  function next(): { readonly seq: number; readonly at: number } {
    const at = Date.now();
    latest = Math.max(at, latest + 1);
    return { seq: latest, at };
  }

  function logFailure(ref: MusicRef, code: MusicFailureCode): void {
    failureLog.push({ ...next(), ref, code });
    if (failureLog.length > MUSIC_FAILURE_LIMIT) failureLog.shift();
  }

  /** 补全的每次都记，页面刷新后再放也认得出；不是补全的只在它上次是补全时记，免得入队时每首都记一条。 */
  function logSource(ref: MusicRef, isUnblocked: boolean): void {
    const key = `${ref.platform}/${ref.id}`;
    if (!isUnblocked && !unblocked.delete(key)) return;
    if (isUnblocked) unblocked.add(key);
    sourceLog.push({ ...next(), ref, unblocked: isUnblocked });
    if (sourceLog.length > MUSIC_FAILURE_LIMIT) sourceLog.shift();
  }

  /** fb2k 每入队一首就打开一次地址；限制同时取地址的数量，免得一次入队很多首时被平台限流。 */
  async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (resolving >= MAX_RESOLVING) await new Promise<void>((resume) => waiting.push(resume));
    resolving += 1;
    try {
      return await task();
    } finally {
      resolving -= 1;
      waiting.shift()?.();
    }
  }

  const cacheKey = (ref: MusicRef, quality: MusicQuality) =>
    JSON.stringify([ref.platform, ref.id, quality]);

  /**
   * 同一首同一档位同时打开多次只取一次；取地址失败的不留在缓存里。
   * `stale` 是续传时已经断过的那次结果，缓存里还是它就重取
   */
  function resolve(
    ref: MusicRef,
    quality: MusicQuality,
    stale?: Promise<MusicResource>,
    exclude: readonly string[] = [],
  ): Promise<MusicResource> {
    const key = cacheKey(ref, quality);
    const now = Date.now();
    for (const [old, entry] of cache) if (now - entry.at >= FRESH_MS) cache.delete(old);
    const hit = cache.get(key);
    if (hit && hit.resource !== stale) return hit.resource;
    const resource = limited(() => options.resolve(ref, quality, lifetime.signal, exclude));
    cache.set(key, { at: now, resource });
    resource.catch(() => {
      if (cache.get(key)?.resource === resource) cache.delete(key);
    });
    return resource;
  }

  const open = (address: string, range: string | undefined, signal: AbortSignal) =>
    openUpstream(address, range, signal, options.trustedOrigin());

  /**
   * 取地址并打开。lxserver 的音源只要拼出地址就算成功，不核对地址能不能播，所以打不开时
   * 把这个音源排除、重新取一次，最多试 `MAX_ATTEMPTS` 个。没报音源名的来源不换，照原样失败
   */
  async function openSource(
    ref: MusicRef,
    quality: MusicQuality,
    range: string | undefined,
    signal: AbortSignal,
  ) {
    const tried: string[] = [];
    let resource = resolve(ref, quality);
    for (let attempt = 1; ; attempt += 1) {
      let found: MusicResource;
      try {
        found = await resource;
      } catch (error) {
        // 换了音源之后取不到地址，是候选用完了，对外仍是地址打不开
        if (attempt > 1 && !signal.aborted) throw new MusicError('unplayable');
        throw error;
      }
      signal.throwIfAborted();
      logSource(ref, found.unblocked);
      let failure: unknown;
      try {
        const upstream = await open(found.url, range, signal);
        const status = upstream.statusCode ?? 502;
        if (status === 200 || status === 206 || status === 416) {
          if (found.sourceName) options.book?.succeeded(ref.platform, found.sourceName);
          return { resource, found, upstream };
        }
        upstream.resume();
        failure = new MusicError('unplayable');
      } catch (error) {
        signal.throwIfAborted();
        failure = error;
      }
      if (!found.sourceName) throw failure;
      // 打不开的地址不留在缓存里，fb2k 重试时也不会再拿到它
      const key = cacheKey(ref, quality);
      if (cache.get(key)?.resource === resource) cache.delete(key);
      options.book?.failed(ref.platform, found.sourceName);
      if (attempt >= MAX_ATTEMPTS) throw failure;
      tried.push(found.sourceName);
      resource = resolve(ref, quality, undefined, [...tried]);
    }
  }

  async function serve(
    request: IncomingMessage,
    response: ServerResponse,
    ref: MusicRef,
    quality: MusicQuality,
  ): Promise<void> {
    const client = new AbortController();
    const stop = () => client.abort();
    response.once('close', stop);
    const signal = AbortSignal.any([lifetime.signal, client.signal]);
    try {
      const opened = await openSource(ref, quality, request.headers.range, signal);
      const { upstream } = opened;
      let { resource } = opened;
      const status = upstream.statusCode ?? 502;
      // 实际档位未知（解灰、音源脚本没报）时不给类型，播放器按内容识别。
      const { actualQuality } = opened.found;
      const contentType = actualQuality === null ? null : QUALITY_TYPES[actualQuality];
      response.writeHead(status, {
        ...(contentType ? { 'Content-Type': contentType } : {}),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...(upstream.headers['content-length']
          ? { 'Content-Length': upstream.headers['content-length'] }
          : {}),
        ...(upstream.headers['content-range']
          ? { 'Content-Range': upstream.headers['content-range'] }
          : {}),
      });
      const span = spanOf(upstream);
      if (!span) {
        await pipeline(upstream, response, { signal });
        return;
      }
      // 上游中途断开时重新取地址，从已转发的字节处接着要；新应答必须正好接上，否则算一次失败。
      let body: IncomingMessage | null = upstream;
      let sent = 0;
      for (let failures = 0; ;) {
        try {
          if (!body) {
            resource = resolve(ref, quality, resource);
            const offset = span.start + sent;
            body = await open((await resource).url, `bytes=${offset}-${span.end ?? ''}`, signal);
            const next = spanOf(body);
            if (
              body.statusCode !== 206 ||
              next?.start !== offset ||
              (span.end !== null && next.end !== span.end) ||
              (span.total !== null && next.total !== span.total)
            ) {
              body.destroy();
              throw new MusicError('unplayable');
            }
          }
          for await (const chunk of body) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            failures = 0;
            sent += bytes.length;
            if (!response.write(bytes)) await once(response, 'drain', { signal });
          }
          if (span.end === null || sent > span.end - span.start) break;
        } catch {
          signal.throwIfAborted();
        }
        body = null;
        if (failures >= RESUME_DELAYS_MS.length) throw new MusicError('upstream-unavailable');
        await delay(RESUME_DELAYS_MS[failures], undefined, { signal });
        failures += 1;
      }
      response.end();
    } catch (error) {
      if (!signal.aborted)
        logFailure(ref, error instanceof MusicError ? error.code : 'upstream-unavailable');
      if (!response.headersSent) {
        response.writeHead(502, { 'Cache-Control': 'no-store' });
        response.end();
      } else response.destroy();
    } finally {
      response.off('close', stop);
    }
  }

  return {
    /** 只认 GET 与 HEAD；路径形如 `/music/stream/<平台>/<曲目 ID>.<扩展名>?q=<档位>`。 */
    handle(request: IncomingMessage, response: ServerResponse): void {
      request.resume();
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const match = ROUTE.exec(url.pathname);
      const platform = MUSIC_PLATFORMS.find((item) => item === match?.[1]);
      const quality = MUSIC_QUALITIES.find((item) => item === url.searchParams.get('q'));
      const extension = match?.[3] === 'flac' ? 'flac' : 'mp3';
      const id = match?.[2];
      if (!id || !platform || !quality || [...url.searchParams.keys()].length !== 1) {
        response.writeHead(404, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      const type = CONTENT_TYPES[extension];
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      void serve(request, response, { platform, id }, quality);
    },
    /** 已取到的地址都不再复用，下次打开时重取。 */
    clear(): void {
      cache.clear();
    },
    failures(after: number): MusicStreamFailures {
      return {
        latest,
        items: failureLog.filter((item) => item.seq > after),
        sources: sourceLog.filter((item) => item.seq > after),
      };
    },
    dispose(): void {
      lifetime.abort();
      cache.clear();
    },
  };
}
