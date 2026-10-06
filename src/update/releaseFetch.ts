import type { fb } from 'foo-webview-sdk/bridge';
import { sha256 } from './contract.ts';

/**
 * 经宿主取回清单与附件。请求由宿主发出，不受跨域限制；宿主的 WinHTTP 会还原传输压缩，所以哈希与
 * 大小一律按收到的字节核对，不信响应头。
 */

export type FetchProblem =
  /** 连不上、超时或域名解析失败。 */
  | 'offline'
  /** 宿主拒绝解析到本机或内网地址的域名：多半是本机代理或 hosts 改写了解析。 */
  | 'proxy'
  /** 证书日期无效，多半是系统时间不对。 */
  | 'clock'
  /** 其他证书问题。 */
  | 'tls'
  /** 状态码不是 200；404 可能是附件还没传完或 CDN 节点未同步。 */
  | 'status'
  /** 内容长度与清单不符，或超过上限。 */
  | 'size'
  | 'hash';
export type Fetched<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: FetchProblem; readonly detail?: string };

export type ReleaseHttp = Pick<typeof fb.http, 'request'>;

const TIMEOUT_MS = 30_000;
const HEADERS = { 'Cache-Control': 'no-cache' } as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 宿主只在错误文字里写出 WinHTTP 的原因，证书日期之类只能按文字认。 */
function classify(error: unknown): Fetched<never> {
  const message = error instanceof Error ? error.message : String(error);
  const response: unknown = record(error) ? error.response : undefined;
  const code = record(response) ? response.code : undefined;
  if (code === 'PERMISSION_DENIED' || /private|local network/i.test(message))
    return { ok: false, problem: 'proxy', detail: message };
  if (/certificate date/i.test(message)) return { ok: false, problem: 'clock', detail: message };
  if (/TLS|SSL|certificate/i.test(message)) return { ok: false, problem: 'tls', detail: message };
  return { ok: false, problem: 'offline', detail: message };
}

async function request(
  http: ReleaseHttp,
  url: string,
): Promise<Fetched<{ status: number; body: ArrayBuffer }>> {
  try {
    const answer = await http.request(url, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_MS,
      headers: { ...HEADERS },
    });
    return {
      ok: true,
      value: { status: answer.status ?? 0, body: answer.body ?? new ArrayBuffer(0) },
    };
  } catch (error) {
    return classify(error);
  }
}

/** 取一份文本（根清单）；状态码不是 200 或超过上限都算失败，内容由调用方验签后再用。 */
export async function fetchText(
  http: ReleaseHttp,
  url: string,
  limit: number,
): Promise<Fetched<string>> {
  const answer = await request(http, url);
  if (!answer.ok) return answer;
  if (answer.value.status !== 200)
    return { ok: false, problem: 'status', detail: String(answer.value.status) };
  if (answer.value.body.byteLength > limit) return { ok: false, problem: 'size' };
  return { ok: true, value: new TextDecoder().decode(answer.value.body) };
}

/** 取一个附件并按清单核对：给了 size 时长度必须相等，否则不能超过 limit；哈希必须一致。 */
export async function fetchVerified(
  http: ReleaseHttp,
  url: string,
  expected: { readonly sha256: string; readonly size?: number; readonly limit: number },
): Promise<Fetched<Uint8Array<ArrayBuffer>>> {
  const answer = await request(http, url);
  if (!answer.ok) return answer;
  if (answer.value.status !== 200)
    return { ok: false, problem: 'status', detail: String(answer.value.status) };
  const bytes = new Uint8Array(answer.value.body);
  if (
    bytes.length > expected.limit ||
    (expected.size !== undefined && bytes.length !== expected.size)
  )
    return { ok: false, problem: 'size', detail: String(bytes.length) };
  if ((await sha256(bytes)) !== expected.sha256) return { ok: false, problem: 'hash' };
  return { ok: true, value: bytes };
}
