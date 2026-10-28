import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { MusicError } from './musicError.ts';

const MAX_REDIRECTS = 3;
const OPEN_TIMEOUT_MS = 15_000;

/**
 * 上游禁止访问的安全限制网段：回环、私有内网、运营商级 NAT、链路本地、组播与保留段
 * 198.18.0.0/15 不作拦截：Clash 等代理的 fake-ip 模式常将域名映射至此网段，真实地址由代理解析
 */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE.addSubnet(network, prefix, 'ipv6');

/** IPv4 映射生成的 IPv6 地址按 IPv4 规则判断 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && !PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** 建立连接时校验 DNS 解析结果，确保实际连接的地址已通过公网安全检查，避免校验后地址漂移 */
function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const allowed = addresses.filter((item) => isPublicAddress(item.address));
    if (!allowed.length) {
      const refused: NodeJS.ErrnoException = new Error('上游地址指向内网');
      refused.code = 'EPRIVATE';
      return callback(refused, []);
    }
    const [first] = allowed;
    if (options.all || !first) return callback(null, allowed);
    callback(null, first.address, first.family);
  });
}

function get(
  url: URL,
  headers: http.OutgoingHttpHeaders,
  signal: AbortSignal,
  trustedOrigin: string | null,
) {
  return new Promise<IncomingMessage>((done, fail) => {
    const trusted = url.origin === trustedOrigin;
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (!trusted && isIP(literal) && !isPublicAddress(literal))
      return fail(new MusicError('unplayable'));
    const client = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!client || url.username || url.password) return fail(new MusicError('unplayable'));
    const request = client.get(url, {
      headers,
      signal,
      ...(trusted ? {} : { lookup: publicLookup }),
    });
    request.once('response', done);
    request.once('error', fail);
  });
}

/**
 * 打开上游音频地址并返回响应头就绪的 HTTP 应答，后续数据流由调用方读取
 * 逐级校验重定向链路；与 trustedOrigin 同源的地址豁免内网限制
 * 响应头在 OPEN_TIMEOUT_MS 内未返回时判定超时；时限仅约束响应头，不限制后续正文读取
 */
export async function openUpstream(
  address: string,
  range: string | undefined,
  signal: AbortSignal,
  trustedOrigin: string | null,
): Promise<IncomingMessage> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), OPEN_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, deadline.signal]);
  try {
    let url = new URL(address);
    for (let hop = 0; ; hop += 1) {
      const response = await get(url, range ? { Range: range } : {}, combined, trustedOrigin);
      const location = response.headers.location;
      if (!location || ![301, 302, 303, 307, 308].includes(response.statusCode ?? 0))
        return response;
      response.resume();
      if (hop >= MAX_REDIRECTS) throw new MusicError('unplayable');
      url = new URL(location, url);
    }
  } catch (error) {
    if (deadline.signal.aborted && !signal.aborted) throw new MusicError('timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
