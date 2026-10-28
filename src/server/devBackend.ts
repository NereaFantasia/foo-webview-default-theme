import { fb, webview } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { browserStorage, type PrefStorage } from '../kit/localPref.ts';
import type { BackendConnection, ManualBackendTarget } from './backendConnection.ts';
import { isBackendId } from './backendProtocol.ts';
import { DEV_SESSION_ID, resolveLaunch, type Descriptors } from './devBackendLaunch.ts';
import { readManualBackendQuery, readManualBackendStored } from './manualBackend.ts';

/**
 * `import.meta.env.DEV` 时才走的短路：引导确认、安装身份与完整性校验都是给磁盘上的安装定的，
 * 开发服务器页面用不上。这里自己合成一份身份——固定 installId 与 sessionId（不与引导安装的身份
 * 相碰）、偏好里持久化的令牌——按模板目录找到运行时与后端直接拉起，拉起参数带上页面自己的来源
 *
 * 页面上优先直接跑 `backend/main.ts` 源码：运行时用 Node 24 自带的类型转换，源码改了由开发服务器
 * 通知页面重启，不必先构建。没有源码或运行时版本不够时退回已装的 `server.cjs`
 * 身份不作废就不换：重载页面或重开开发服务器时按 sessionId 读到已起进程的描述，直接接上，不重复拉起
 */
const KEY_TOKEN = 'default-theme.dev-backend.token.v1';
const KEY_DIR = 'default-theme.dev-backend.dir.v1';
const KEY_SRC = 'default-theme.dev-backend.src.v1';
const KEY_NCM = 'default-theme.dev-backend.ncm.v1';
const KEY_LX = 'default-theme.dev-backend.lx.v1';
const KEY_BUILD = 'default-theme.dev-backend.build.v1';

/** 拉起进程后等它发布描述的时间上限；源码直跑与解网易云组件都比构建产物慢一点 */
const SPAWN_POLL_MS = 15000;
const SPAWN_POLL_STEP_MS = 150;
/** 写停止标记后等旧进程退出的时间上限 */
const STOP_POLL_MS = 3000;
const STOP_POLL_STEP_MS = 100;
const HEALTH_TIMEOUT_MS = 3000;

export interface DevBackendHost {
  readonly file: Pick<typeof fb.file, 'read' | 'list' | 'exists' | 'write'>;
  readonly shell: Pick<typeof fb.shell, 'spawn'>;
  readonly getSource: typeof webview.getSource;
}

/** 开发服务器页面上的两条提示：仓库根与后端源码的构建哈希；没有开发服务器时都是 null */
export interface DevBackendPage {
  readonly source: string | null;
  readonly build: string | null;
}

export interface DevBackendOptions {
  readonly host?: DevBackendHost;
  readonly storage?: PrefStorage | null;
  readonly url?: URL;
  readonly origin?: string;
  readonly log?: (message: string) => void;
  readonly page?: DevBackendPage;
  /** 已有后端是不是同一份源码；调用方可替换这里的网络请求 */
  readonly readHealth?: (target: ManualBackendTarget) => Promise<{ readonly entry: string } | null>;
}

export interface DevBackend {
  readonly ready: Promise<boolean>;
  /** 后端源码变化后重启；同一个构建重复调用不重启 */
  restart(build?: string | null): Promise<boolean>;
  dispose(): void;
}

interface Descriptor {
  readonly port: number;
  readonly token: string;
  readonly launchId: string;
}

function cleanPath(value: string | null): string | null {
  const text = (value ?? '').trim().replace(/[\\/]+$/, '');
  return text && /^[A-Za-z]:[\\/]/.test(text) ? text : null;
}

