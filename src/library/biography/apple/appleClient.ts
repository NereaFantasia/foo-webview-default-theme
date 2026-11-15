import { fb } from 'foo-webview-sdk/bridge';
import { settleDetailed, type HostCallFailure } from '../../../host/hostCall.ts';
import { classifyHostHttpFailure } from '../../../host/hostHttpFailure.ts';
import { biographyHeader, biographyRetryAt } from '../biographyCacheFormat.ts';
import type { BiographyProblem } from '../biographyModel.ts';

const ITUNES_URL = 'https://itunes.apple.com/';
/** iTunes 搜索与 Lookup 官方限额约每分钟 20 次，两者按同一份算，留出余量 */
export const APPLE_API_BUDGET = 15;
export const APPLE_API_WINDOW_MS = 60_000;
/** 艺人页没有公开限额，探针里隔 3 秒连续 15 次无异常 */
export const APPLE_PAGE_INTERVAL_MS = 3000;
/** 艺人页平均约 4.5 秒，偶有 9 到 15 秒，连接还会被重置，不能照 Last.fm 页面的 12 秒 */
const PAGE_TIMEOUT_MS = 30_000;
/** 提前取到的页面等待被取页调用使用的最长保留时间。身份认定通常在几秒内出结果，保留过久的页面不如重新取 */
export const PREFETCH_KEEP_MS = 30_000;
const API_TIMEOUT_MS = 15_000;
const API_BODY_LIMIT = 4_000_000;
const PAGE_BODY_LIMIT = 2_000_000;
/** 不带名字的艺人页地址会跳到带名字的规范地址，只跟随同站，上限这么多跳 */
const MAX_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface AppleFailure {
  readonly kind: 'failed';
  readonly problem: BiographyProblem;
  readonly retryAt: number;
  /** 传输失败的宿主原文；HTTP 层失败（403、429 等）没有原文 */
  readonly detail?: string | null;
}

export type AppleApiResult = { readonly kind: 'data'; readonly data: unknown } | AppleFailure;

export type ApplePageAnswer =
  | {
      readonly kind: 'page';
      readonly html: string;
      /** 跟完全部跳转后的地址 */
      readonly finalUrl: string;
    }
  | { readonly kind: 'missing' }
  | AppleFailure;

/** Apple 只给默认语言与英文两种：cn 区的默认语言是中文，其余界面语言都按英文取 */
export type AppleLanguage = 'zh' | 'en';

export interface AppleClient {
  /**
   * 按艺人名搜艺人，用 cn 区；排进限额队列，轮到时调用方已放弃（`alive()` 为 false）就不发。
   * `language` 为 `en` 时请求带 `lang=en_us`，只让曲风名变成英文；艺人名是 Apple 登记的原名，不随它变
   */
  search(term: string, alive?: () => boolean, language?: AppleLanguage): Promise<AppleApiResult>;
  /** 一次取多位艺人名下的专辑；`limit` 按每位艺人各算 */
  lookup(ids: readonly string[], alive?: () => boolean): Promise<AppleApiResult>;
  /** 取艺人页并在 music.apple.com 站内跟随跳转。`prefetch` 提前取过同一个地址的，直接使用它的结果 */
  page(url: string, alive?: () => boolean): Promise<ApplePageAnswer>;
  /**
   * 提前取艺人页：身份还在认定、但已经认准是哪一位时使用。认定出来后，真正取页的 `page` 直接使用这次的结果，少等一轮。
   * 结果只使用一次，最长保留 `PREFETCH_KEEP_MS`。没有被使用就丢弃，不当缓存
   */
  prefetch(url: string, alive?: () => boolean): void;
}

const CANCELLED: AppleFailure = { kind: 'failed', problem: 'network', retryAt: 0, detail: null };

/**
 * 一条串行队列加滑动窗口限额：任意 `windowMs` 内最多开始 `count` 个请求。同一个 `key` 在途时
 * 共用一次请求；排队的请求轮到时没有任何调用方还要结果，就直接放弃
 */
