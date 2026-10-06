import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';

/** 在线来源用到的宿主接口：请求由宿主发出，不受跨域限制，本地与内网地址宿主不放行。 */
export type LyricsHttpHost = { readonly http: Pick<typeof fb.http, 'request'> };

export interface LyricsHttpAnswer {
  readonly status: number;
  readonly body: string;
}

/** 开放接口（LRCLIB、lrcmux）请调用方在 UA 里写明应用名与主页。 */
export const OPEN_API_HEADERS = {
  'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
} as const;

/** 应答体上限，超出按失败处理；最大的是 AMLL TTML DB 的索引，约 1.6 MB。 */
const BODY_LIMIT = 8_000_000;
const TIMEOUT_MS = 12_000;

/**
 * 发一个 GET。网络失败、超时或应答过大答 null；HTTP 错误码照样交回，由各来源判断是「没有」还是「失败」。
 * 宿主跟随重定向后不再带请求头，调用方一律给 https 地址。
 */
export async function lyricsGet(
  host: LyricsHttpHost,
  url: string,
  headers: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<LyricsHttpAnswer | null> {
  if (signal?.aborted) return null;
  const answer = await settle(() =>
    host.http.request(url, { timeout: TIMEOUT_MS, headers: { ...headers } }),
  );
  if (signal?.aborted) return null;
  if (!answer || typeof answer.body !== 'string' || answer.body.length > BODY_LIMIT) return null;
  return { status: answer.status ?? 0, body: answer.body };
}

/** 解析 JSON 应答；不是对象或数组时答 null。外部数据，调用方逐字段校验后再用。 */
export function lyricsJson(answer: LyricsHttpAnswer | null): unknown {
  if (!answer) return null;
  try {
    const value: unknown = JSON.parse(answer.body);
    return typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** 取对象上的一项；不是对象时答 undefined。 */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** 把写成一整串的艺人栏拆开，分隔照 Lyricify 对 LRCLIB 的处理：「, 」「 & 」「 feat. 」「 ft. 」。 */
export function splitArtistField(text: string): string[] {
  return text.split(/, | & | feat\. | ft\. /).filter(Boolean);
}

/** 下面三个把外部值收成确定的类型，类型不对时给空值。 */
export const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

export const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
