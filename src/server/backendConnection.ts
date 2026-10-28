import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { settle } from '../host/hostCall.ts';
import {
  BACKEND_PROTOCOL,
  isBackendId,
  readBackendDescriptor,
  readBackendHealth,
  type BackendDescriptor,
  type BackendHealth,
  type BackendIdentity,
} from './backendProtocol.ts';

export interface BackendLaunch extends BackendIdentity {
  readonly directory: string;
  readonly executable: string;
  readonly entry: string;
  readonly runtimeVersion: string;
  readonly runtimeArch: string;
}

/** 手动起的后端：页面只知道端口与令牌，这次启动的身份向它的健康检查学 */
export interface ManualBackendTarget {
  readonly port: number;
  readonly token: string;
}

export interface BackendConnectionHost {
  readonly shell: Pick<typeof fb.shell, 'spawn'>;
  readonly file: Pick<typeof fb.file, 'read' | 'write'>;
  readonly on: typeof fb.on;
}

export interface BackendConnection {
  readonly failed: Atom<boolean>;
  /** 已连上的后端监听的端口，没连上时为 null。后端重新启动可能换端口，在线曲目的地址随之要改写 */
  readonly port: Atom<number | null>;
  /** 已连上的后端最近一次答的健康检查（后端版本、Node 版本），没连上时为 null */
  readonly health: Atom<BackendHealth | null>;
  connect(target: BackendLaunch): Promise<BackendHealth>;
  /** 连手动起的后端（页面来源不是安装目录时引导不工作）；健康检查拿不到身份时答 false */
  connectManual(target: ManualBackendTarget): Promise<boolean>;
  request(path: string, body?: unknown, options?: BackendRequestOptions): Promise<unknown>;
  dispose(): void;
}

export interface BackendRequestOptions {
  readonly signal?: AbortSignal;
  /** 毫秒；省略时沿用后端事务的两分钟等待时间 */
  readonly timeoutMs?: number;
}

/** 载荷仍是未知数据，由对应协议校验；message 保留字符串错误的读取方式 */
export class BackendRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const error: unknown =
      typeof body === 'object' && body !== null ? Reflect.get(body, 'error') : null;
    super(typeof error === 'string' ? error : '本地后端请求失败');
  }
}

