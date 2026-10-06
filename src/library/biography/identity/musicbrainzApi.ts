import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { biographyRetryAt } from '../biographyCacheFormat.ts';
import type { BiographyProblem } from '../biographyModel.ts';

export const MUSICBRAINZ_API_URL = 'https://musicbrainz.org/ws/2/';
/** MusicBrainz 要求每个客户端每秒最多一个请求，超了回 503；留 100 ms 余量。 */
export const MUSICBRAINZ_INTERVAL_MS = 1100;
/** 应答体上限，超出按无法解析处理。 */
const BODY_LIMIT = 2_000_000;

export type MusicbrainzResult =
  | { readonly kind: 'data'; readonly data: Readonly<Record<string, unknown>> }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly problem: BiographyProblem; readonly retryAt: number };

export interface MusicbrainzClient {
  /**
   * 排进全局队列发一次 GET。轮到它时 `alive()` 已经答 false（调用方换人或释放了）就不再发，
   * 直接答网络失败，调用方本来也会丢掉这个结果。
   */
  request(
    path: string,
    params: Readonly<Record<string, string>>,
    alive?: () => boolean,
  ): Promise<MusicbrainzResult>;
}

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

async function send(
  host: Pick<typeof fb, 'http'>,
  path: string,
  params: Readonly<Record<string, string>>,
): Promise<MusicbrainzResult> {
  const query = new URLSearchParams({ ...params, fmt: 'json' });
  const answer = await settle(() =>
    host.http.request(`${MUSICBRAINZ_API_URL}${path}?${query.toString()}`, {
      timeout: 15_000,
      redirect: 'error',
      headers: {
        // MusicBrainz 要求 UA 写明应用与联系方式，否则可能限速或拒绝。
        'User-Agent': 'foo-webview-default-theme/0.1 ( https://github.com/NereaFantasia )',
        Accept: 'application/json',
      },
    }),
  );
  const now = Date.now();
  const headers = answer?.headers ?? {};
  const fail = (problem: BiographyProblem, delay: number): MusicbrainzResult => ({
    kind: 'failed',
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
  });
  if (!answer) return fail('network', 30_000);
  if (answer.status === 404) return { kind: 'missing' };
  if (answer.status === 503 || answer.status === 429) return fail('rateLimited', 10_000);
  if (answer.status === 403) return fail('blocked', 15 * 60_000);
  if (answer.status !== 200) return fail(answer.status === 400 ? 'invalid' : 'network', 30_000);
  const data = readJson(answer.body);
  return data ? { kind: 'data', data } : fail('invalid', 5 * 60_000);
}

/** 一个装配一个客户端：所有 MusicBrainz 请求排成一列，相邻两次的开始至少隔 1.1 秒。 */
export function createMusicbrainzClient(
  host: Pick<typeof fb, 'http'> = fb,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): MusicbrainzClient {
  let queue: Promise<unknown> = Promise.resolve();
  let last = -Infinity;
  const pending = new Map<
    string,
    { readonly result: Promise<MusicbrainzResult>; readonly readers: (() => boolean)[] }
  >();
  return {
    request(path, params, alive = () => true) {
      const key = JSON.stringify([path, params]);
      const known = pending.get(key);
      if (known) {
        known.readers.push(alive);
        return known.result;
      }
      const readers = [alive];
      const run = queue
        .then(async (): Promise<MusicbrainzResult> => {
          if (!readers.some((current) => current()))
            return { kind: 'failed', problem: 'network', retryAt: 0 };
          const gap = last + MUSICBRAINZ_INTERVAL_MS - now();
          if (gap > 0) await wait(gap);
          if (!readers.some((current) => current()))
            return { kind: 'failed', problem: 'network', retryAt: 0 };
          last = now();
          return send(host, path, params);
        })
        .finally(() => pending.delete(key));
      pending.set(key, { result: run, readers });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