function readBuild(text: string | null): string | null {
  return text && /^[0-9a-f]{8,64}$/.test(text) ? text : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDescriptor(text: string | null): Descriptor | null {
  try {
    const value: unknown = JSON.parse(text ?? '');
    if (!record(value) || !('port' in value) || !('token' in value)) return null;
    const port = Number(value.port);
    const token = typeof value.token === 'string' ? value.token : '';
    const launchId = isBackendId(value.launchId) ? value.launchId : '';
    return Number.isInteger(port) && port > 0 && port <= 65535 && /^[0-9a-f]{64}$/.test(token)
      ? { port, token, launchId }
      : null;
  } catch {
    return null;
  }
}

function paramOrPref(
  url: URL,
  storage: PrefStorage | null,
  name: string,
  key: string,
  read: (text: string | null) => string | null,
): string | null {
  const fromQuery = read(url.searchParams.get(name));
  if (fromQuery) {
    storage?.setItem(key, fromQuery);
    return fromQuery;
  }
  return read(storage?.getItem(key) ?? null);
}

function persistedToken(storage: PrefStorage | null): {
  readonly token: string;
  readonly save: boolean;
} {
  const saved = storage?.getItem(KEY_TOKEN) ?? null;
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return { token: saved, save: false };
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return {
    token: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    save: true,
  };
}

/** 页面上的两条提示只在开发服务器注入过 `<meta>` 时存在 */
function pageHints(): DevBackendPage {
  if (typeof document === 'undefined') return { source: null, build: null };
  const content = (name: string) =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
  return {
    source: cleanPath(content('dev-backend-source') ?? ''),
    build: readBuild(content('dev-backend-build')),
  };
}

async function exists(host: DevBackendHost, path: string): Promise<boolean> {
  const answer = await settle(() => host.file.exists(path));
  return answer !== null && answer.success !== false && answer.exists;
}

async function readText(
  host: DevBackendHost,
  directory: string,
  relative: string,
): Promise<string | null> {
  const answer = await settle(() => host.file.read(`${directory}\\${relative}`));
  return answer && answer.success !== false ? answer.content : null;
}

async function health(target: ManualBackendTarget): Promise<{ readonly entry: string } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${target.port}/health`, {
      headers: { Authorization: `Bearer ${target.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return record(value) && typeof value.entry === 'string' ? { entry: value.entry } : null;
  } catch {
    return null;
  }
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll('/', '\\').toLowerCase() === right.replaceAll('/', '\\').toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startDevBackend(
  connection: Pick<BackendConnection, 'connectManual'>,
  options: DevBackendOptions = {},
): DevBackend {
  const host: DevBackendHost = options.host ?? {
    file: fb.file,
    shell: fb.shell,
    getSource: webview.getSource,
  };
  const storage = options.storage !== undefined ? options.storage : browserStorage();
  const url = options.url ?? new URL(location.href);
  const origin = options.origin ?? url.origin;
  const log = options.log ?? ((message: string) => console.warn(`[dev-backend] ${message}`));
  const page = options.page ?? pageHints();
  const readHealth = options.readHealth ?? health;
  const lifetime = new AbortController();
  let current: {
    readonly directory: string;
    readonly descriptor: Descriptor;
    build: string | null;
  } | null = null;
  let queue: Promise<boolean> = Promise.resolve(true);
  let disposed = false;

  function alive(): boolean {
    return !disposed && !lifetime.signal.aborted;
  }

  /** 同一时刻只跑一次连接或重启；后来的排在前一次之后 */
  function enqueue(task: () => Promise<boolean>): Promise<boolean> {
    const next = queue.then(task, task);
    queue = next.catch(() => false);
    return next;
  }

  async function resolveDirectory(): Promise<string | null> {
    const directory = paramOrPref(url, storage, 'backend-dir', KEY_DIR, cleanPath);
    if (directory) return directory;
    const source = await settle(() => host.getSource());
    if (!source || source.success === false || !source.templatesDirectory) return null;
    const base = source.templatesDirectory.replace(/[\\/]+$/, '');
    return `${base}\\${source.activeTemplateName}`;
  }

  /**
   * 地址里的 `backend-src` 指到具体文件时最优先；目录留给没有开发服务器注入源码的页面，
   * 否则以前存下的目录参数会一直压住注入的源码
   */
  function sourcePath(): string | null {
    const fromQuery = cleanPath(url.searchParams.get('backend-src'));
    if (fromQuery && /\.(?:ts|mts|cjs)$/i.test(fromQuery)) {
      storage?.setItem(KEY_SRC, fromQuery);
      return fromQuery;
    }
    return page.source ?? fromQuery ?? cleanPath(storage?.getItem(KEY_SRC) ?? null);
  }

  /** 地址里的 `backend-ncm`、`backend-lx` 指两份组件描述，记进偏好，下次不必再带 */
  function descriptors(): Descriptors {
    return {
      ncm: paramOrPref(url, storage, 'backend-ncm', KEY_NCM, cleanPath),
      lx: paramOrPref(url, storage, 'backend-lx', KEY_LX, cleanPath),
    };
  }

  async function readLocator(directory: string): Promise<Descriptor | null> {
    return readDescriptor(await readText(host, directory, `state/backend-${DEV_SESSION_ID}.json`));
  }

  /** 写停止标记让旧进程自己退出；描述文件被它清理掉才算停了 */
  async function stop(directory: string, descriptor: Descriptor): Promise<void> {
    if (!descriptor.launchId) return;
    const relative = `state/backend-run-${descriptor.launchId}.json`;
    await settle(() =>
      host.file.write(`${directory}\\state\\backend-stop-${descriptor.launchId}.json`, '{}', {
        atomic: true,
      }),
    );
    const deadline = Date.now() + STOP_POLL_MS;
    while (Date.now() < deadline) {
      if (!(await exists(host, `${directory}\\${relative}`))) return;
      await sleep(STOP_POLL_STEP_MS);
    }
  }

  async function spawn(directory: string, build: string | null): Promise<boolean> {
    if (!alive()) return false;
    const { token, save } = persistedToken(storage);
    const launchId = crypto.randomUUID();
    const source = sourcePath();
    const paths = descriptors();
    const launch = await resolveLaunch(
      host,
      directory,
      source,
      paths,
      origin,
      token,
      launchId,
      log,
    );
    if (!launch) return false;
    if (launch.ncm && launch.ncm !== paths.ncm) storage?.setItem(KEY_NCM, launch.ncm);
    if (launch.lx && launch.lx !== paths.lx) storage?.setItem(KEY_LX, launch.lx);
    const started = await settle(() =>
      host.shell.spawn(launch.executable, {
        args: launch.args,
        cwd: directory,
        hidden: true,
        waitForExitMs: 0,
      }),
    );
    if (!started || started.success === false) {
      log(`进程没拉起来（${launch.entry}）`);
      return false;
    }
    const deadline = Date.now() + SPAWN_POLL_MS;
    while (Date.now() < deadline && alive()) {
      const descriptor = readDescriptor(
        await readText(host, directory, `state/backend-run-${launchId}.json`),
      );
      if (descriptor) {
        if (!(await connection.connectManual({ port: descriptor.port, token: descriptor.token }))) {
          log('后端已启动，但页面连不上它');
          return false;
        }
        if (save) storage?.setItem(KEY_TOKEN, token);
        if (build) storage?.setItem(KEY_BUILD, build);
        current = { directory, descriptor, build };
        log(`后端已启动（${launch.source ? '源码' : '构建'}）`);
        return true;
      }
      const error = await readText(host, directory, `state/backend-error-${launchId}.json`);
      if (error) {
        log(`拉起失败，原因已写进 state/backend-error-${launchId}.json`);
        return false;
      }
      await sleep(SPAWN_POLL_STEP_MS);
    }
    if (!alive()) return false;
    log('等待后端发布描述超时：它多半死在参数解析，给 ?backend-src= 指一份新构建');
    return false;
  }

  async function start(): Promise<boolean> {
    if (!alive()) return false;
    const query = readManualBackendQuery(url);
    if (query) {
      if (await connection.connectManual(query)) {
        log(`使用地址里登记的手动后端（端口 ${query.port}）`);
        return true;
      }
      log('地址里登记的手动后端连不上，改为尝试自动拉起');
    }
    const directory = await resolveDirectory();
    if (directory) {
      const build = page.build;
      const stored = readBuild(storage?.getItem(KEY_BUILD) ?? null);
      const locator = await readLocator(directory);
      const { token } = persistedToken(storage);
      const source = sourcePath();
      const planned = await resolveLaunch(
        host,
        directory,
        source,
        descriptors(),
        origin,
        token,
        crypto.randomUUID(),
        log,
      );
      if (locator && planned) {
        const actual = await readHealth(locator);
        const sameSource = actual !== null && samePath(actual.entry, planned.entry);
        const sameBuild = build === null || (stored !== null && stored === build);
        if (sameSource && sameBuild) {
          current = { directory, descriptor: locator, build: stored ?? build };
          if (await connection.connectManual({ port: locator.port, token: locator.token })) {
            log(`接上已起的后端（端口 ${locator.port}）`);
            return true;
          }
          log('已起的后端连不上，重启它');
        } else {
          log(sameSource ? '后端源码有变化，重启' : '已起后端不是当前源码，重启');
        }
        await stop(directory, locator);
      } else if (locator) {
        current = { directory, descriptor: locator, build: stored ?? build };
        if (await connection.connectManual({ port: locator.port, token: locator.token })) {
          log(`接上已起的后端（端口 ${locator.port}）`);
          return true;
        }
        await stop(directory, locator);
      }
      if (await spawn(directory, build)) return true;
    } else {
      log('拿不到模板目录：给一次 ?backend-dir=<模板目录> 即可，之后偏好记住');
    }
    const stored = readManualBackendStored(storage);
    if (stored && (await connection.connectManual(stored))) {
      log(`使用偏好里登记的手动后端（端口 ${stored.port}）`);
      return true;
    }
    return false;
  }

  async function restartNow(build: string | null): Promise<boolean> {
    if (!alive()) return false;
    if (current && build !== null && current.build === build) return true;
    const directory = current?.directory ?? (await resolveDirectory());
    if (!directory) return false;
    const descriptor = current?.descriptor ?? (await readLocator(directory));
    if (descriptor) await stop(directory, descriptor);
    current = null;
    return spawn(directory, build);
  }

  const ready = enqueue(start);

  const hot = import.meta.hot;
  const onChanged = (data: unknown) => {
    if (!alive()) return;
    const build = record(data) && typeof data.hash === 'string' ? readBuild(data.hash) : null;
    if (!build) return;
    void enqueue(() => restartNow(build)).catch(() => {});
  };
  hot?.on('dev-backend:changed', onChanged);

  return {
    ready,
    restart: (build = null) => enqueue(() => restartNow(build)),
    dispose() {
      disposed = true;
      lifetime.abort();
      hot?.off('dev-backend:changed', onChanged);
    },
  };
}

/** 兼容装配层的一步调用：只等第一次连接，重启留给开发服务器的变更通知 */
export async function connectDevBackend(
  connection: Pick<BackendConnection, 'connectManual'>,
  options: DevBackendOptions = {},
): Promise<boolean> {
  const service = startDevBackend(connection, options);
  try {
    return await service.ready;
  } finally {
    // 页面还开着时保留变更监听；卸载由页面本身带走
    if (!import.meta.hot) service.dispose();
  }
}
