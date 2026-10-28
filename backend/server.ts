import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, realpath, rename, unlink, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { startPluginController } from './plugin-update/controller.ts';
import { MUSIC_ACTIONS, startMusicService } from './music/musicService.ts';
import { componentDirectory, type ComponentPackage } from './music/componentInstall.ts';
import { ncmLoader } from './music/ncmSource.ts';
import {
  BACKEND_ORIGIN,
  BACKEND_PROTOCOL,
  isBackendId,
  type BackendDescriptor,
  type BackendIdentity,
} from '../src/server/backendProtocol.ts';

export interface BackendOptions extends BackendIdentity {
  readonly directory: string;
  readonly launchId: string;
  readonly parentAlive?: () => boolean;
  /** 随后端发布的网易云组件描述；没有时不提供网易云 */
  readonly ncmPackage?: ComponentPackage | null;
  /** 随后端发布的 lxserver 组件描述；没有时不托管 lxserver，只能连自建的 */
  readonly lxPackage?: ComponentPackage | null;
  /**
   * 开发服务器拉起后端源码时给的现成组件目录：网易云直接从这里加载，lxserver 把它当作装好的组件；
   * 给了就不看对应的组件描述，也不提供下载
   */
  readonly ncmDirectory?: string;
  readonly lxDirectory?: string;
  /**
   * 额外接受的页面来源：只有手动起后端联调（开发服务器页面经 URL 覆盖加载）才给；
   * 主题自身的引导永远只认 `BACKEND_ORIGIN`
   */
  readonly extraOrigins?: readonly string[];
  /** 手动联调时定死令牌，免去每次重抄；省略时每次启动随机 */
  readonly token?: string;
}

export interface BackendServer {
  readonly descriptor: BackendDescriptor;
  close(): Promise<void>;
}

async function atomic(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, text, { flag: 'wx', mode: 0o600, flush: true });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** 读不出或不像端口时答 0，即由系统另选 */
async function lastPort(path: string): Promise<number> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    const port = typeof value === 'object' && value !== null && 'port' in value ? value.port : 0;
    return typeof port === 'number' && Number.isSafeInteger(port) && port > 0 && port < 65536
      ? port
      : 0;
  } catch {
    return 0;
  }
}

function originAllowed(origin: string | undefined, extra: readonly string[]): origin is string {
  return origin === BACKEND_ORIGIN || (origin !== undefined && extra.includes(origin));
}

