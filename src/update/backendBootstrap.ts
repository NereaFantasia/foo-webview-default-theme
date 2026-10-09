import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { BackendConnection } from '../server/backendConnection.ts';
import { checkNodeRuntime, type RuntimeCheckHost } from '../server/runtimeCheck.ts';
import {
  BACKEND_MANIFEST_FILE,
  readBackendManifest,
  readRuntimeManifest,
} from './backendManifest.ts';
import { installBackend } from './backendInstall.ts';
import { confirmPluginStartup, type PluginConfirmationHost } from './pluginMaintenance.ts';
import { isSha256, sha256 } from './contract.ts';
import { readLocalComponent, type ComponentInstallOptions } from './componentFiles.ts';
import { confirmedStartupAtom, type ConfirmedStartup } from './loaderConfirmation.ts';
import { json, record } from './loaderContract.ts';
import {
  installNodeRuntime,
  readPlatformHints,
  runtimeRunsOn,
  type PlatformHints,
  type RuntimeInstallHost,
} from './nodeRuntime.ts';
import { fetchVerified } from './releaseFetch.ts';
import { templateFiles, type TemplateFileHost } from './templateFiles.ts';

export type BackendStatus =
  | { readonly phase: 'off' }
  /** 按系统架构判断运行时无法运行，不下载；换系统前不会改变，不提供重试。 */
  | { readonly phase: 'unsupported' }
  | { readonly phase: 'preparing' | 'installing' | 'connecting' }
  | { readonly phase: 'runtime'; readonly completed: number; readonly total: number }
  | { readonly phase: 'ready'; readonly version: string; readonly runtime: string }
  | { readonly phase: 'failed'; readonly reason: 'prepare' | 'stopped'; readonly detail: string };

export interface BackendBootstrapHost
  extends RuntimeInstallHost, RuntimeCheckHost, PluginConfirmationHost {
  readonly file: RuntimeInstallHost['file'] & RuntimeCheckHost['file'] & TemplateFileHost;
}

export interface BackendBootstrapOptions {
  readonly host?: BackendBootstrapHost;
  readonly storageAvailable?: boolean;
  readonly readLocal?: ComponentInstallOptions['readLocal'];
  readonly suffix?: () => string;
  readonly pause?: () => Promise<void>;
  readonly platform?: () => Promise<PlatformHints | null>;
}

export interface BackendBootstrap {
  readonly status: Atom<BackendStatus>;
  retry(): Promise<void>;
  dispose(): void;
}

