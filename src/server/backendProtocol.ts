/** 本地后端只为同一安装、本次页面启动和同一主题版本提供服务。 */
export const BACKEND_PROTOCOL = 1;
export const BACKEND_ORIGIN = 'https://foo-ui-webview2.local';

export interface BackendIdentity {
  readonly version: string;
  readonly installId: string;
  readonly sessionId: string;
}

export interface BackendDescriptor extends BackendIdentity {
  readonly protocol: typeof BACKEND_PROTOCOL;
  readonly launchId: string;
  readonly pid: number;
  readonly port: number;
  readonly token: string;
}

export interface BackendHealth extends BackendIdentity {
  readonly hostPid?: number;
  readonly protocol: typeof BACKEND_PROTOCOL;
  readonly launchId: string;
  readonly pid: number;
  readonly runtime: string;
  readonly arch: string;
  readonly executable: string;
  readonly entry: string;
}

export function isBackendId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identity(value: Record<string, unknown>, expected: BackendIdentity): boolean {
  return (
    value.protocol === BACKEND_PROTOCOL &&
    value.version === expected.version &&
    value.installId === expected.installId &&
    value.sessionId === expected.sessionId &&
    isBackendId(value.launchId) &&
    typeof value.pid === 'number' &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0
  );
}

export function readBackendDescriptor(
  value: unknown,
  expected: BackendIdentity,
): BackendDescriptor | null {
  if (
    !object(value) ||
    !identity(value, expected) ||
    typeof value.port !== 'number' ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.token) ||
    typeof value.launchId !== 'string' ||
    typeof value.pid !== 'number'
  )
    return null;
  return {
    ...expected,
    protocol: BACKEND_PROTOCOL,
    launchId: value.launchId,
    pid: value.pid,
    port: value.port,
    token: value.token,
  };
}

export function readBackendHealth(
  value: unknown,
  expected: BackendDescriptor,
): BackendHealth | null {
  if (
    !object(value) ||
    !identity(value, expected) ||
    value.pid !== expected.pid ||
    value.launchId !== expected.launchId ||
    typeof value.runtime !== 'string' ||
    typeof value.arch !== 'string' ||
    typeof value.executable !== 'string' ||
    typeof value.entry !== 'string'
  )
    return null;
  return {
    version: expected.version,
    installId: expected.installId,
    sessionId: expected.sessionId,
    protocol: BACKEND_PROTOCOL,
    launchId: expected.launchId,
    pid: expected.pid,
    runtime: value.runtime,
    arch: value.arch,
    ...(typeof value.hostPid === 'number' &&
    Number.isSafeInteger(value.hostPid) &&
    value.hostPid > 0
      ? { hostPid: value.hostPid }
      : {}),
    executable: value.executable,
    entry: value.entry,
  };
}