function authenticated(
  request: IncomingMessage,
  token: string,
  port: number,
  extraOrigins: readonly string[],
): boolean {
  const authorization = request.headers.authorization;
  if (
    !originAllowed(request.headers.origin, extraOrigins) ||
    request.headers.host !== `127.0.0.1:${port}` ||
    typeof authorization !== 'string'
  )
    return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function respond(response: ServerResponse, status: number, value?: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

/** 端口只绑定回环；同源校验与随机令牌共同拒绝其他网页的请求 */
export async function startBackend(options: BackendOptions): Promise<BackendServer> {
  if (
    !/^\d+\.\d+\.\d+$/.test(options.version) ||
    !isBackendId(options.installId) ||
    !isBackendId(options.sessionId) ||
    !isBackendId(options.launchId)
  )
    throw new Error('后端启动身份无效');
  const directory = await realpath(options.directory);
  const state = join(directory, 'state');
  await mkdir(state, { recursive: true });
  if ((await realpath(state)).toLowerCase() !== state.toLowerCase())
    throw new Error('后端状态目录不能重定向到其他位置');
  const descriptorPath = join(state, `backend-run-${options.launchId}.json`);
  const locatorPath = join(state, `backend-${options.sessionId}.json`);
  const stopPath = join(state, `backend-stop-${options.launchId}.json`);
  const extraOrigins = options.extraOrigins ?? [];
  const token = options.token ?? randomBytes(32).toString('hex');
  const parentPid = process.ppid;
  const parentAlive =
    options.parentAlive ??
    (() => {
      try {
        process.kill(parentPid, 0);
        return true;
      } catch {
        return false;
      }
    });
  let closing: Promise<void> | undefined;
  let port = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;
  const plugins = startPluginController({ ...options, directory });
  // 组件装在 components/<名字>-<版本>；网易云自己的临时文件放进状态目录；托管的 lxserver 运行音源脚本，
  // 它的数据目录与状态目录并列；权限模型只放行组件目录（只读）与这个数据目录，状态目录里的网易云登录信息它读不到
  const components = join(directory, 'components');
  const ncm = options.ncmPackage;
  const lx = options.lxPackage;
  const lxData = join(directory, 'lxserver');
  const music = await startMusicService(state, {
    ...(options.ncmDirectory
      ? { ncm: ncmLoader(options.ncmDirectory, join(state, 'ncm')) }
      : ncm
        ? {
            ncm: ncmLoader(componentDirectory(components, 'ncm', ncm.version), join(state, 'ncm')),
            ncmInstall: { components, package: ncm },
          }
        : {}),
    ...(options.lxDirectory
      ? { lxHost: { app: options.lxDirectory, data: lxData } }
      : lx
        ? { lxHost: { install: { components, package: lx }, data: lxData } }
        : {}),
  });
  async function pluginRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += bytes.length;
        if (size > 3 * 1024 * 1024) return respond(response, 413);
        chunks.push(bytes);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const result = await plugins.request(request.url!.slice('/plugin/'.length), body);
      respond(response, 200, result);
    } catch (error) {
      respond(response, 400, {
        error: error instanceof Error ? error.message : '插件更新请求失败',
      });
    }
  }
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    // fb2k 打开在线曲目的占位地址时不带页面来源与令牌：音频路由只核对 Host，只交出音频
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.url?.startsWith('/music/stream/')
    ) {
      if (request.headers.host !== `127.0.0.1:${port}`) return respond(response, 403);
      music.stream(request, response);
      return;
    }
    const origin = request.headers.origin;
    if (originAllowed(origin, extraOrigins) && request.headers.host === `127.0.0.1:${port}`) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        respond(response, 204);
        return;
      }
    }
    if (!authenticated(request, token, port, extraOrigins)) return respond(response, 403);
    if (
      request.method === 'POST' &&
      MUSIC_ACTIONS.some((action) => request.url === `/music/${action}`)
    ) {
      void music.handle(request, response);
      return;
    }
    if (
      request.method === 'POST' &&
      /^\/plugin\/(status|prepare|start|authorize|cancel)$/.test(request.url ?? '')
    ) {
      void pluginRequest(request, response);
      return;
    }
    if (request.url === '/health' && request.method === 'GET') {
      respond(response, 200, {
        protocol: BACKEND_PROTOCOL,
        version: options.version,
        installId: options.installId,
        sessionId: options.sessionId,
        launchId: options.launchId,
        pid: process.pid,
        hostPid: process.ppid,
        runtime: process.versions.node,
        arch: process.arch,
        executable: process.execPath,
        entry: process.argv[1] ?? '',
      });
    } else if (request.url === '/shutdown' && request.method === 'POST') {
      response.once('finish', () => {
        void close();
      });
      respond(response, 200, { success: true });
    } else respond(response, 404);
    request.resume();
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  const listen = (at: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(at, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  // fb2k 队列里在线曲目的占位地址带着端口：先绑上次的端口，重启后这些地址仍然有效；被占用才由系统另选
  const portPath = join(state, 'backend-port.v1.json');
  const previous = await lastPort(portPath);
  try {
    await listen(previous);
  } catch (error) {
    if (!previous) throw error;
    await listen(0);
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('后端端口不可用');
  port = address.port;
  // 记不下来只是下次另选端口，不影响这次启动
  if (port !== previous) await atomic(portPath, JSON.stringify({ port })).catch(() => {});
  const descriptor: BackendDescriptor = {
    protocol: BACKEND_PROTOCOL,
    version: options.version,
    installId: options.installId,
    sessionId: options.sessionId,
    launchId: options.launchId,
    pid: process.pid,
    port,
    token,
  };

  function close(): Promise<void> {
    if (closing) return closing;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    const musicStopped = music.dispose();
    closing = new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }).then(async () => {
      await musicStopped;
      await plugins.dispose().catch(() => {});
      // 定位记录可能已被新进程覆盖；退出只清理本次启动独占的文件
      await unlink(descriptorPath).catch(() => {});
      await unlink(stopPath).catch(() => {});
    });
    return closing;
  }

  try {
    await atomic(descriptorPath, JSON.stringify(descriptor));
    await atomic(locatorPath, JSON.stringify(descriptor));
  } catch (error) {
    await close();
    throw error;
  }
  // 手动联调直接从控制台输出拿端口与令牌；引导拉起的进程隐藏控制台，这行输出不可见
  console.log(JSON.stringify(descriptor));
  timer = setInterval(() => {
    if (checking || closing) return;
    checking = true;
    void access(stopPath)
      .then(
        () => true,
        () => false,
      )
      .then(async (stopped) => {
        // 宿主最小化时会挂起网页计时器，缺少网页心跳不能当作退出依据
        if (stopped || !parentAlive()) await close();
      })
      .finally(() => {
        checking = false;
      });
  }, 1000);
  timer.unref();
  return { descriptor, close };
}