/** 当前前端自身携带的描述控制补装；没有描述时保持纯前端模式，也不联网。 */
export function startBackendBootstrap(
  store: Store,
  connection: Pick<BackendConnection, 'connect' | 'failed'>,
  options: BackendBootstrapOptions = {},
): BackendBootstrap {
  const host = options.host ?? fb;
  const state = atom<BackendStatus>({ phase: 'off' });
  const lifetime = new AbortController();
  let running: Promise<void> | null = null;
  let attempted: ConfirmedStartup | null = null;
  const show = (value: BackendStatus) => {
    if (!lifetime.signal.aborted) store.set(state, value);
  };

  async function prepare(startup: ConfirmedStartup): Promise<void> {
    const current = () => {
      if (lifetime.signal.aborted || store.get(confirmedStartupAtom) !== startup)
        throw new Error('后端准备已取消');
    };
    const report = (value: BackendStatus) => {
      current();
      show(value);
    };
    const files = templateFiles(host.file, startup.directory, current);
    const directory = `fe/${startup.session.version.dir}`;
    const marker = json(await files.readText(`${directory}/installed.json`));
    if (!record(marker) || !record(marker.files)) throw new Error('无法读取前端安装信息');
    const expected = marker.files[BACKEND_MANIFEST_FILE];
    if (expected === undefined) {
      report({ phase: 'off' });
      return;
    }
    if (!isSha256(expected)) throw new Error('后端描述缺少校验信息');
    report({ phase: 'preparing' });
    const bytes = await files.readBytes(`${directory}/${BACKEND_MANIFEST_FILE}`);
    if (!bytes || bytes.length > 256 * 1024 || (await sha256(bytes)) !== expected)
      throw new Error('后端描述校验失败');
    const manifest = readBackendManifest(
      new TextDecoder().decode(bytes),
      startup.session.version.v,
    );
    if (!manifest) throw new Error('后端描述不兼容');
    current();
    const cache = `state/runtime-${manifest.runtime.sha256.slice(0, 16)}.json`;
    files.path(cache, true);
    const cached = await files.readBytes(cache);
    let runtimeBytes = cached;
    if (
      !cached ||
      cached.length !== manifest.runtime.size ||
      (await sha256(cached)) !== manifest.runtime.sha256
    ) {
      current();
      const fetched = await fetchVerified(host.http, manifest.runtime.url, {
        ...manifest.runtime,
        limit: manifest.runtime.size,
      });
      current();
      if (!fetched.ok) throw new Error(`运行时清单下载失败：${fetched.problem}`);
      runtimeBytes = fetched.value;
      // 宿主文本写入会转换换行；哈希绑定原始字节，缓存必须按二进制原子写入。
      await files.writeBytes(cache, runtimeBytes, { atomic: true });
    }
    const runtimeManifest = readRuntimeManifest(
      new TextDecoder().decode(runtimeBytes ?? undefined),
    );
    if (!runtimeManifest) throw new Error('运行时清单无效');
    const hints = await (options.platform ?? readPlatformHints)();
    current();
    if (!runtimeRunsOn(runtimeManifest.arch, hints)) {
      report({ phase: 'unsupported' });
      return;
    }
    const install: ComponentInstallOptions = {
      suffix: options.suffix ?? (() => crypto.randomUUID().replaceAll('-', '').slice(0, 6)),
      pause: options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 30))),
      current,
      readLocal:
        options.readLocal ??
        ((relative, size) => readLocalComponent(relative, size, lifetime.signal)),
      progress: (completed, total) => report({ phase: 'runtime', completed, total }),
    };
    report({ phase: 'runtime', completed: 0, total: runtimeManifest.parts.length });
    const runtime = await installNodeRuntime(files, host, runtimeManifest, {
      ...install,
      selfTest: (runtime) =>
        checkNodeRuntime(
          host,
          {
            ...runtime,
            directory: files.directory,
            executable: files.path(runtime.executable),
          },
          current,
        ),
    });
    current();
    report({ phase: 'installing' });
    const backend = await installBackend(
      files,
      host,
      manifest.version,
      manifest.backend,
      runtime,
      install,
    );
    current();
    report({ phase: 'connecting' });
    const connected = await connection.connect({
      directory: files.directory,
      executable: files.path(runtime.executable),
      entry: files.path(backend.entry),
      version: manifest.version,
      installId: startup.installId,
      sessionId: startup.session.sessionId,
      runtimeVersion: runtime.version,
      runtimeArch: runtime.arch,
    });
    current();
    await confirmPluginStartup(files, startup, connected, host, current);
    report({ phase: 'ready', version: connected.version, runtime: connected.runtime });
  }

  function run(): Promise<void> {
    if (running) return running;
    const startup = store.get(confirmedStartupAtom);
    if (!startup || lifetime.signal.aborted || options.storageAvailable === false)
      return Promise.resolve();
    attempted = startup;
    running = prepare(startup)
      .catch((error: unknown) => {
        if (store.get(confirmedStartupAtom) !== startup) return;
        show({
          phase: 'failed',
          reason: 'prepare',
          detail: error instanceof Error ? error.message : '后端准备失败',
        });
      })
      .finally(() => {
        running = null;
        sync();
      });
    return running;
  }
  const sync = () => {
    const startup = store.get(confirmedStartupAtom);
    if (!startup) show({ phase: 'off' });
    if (startup && startup !== attempted) void run();
  };
  const offs = [
    store.sub(confirmedStartupAtom, sync),
    store.sub(connection.failed, () => {
      if (store.get(connection.failed) && store.get(state).phase === 'ready')
        show({ phase: 'failed', reason: 'stopped', detail: '本地后端连接已中断' });
    }),
  ];
  sync();
  return {
    status: atom((get) => get(state)),
    retry: run,
    dispose() {
      lifetime.abort();
      for (const off of offs) off();
    },
  };
}

export const backendBootstrapKey = serviceKey<BackendBootstrap>('backendBootstrap');
