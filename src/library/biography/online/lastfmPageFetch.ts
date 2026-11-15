import { fb } from 'foo-webview-sdk/bridge';
import { settleDetailed, type HostCallFailure } from '../../../host/hostCall.ts';
import { classifyHostHttpFailure } from '../../../host/hostHttpFailure.ts';
import { biographyHeader, biographyRetryAt } from '../biographyCacheFormat.ts';
import {
  lastfmArtistFromUrl,
  type BiographyFetchResult,
  type BiographyProblem,
} from '../biographyModel.ts';

/**
 * Last.fm 会把别名写法的艺人名 301 到规范名（简体→繁体、全半角等），而 SDK 的
 * `redirect: 'error'` 会把它当一般失败；所以网页请求在这里自己跟跳。只跟 last.fm
 * 同站地址，上限 N 跳；每跳仍由宿主做私网地址校验
 */
const MAX_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type LastfmPageAnswer = Awaited<ReturnType<(typeof fb)['http']['request']>>;

export type LastfmPageResult =
  | {
      readonly ok: true;
      readonly answer: LastfmPageAnswer;
      /** 跟完全部跳转后的 URL；没有跳转时就是请求的 URL */
      readonly finalUrl: string;
      /** 终跳地址认出的艺人名，认不出为 null；名字规范化跳转后是 Last.fm 的规范名 */
      readonly finalArtist: string | null;
    }
  | { readonly ok: false; readonly failure: HostCallFailure };

/** 裁掉页面后缀再认艺人名：+wiki、+images 与 +images/<id> */
function artistOfPage(url: string): string | null {
  const trimmed = url.replace(/\/\+wiki\/?$/, '').replace(/\/\+images(\/[a-f0-9]{32})?\/?$/, '');
  return lastfmArtistFromUrl(trimmed);
}

function redirectTarget(location: string, currentUrl: string): string | null {
  try {
    const next = new URL(location, currentUrl);
    return next.protocol === 'https:' && ['www.last.fm', 'last.fm'].includes(next.hostname)
      ? next.href
      : null;
  } catch {
    return null;
  }
}

/**
 * 经宿主请求一个 Last.fm 网页并在同站内跟随跳转。4xx/5xx 也照样交出，由调用方按
 * 状态归类。跟随失败（跳外站、缺 Location、超上限）也归 HostCallFailure，由调用方
 * 按一般网络失败处理
 */
export async function requestLastfmPage(
  url: string,
  host: Pick<typeof fb, 'http'> = fb,
): Promise<LastfmPageResult> {
  let currentUrl = url;
  for (let hop = 0; ; hop += 1) {
    const called = await settleDetailed(() =>
      host.http.request(currentUrl, {
        timeout: 12_000,
        redirect: 'manual',
        headers: {
          'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
          Accept: 'text/html',
        },
      }),
    );
    if (called.failure) return { ok: false, failure: called.failure };
    const answer = called.answer;
    if (answer.status === undefined || !REDIRECT_STATUSES.has(answer.status)) {
      return { ok: true, answer, finalUrl: currentUrl, finalArtist: artistOfPage(currentUrl) };
    }
    const location = biographyHeader(answer.headers ?? {}, 'location');
    const next = redirectTarget(location, currentUrl);
    if (!next || hop + 1 >= MAX_HOPS) {
      return {
        ok: false,
        failure: {
          text: next
            ? `Too many redirects from ${url}`
            : `Unfollowable redirect from ${currentUrl}`,
          code: null,
        },
      };
    }
    currentUrl = next;
  }
}

export type LastfmPageFailure = Extract<BiographyFetchResult, { ok: false }>;

/** 页面能用：状态是 200 或 404（404 是 Last.fm 没有这位艺人，由调用方按各自的形状处理） */
export interface LastfmPageUsable {
  readonly ok: true;
  readonly answer: LastfmPageAnswer;
  readonly finalArtist: string | null;
  /** 正文读不出来时交回的失败，与上面的状态归类共用同一份响应头与时刻 */
  readonly invalid: LastfmPageFailure;
}

/**
 * 按响应判页面能不能用，不能用的归类并定下一次重试的时刻。取简介与取详情都经它：Last.fm 限流、封禁与
 * 异常状态要退多久只在这里定，两处不会各退各的
 */
export function judgeLastfmPage(
  page: LastfmPageResult,
  now: number,
): LastfmPageUsable | LastfmPageFailure {
  const headers = (page.ok ? page.answer.headers : undefined) ?? {};
  const failure = (
    problem: BiographyProblem,
    delay: number,
    detail: string | null = null,
  ): LastfmPageFailure => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
    detail,
  });
  if (!page.ok)
    return failure(classifyHostHttpFailure(page.failure) ?? 'network', 30_000, page.failure.text);
  const { answer } = page;
  if (answer.status === 429) return failure('rateLimited', 60_000);
  if (answer.status === 403) return failure('blocked', 15 * 60_000);
  if (answer.status !== 200 && answer.status !== 404) return failure('network', 30_000);
  return {
    ok: true,
    answer,
    finalArtist: page.finalArtist,
    invalid: failure('invalid', 5 * 60_000),
  };
}