/** 巡检间隔，毫秒；连续 `HEALTH_MISSES` 次没答才判定后端已停，约 30 秒 */
const HEALTH_INTERVAL_MS = 10000;
const HEALTH_MISSES = 3;

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function health(
  descriptor: BackendDescriptor,
  signal: AbortSignal,
): Promise<BackendHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/health`, {
      headers: { Authorization: `Bearer ${descriptor.token}` },
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    });
    if (!response.ok) return null;
    return readBackendHealth(await response.json(), descriptor);
  } catch {
    return null;
  }
}

/** 连接只认当前安装和本次页面启动；释放时写独立停止标记，迟到的进程也能自行退出 */
export function startBackendConnection(
  store: Store,
  host: BackendConnectionHost = fb,
): BackendConnection {
  const failed = atom(false);
  const port = atom<number | null>(null);
  const latest = atom<BackendHealth | null>(null);
  const lifetime = new AbortController();
  let descriptor: BackendDescriptor | null = null;
  // 后端忙或系统刚从睡眠醒来时单次巡检会超时；连续几次都没答才算停了，答上一次或换了连接就重新计数
  let misses = 0;
  function connected(next: BackendDescriptor | null, answer: BackendHealth | null = null): void {
    descriptor = next;
    misses = 0;
    store.set(port, next?.port ?? null);
    store.set(latest, next ? answer : null);
  }
  let launch: { readonly target: BackendLaunch; readonly id: string } | null = null;
  let running: Promise<BackendHealth> | null = null;
  let runningKey = '';
  let off: (() => void) | undefined;
  let checking = false;
  function current(): void {
    if (lifetime.signal.aborted) throw new Error('后端连接已释放');
  }
  async function stop(): Promise<void> {
    const own = launch;
    if (own)
      await settle(() =>
        host.file.write(`${own.target.directory}\\state\\backend-stop-${own.id}.json`, '{}', {
          atomic: true,
        }),
      );
    connected(null);
  }
  async function read(target: BackendLaunch, launchId?: string): Promise<BackendDescriptor | null> {
    const answer = await settle(() =>
      host.file.read(
        `${target.directory}\\state\\backend-${launchId ? `run-${launchId}` : target.sessionId}.json`,
      ),
    );
    current();
    return answer && answer.success !== false
      ? readBackendDescriptor(json(answer.content), target)
      : null;
  }
  function matches(value: BackendHealth | null, target: BackendLaunch): value is BackendHealth {
    const path = (value: string) => value.replaceAll('/', '\\').toLowerCase();
    return (
      value !== null &&
      value.runtime === target.runtimeVersion &&
      value.arch === target.runtimeArch &&
      path(value.executable) === path(target.executable) &&
      path(value.entry) === path(target.entry)
    );
  }
  async function connect(target: BackendLaunch): Promise<BackendHealth> {
    current();
    off ??= host.on('app:beforeQuit', dispose);
    store.set(failed, false);
    const owned =
      launch && JSON.stringify(launch.target) === JSON.stringify(target)
        ? await read(target, launch.id)
        : null;
    const existing = owned ?? (await read(target));
    if (existing) {
      const answer = await health(existing, lifetime.signal);
      current();
      launch = { target, id: existing.launchId };
      if (matches(answer, target)) {
        connected(existing, answer);
        launch = { target, id: existing.launchId };
        return answer;
      }
    }
    await stop();
    current();
    const id = crypto.randomUUID();
    launch = { target, id };
    const started = await settle(() =>
      host.shell.spawn(target.executable, {
        args: [
          target.entry,
          '--directory',
          target.directory,
          '--install-id',
          target.installId,
          '--session-id',
          target.sessionId,
          '--launch-id',
          id,
        ],
        cwd: target.directory,
        hidden: true,
        waitForExitMs: 0,
      }),
    );
    if (lifetime.signal.aborted) {
      await stop();
      current();
    }
    if (!started || started.success === false) throw new Error('无法启动本地后端');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const found = await read(target, id);
      if (found?.launchId === id && found.pid === started.processId) {
        const answer = await health(found, lifetime.signal);
        current();
        if (matches(answer, target)) {
          connected(found, answer);
          return answer;
        }
      }
      const error = await settle(() =>
        host.file.read(`${target.directory}\\state\\backend-error-${id}.json`),
      );
      current();
      if (error && error.success !== false) throw new Error('本地后端启动失败');
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      current();
    }
    throw new Error('本地后端连接超时');
  }
  /**
   * 手动起的后端没有可写停止标记的目录，断开只靠 `dispose`；与引导的连接互斥，后建的胜出（先停掉旧的）
   * 健康应答拿到身份后按完整描述登记，之后的周期健康检查照引导连接的同一口径核对
   */
  async function connectManual(target: ManualBackendTarget): Promise<boolean> {
    if (lifetime.signal.aborted) return false;
    if (
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535 ||
      !/^[0-9a-f]{64}$/.test(target.token)
    )
      return false;
    let value: unknown;
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/health`, {
        headers: { Authorization: `Bearer ${target.token}` },
        cache: 'no-store',
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]),
      });
      if (!response.ok) return false;
      value = await response.json();
    } catch {
      return false;
    }
    if (lifetime.signal.aborted) return false;
    if (
      !record(value) ||
      value.protocol !== BACKEND_PROTOCOL ||
      typeof value.version !== 'string' ||
      !isBackendId(value.installId) ||
      !isBackendId(value.sessionId) ||
      !isBackendId(value.launchId) ||
      typeof value.pid !== 'number' ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0
    )
      return false;
    if (launch) await stop();
    launch = null;
    off ??= host.on('app:beforeQuit', dispose);
    store.set(failed, false);
    const manual: BackendDescriptor = {
      protocol: BACKEND_PROTOCOL,
      version: value.version,
      installId: value.installId,
      sessionId: value.sessionId,
      launchId: value.launchId,
      pid: value.pid,
      port: target.port,
      token: target.token,
    };
    connected(manual, readBackendHealth(value, manual));
    return true;
  }
  const timer = setInterval(() => {
    if (!descriptor || checking || lifetime.signal.aborted) return;
    checking = true;
    const expected = descriptor;
    void health(expected, lifetime.signal)
      .then((answer) => {
        if (lifetime.signal.aborted || descriptor !== expected) return;
        misses = answer ? 0 : misses + 1;
        if (answer) store.set(latest, answer);
        if (misses >= HEALTH_MISSES) store.set(failed, true);
      })
      .finally(() => {
        checking = false;
      });
  }, HEALTH_INTERVAL_MS);
  function dispose(): void {
    lifetime.abort();
    clearInterval(timer);
    off?.();
    void stop();
  }
  function request(target: BackendLaunch): Promise<BackendHealth> {
    const key = JSON.stringify(target);
    if (running) {
      if (runningKey === key) return running;
      return running.catch(() => {}).then(() => request(target));
    }
    runningKey = key;
    running = connect(target)
      .catch(async (error: unknown) => {
        await stop();
        if (!lifetime.signal.aborted) store.set(failed, true);
        throw error;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  return {
    failed: atom((get) => get(failed)),
    port: atom((get) => get(port)),
    health: atom((get) => get(latest)),
    connect: request,
    connectManual,
    async request(path, body = {}, options = {}) {
      current();
      const signal = AbortSignal.any([
        lifetime.signal,
        AbortSignal.timeout(options.timeoutMs ?? 120000),
        ...(options.signal ? [options.signal] : []),
      ]);
      signal.throwIfAborted();
      const expected = descriptor;
      if (!expected || store.get(failed)) throw new Error('本地后端尚未连接');
      if (!/^\/[a-z]+(?:\/[a-z-]+)*$/.test(path)) throw new Error('本地后端请求路径无效');
      const response = await fetch(`http://127.0.0.1:${expected.port}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${expected.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal,
      });
      const value: unknown = await response.json().catch((error: unknown) => {
        if (response.ok) throw error;
        return null;
      });
      current();
      signal.throwIfAborted();
      if (descriptor !== expected) throw new Error('后端连接已改变');
      if (!response.ok) {
        throw new BackendRequestError(response.status, value);
      }
      return value;
    },
    dispose,
  };
}

/** 页面里读后端连接状态的地方（关于页的服务状态）经它取，不拿整个连接 */
export const backendStateKey =
  serviceKey<Pick<BackendConnection, 'failed' | 'port' | 'health'>>('backendState');
