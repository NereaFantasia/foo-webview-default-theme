import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { biographyFreshness, biographyRetryAt } from '../biographyCacheFormat.ts';
import type { BiographyProblem } from '../biographyModel.ts';

export const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
/** 应答体上限，超出按无法解析处理。 */
const BODY_LIMIT = 1_000_000;
/** 服务端暂时出错：8 操作失败、11 服务下线、16 临时错误，过一会儿可以重试。 */
const RETRY_CODES = new Set([8, 11, 16]);

export type LastfmApiResult =
  | {
      readonly kind: 'data';
      readonly data: Readonly<Record<string, unknown>>;
      readonly store: boolean;
      readonly expiresAt: number;
    }
  | { readonly kind: 'missing'; readonly store: boolean; readonly expiresAt: number }
  | { readonly kind: 'failed'; readonly problem: BiographyProblem; readonly retryAt: number };

function readJson(body: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof body !== 'string' || body.length > BODY_LIMIT) return null;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : null;
  } catch {
    return null;
  }
}

/**
 * 调一次 Last.fm API（只读方法，不需要签名）。错误码按 https://www.last.fm/api/errorcodes 分类；
 * 出错时 Last.fm 有时回 200、有时回 4xx，所以先看应答体里的 `error`，再看 HTTP 状态。
 */
export async function requestLastfmApi(
  method: string,
  params: Readonly<Record<string, string>>,
  apiKey: string,
  host: Pick<typeof fb, 'http'> = fb,
): Promise<LastfmApiResult> {
  const query = new URLSearchParams({ method, ...params, api_key: apiKey, format: 'json' });
  const answer = await settle(() =>
    host.http.request(`${LASTFM_API_URL}?${query.toString()}`, {
      timeout: 12_000,
      redirect: 'error',
      headers: {
        'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
        Accept: 'application/json',
      },
    }),
  );
  const now = Date.now();
  const headers = answer?.headers ?? {};
  const fail = (problem: BiographyProblem, delay: number): LastfmApiResult => ({
    kind: 'failed',
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
  });
  if (!answer) return fail('network', 30_000);
  const data = readJson(answer.body);
  const code = data?.['error'];
  if (typeof code === 'number') {
    // 6 是参数无效；调用方总会带齐必填参数，这里它只表示查无此人。
    if (code === 6) return { kind: 'missing', ...biographyFreshness(headers, now) };
    if (code === 10) return fail('keyInvalid', 15 * 60_000);
    if (code === 26) return fail('keySuspended', 60 * 60_000);
    if (code === 29) return fail('rateLimited', 60_000);
    if (RETRY_CODES.has(code)) return fail('network', 30_000);
    return fail('invalid', 5 * 60_000);
  }
  if (answer.status === 429) return fail('rateLimited', 60_000);
  if (answer.status === 403) return fail('blocked', 15 * 60_000);
  if (answer.status !== 200) return fail('network', 30_000);
  if (!data) return fail('invalid', 5 * 60_000);
  return { kind: 'data', data, ...biographyFreshness(headers, now) };
}
