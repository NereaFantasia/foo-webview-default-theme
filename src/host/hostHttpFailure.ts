import type { HostCallFailure } from './hostCall.ts';

/** http 调用失败里能向用户说清的小类；认不出的仍按一般断网处理 */
export type HostHttpFailureKind = 'dns' | 'localRelay';

// 宿主的失败原文（插件 HttpApi.cpp 的 DescribeWinHttpError 与 SSRF 检查的拒绝消息）
const DNS_NOT_RESOLVED = 'DNS name not resolved';
const LOCAL_NETWORK = ['local network address', 'local network is disabled'] as const;

/**
 * 把宿主 http 失败归到小类，认不出来的答 null。PERMISSION_DENIED 与其原文都只来自私网
 * 地址防护（插件 HttpApi.cpp 的 IsLocalNetworkUrl 与 IsResolvedAddressPrivate）：加速器或
 * hosts 把域名指到 127.0.0.1 这类玩法正是这一种。SDK 的同步失败路径带不出错误码，原文照样认
 */
export function classifyHostHttpFailure(failure: HostCallFailure): HostHttpFailureKind | null {
  if (
    failure.code === 'PERMISSION_DENIED' ||
    LOCAL_NETWORK.some((phrase) => failure.text.includes(phrase))
  )
    return 'localRelay';
  if (failure.text.includes(DNS_NOT_RESOLVED)) return 'dns';
  return null;
}
