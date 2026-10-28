import type { PrefStorage } from '../kit/localPref.ts';
import type { ManualBackendTarget } from './backendConnection.ts';

/**
 * 页面装不进安装目录（开发服务器经 URL 覆盖加载）时，引导起不了后端；手动起的后端用
 * `?manual-backend=<端口>:<令牌>` 告诉页面一次，写进页面偏好，之后直接开。两者只认 64 位小写十六进制令牌
 */
const QUERY = 'manual-backend';
const KEY = 'default-theme.manual-backend.v1';

function readTarget(text: string | null): ManualBackendTarget | null {
  const match = /^(\d{1,5}):([0-9a-f]{64})$/.exec((text ?? '').trim());
  const port = Number(match?.[1]);
  const token = match?.[2] ?? '';
  return Number.isInteger(port) && port >= 1 && port <= 65535 && token ? { port, token } : null;
}

export { KEY as MANUAL_BACKEND_PREF };

/** 只看 URL 参数；开发服务器页可以据此显式指定一次，不影响偏好里的记录 */
export function readManualBackendQuery(url: URL): ManualBackendTarget | null {
  return readTarget(url.searchParams.get(QUERY));
}

/** 只读偏好，不看 URL；自动拉起失败时再用它 */
export function readManualBackendStored(storage: PrefStorage | null): ManualBackendTarget | null {
  return readTarget(storage?.getItem(KEY) ?? null);
}

/** URL 参数优先于偏好；参数有效就顺手更新偏好，无效的不覆盖已有偏好 */
export function readManualBackend(
  url: URL,
  storage: PrefStorage | null,
): ManualBackendTarget | null {
  const fromQuery = readManualBackendQuery(url);
  if (fromQuery) {
    storage?.setItem(KEY, `${fromQuery.port}:${fromQuery.token}`);
    return fromQuery;
  }
  return readManualBackendStored(storage);
}
