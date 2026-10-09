import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, realpath, rename, unlink, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { startPluginController } from './plugin-update/controller.ts';
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

function authenticated(request: IncomingMessage, token: string, port: number): boolean {
  const authorization = request.headers.authorization;
  if (
    request.headers.origin !== BACKEND_ORIGIN ||
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

/** 端口只绑定回环；同源校验与随机令牌共同拒绝其他网页的请求。 */
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
  const token = randomBytes(32).toString('hex');
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
    const origin = request.headers.origin;
    if (origin === BACKEND_ORIGIN && request.headers.host === `127.0.0.1:${port}`) {
      response.setHeader('Access-Control-Allow-Origin', BACKEND_ORIGIN);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        respond(response, 204);
        return;
      }
    }
    if (!authenticated(request, token, port)) return respond(response, 403);
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('后端端口不可用');
  port = address.port;
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
    closing = new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }).then(async () => {
      await plugins.dispose().catch(() => {});
      // 定位记录可能已被新进程覆盖；退出只清理本次启动独占的文件。
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
  timer = setInterval(() => {
    if (checking || closing) return;
    checking = true;
    void access(stopPath)
      .then(
        () => true,
        () => false,
      )
      .then(async (stopped) => {
        // 宿主最小化时会挂起网页计时器，缺少网页心跳不能当作退出依据。
        if (stopped || !parentAlive()) await close();
      })
      .finally(() => {
        checking = false;
      });
  }, 1000);
  timer.unref();
  return { descriptor, close };
}
