import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { settle } from '../host/hostCall.ts';
import {
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

export interface BackendConnectionHost {
  readonly shell: Pick<typeof fb.shell, 'spawn'>;
  readonly file: Pick<typeof fb.file, 'read' | 'write'>;
  readonly on: typeof fb.on;
}

export interface BackendConnection {
  readonly failed: Atom<boolean>;
  connect(target: BackendLaunch): Promise<BackendHealth>;
  request(path: string, body?: unknown): Promise<unknown>;
  dispose(): void;
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

/** 连接只认当前安装和本次页面启动；释放时写独立停止标记，迟到的进程也能自行退出。 */
export function startBackendConnection(
  store: Store,
  host: BackendConnectionHost = fb,
): BackendConnection {
  const failed = atom(false);
  const lifetime = new AbortController();
  let descriptor: BackendDescriptor | null = null;
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
    descriptor = null;
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
        descriptor = existing;
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
          descriptor = found;
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
  const timer = setInterval(() => {
    if (!descriptor || checking || lifetime.signal.aborted) return;
    checking = true;
    const expected = descriptor;
    void health(expected, lifetime.signal)
      .then((answer) => {
        if (!lifetime.signal.aborted && descriptor === expected && !answer) store.set(failed, true);
      })
      .finally(() => {
        checking = false;
      });
  }, 10000);
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
    connect: request,
    async request(path, body = {}) {
      current();
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
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000)]),
      });
      const value: unknown = await response.json();
      current();
      if (descriptor !== expected) throw new Error('后端连接已改变');
      if (!response.ok) {
        const error: unknown =
          typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : null;
        throw new Error(typeof error === 'string' ? error : '本地后端请求失败');
      }
      return value;
    },
    dispose,
  };
}