function createLane<T>(
  count: number,
  windowMs: number,
  now: () => number,
  wait: (ms: number) => Promise<void>,
  cancelled: T,
) {
  let queue: Promise<unknown> = Promise.resolve();
  const starts: number[] = [];
  const pending = new Map<
    string,
    { readonly result: Promise<T>; readonly readers: (() => boolean)[] }
  >();
  return {
    run(key: string, alive: () => boolean, task: () => Promise<T>): Promise<T> {
      const known = pending.get(key);
      if (known) {
        known.readers.push(alive);
        return known.result;
      }
      const readers = [alive];
      const wanted = () => readers.some((current) => current());
      const result = queue
        .then(async (): Promise<T> => {
          for (;;) {
            if (!wanted()) return cancelled;
            const time = now();
            while (starts.length && (starts[0] ?? 0) <= time - windowMs) starts.shift();
            if (starts.length < count) break;
            await wait((starts[0] ?? time) + windowMs - time);
          }
          starts.push(now());
          return task();
        })
        .finally(() => pending.delete(key));
      pending.set(key, { result, readers });
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

function headersOf(accept: string): Record<string, string> {
  return {
    'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
    Accept: accept,
  };
}

/** 归类一次没有得到正常应答的请求；状态码以外的失败交由宿主失败的细分处理 */
function failureOf(
  status: number | undefined,
  failure: HostCallFailure | null,
  headers: Readonly<Record<string, string>>,
  now: number,
): AppleFailure {
  const fail = (problem: BiographyProblem, delay: number, detail: string | null = null) => ({
    kind: 'failed' as const,
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
    detail,
  });
  if (failure) return fail(classifyHostHttpFailure(failure) ?? 'network', 30_000, failure.text);
  if (status === 429) return fail('rateLimited', 60_000);
  if (status === 403) return fail('blocked', 15 * 60_000);
  return fail('network', 30_000);
}

function sameSiteTarget(location: string, current: string): string | null {
  try {
    const next = new URL(location, current);
    return next.protocol === 'https:' && next.hostname === 'music.apple.com' && !next.port
      ? next.href
      : null;
  } catch {
    return null;
  }
}

/** 一个装配一个客户端：搜索与 Lookup 共用一份每分钟限额，艺人页另有间隔，两条队列互不等待 */
export function createAppleClient(
  host: Pick<typeof fb, 'http'> = fb,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): AppleClient {
  const api = createLane<AppleApiResult>(
    APPLE_API_BUDGET,
    APPLE_API_WINDOW_MS,
    now,
    wait,
    CANCELLED,
  );
  const pages = createLane<ApplePageAnswer>(1, APPLE_PAGE_INTERVAL_MS, now, wait, CANCELLED);
  // 提前取到的页面，等真正取页的调用使用。使用后即删，超时的也删
  const early = new Map<
    string,
    { readonly answer: Promise<ApplePageAnswer>; readonly at: number }
  >();

  function dropStale(): void {
    for (const [url, held] of early) if (now() - held.at > PREFETCH_KEEP_MS) early.delete(url);
  }

  /** 应答读不出（太大、不是 JSON、不是页面）：短时间内重试也一样，隔几分钟再说 */
  function invalid(): AppleFailure {
    return { kind: 'failed', problem: 'invalid', retryAt: now() + 5 * 60_000, detail: null };
  }

  async function getJson(url: string): Promise<AppleApiResult> {
    const called = await settleDetailed(() =>
      host.http.request(url, {
        timeout: API_TIMEOUT_MS,
        redirect: 'error',
        headers: headersOf('application/json'),
      }),
    );
    const answer = called.answer;
    if (called.failure || !answer || answer.status !== 200)
      return failureOf(answer?.status, called.failure ?? null, answer?.headers ?? {}, now());
    const body = answer.body;
    if (typeof body !== 'string' || body.length > API_BODY_LIMIT) return invalid();
    try {
      const data: unknown = JSON.parse(body);
      return { kind: 'data', data };
    } catch {
      return invalid();
    }
  }

  async function getPage(url: string): Promise<ApplePageAnswer> {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const called = await settleDetailed(() =>
        host.http.request(current, {
          timeout: PAGE_TIMEOUT_MS,
          redirect: 'manual',
          headers: headersOf('text/html'),
        }),
      );
      const answer = called.answer;
      if (called.failure || !answer) return failureOf(undefined, called.failure ?? null, {}, now());
      if (answer.status !== undefined && REDIRECT_STATUSES.has(answer.status)) {
        const next = sameSiteTarget(biographyHeader(answer.headers ?? {}, 'location'), current);
        if (!next || hop + 1 >= MAX_HOPS)
          return {
            kind: 'failed',
            problem: 'network',
            retryAt: now() + 30_000,
            detail: next
              ? `Too many redirects from ${url}`
              : `Unfollowable redirect from ${current}`,
          };
        current = next;
        continue;
      }
      if (answer.status === 404) return { kind: 'missing' };
      if (answer.status !== 200) return failureOf(answer.status, null, answer.headers ?? {}, now());
      const body = answer.body;
      return typeof body === 'string' && body.length <= PAGE_BODY_LIMIT
        ? { kind: 'page', html: body, finalUrl: current }
        : invalid();
    }
  }

  return {
    search(term, alive = () => true, language = 'zh') {
      const query = new URLSearchParams({
        term,
        entity: 'musicArtist',
        country: 'cn',
        limit: '20',
        ...(language === 'en' ? { lang: 'en_us' } : {}),
      });
      const url = `${ITUNES_URL}search?${query.toString()}`;
      return api.run(url, alive, () => getJson(url));
    },
    lookup(ids, alive = () => true) {
      // 艺人 ID 来自 iTunes 自己的应答并过了数字校验，逗号不转义，iTunes 认的是原样的逗号
      const url = `${ITUNES_URL}lookup?id=${ids.join(',')}&entity=album&country=cn&limit=200`;
      return api.run(url, alive, () => getJson(url));
    },
    page(url, alive = () => true) {
      dropStale();
      const held = early.get(url);
      early.delete(url);
      const fetchNow = () => pages.run(url, alive, () => getPage(url));
      if (!held) return fetchNow();
      // 提前取的那次因调用方放弃而没发出去时，这次自己取
      return held.answer.then((answer) => (answer === CANCELLED ? fetchNow() : answer));
    },
    prefetch(url, alive = () => true) {
      dropStale();
      if (early.has(url)) return;
      early.set(url, { answer: pages.run(url, alive, () => getPage(url)), at: now() });
    },
  };
}
