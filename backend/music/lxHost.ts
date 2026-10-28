import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { MusicError } from './musicError.ts';

/**
 * 托管的 lxserver 进程控制
 *
 * 运行用户导入的音源脚本；启用 Node 权限模型限制文件系统访问（只读组件目录、读写数据目录），
 * 禁止加载原生模块、派生子进程与创建 Worker
 */
export interface LxHost {
  installed(): boolean;
  /** 连接托管服务；未运行时拉起子进程，并发调用共用同一启动流程 */
  connect(): Promise<LxHostConnection>;
  /** 结束子进程；之后再次调用 connect 会重新拉起 */
  stop(): Promise<void>;
}

export interface LxHostConnection {
  readonly url: string;
  readonly adminPassword: string;
}

export interface LxHostOptions {
  /** 已安装的组件目录 */
  readonly app: string;
  /** 数据目录（配置、缓存、日志与工作目录）；与后端状态目录并列且不嵌套 */
  readonly data: string;
  readonly installed: () => boolean;
  /** 运行 Node 的可执行文件路径；省略时使用宿主 Node */
  readonly node?: string;
  /** 等待服务就绪的超时毫秒数 */
  readonly startTimeoutMs?: number;
}

/** 监听父进程输入管道关闭事件，确保主进程异常退出时子进程联动退出 */
const EXIT_WITH_PARENT =
  "data:text/javascript,process.stdin.on('end',()=>process.exit(0)).resume()";

/** 分配临时空闲端口供子进程绑定；若绑定前端口被抢占，由外层调用重试换端口 */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? done(address.port) : fail(new Error('no port')),
      );
    });
  });
}

export function startLxHost(options: LxHostOptions) {
  let child: { readonly process: ChildProcess; readonly gone: Promise<void> } | null = null;
  let starting: Promise<LxHostConnection> | null = null;
  /** 启动代次计数；用于在并发或 stop 时作废过期的启动任务 */
  let generation = 0;
  let disposed = false;

  async function launch(): Promise<LxHostConnection> {
    const mine = generation;
    await mkdir(options.data, { recursive: true });
    const port = await freePort();
    const admin = randomBytes(24).toString('hex');
    // 每次启动重写配置以轮换端口与管理密码，避免持久化残留配置
    await writeFile(
      join(options.data, 'config.json'),
      JSON.stringify({
        port,
        users: [],
        disableTelemetry: true,
        'admin.password': admin,
        'player.password': randomBytes(24).toString('hex'),
        'webdav.enable': false,
        'subsonic.enable': false,
        'configBackup.enable': false,
        'system.allowUnsafeVM': false,
      }),
      { mode: 0o600 },
    );
    if (disposed || generation !== mine) throw new MusicError('cancelled');
    // 隔离环境变量以防止覆盖配置文件，仅注入必要的路径与服务控制参数
    const env: NodeJS.ProcessEnv = {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      BIND_IP: '127.0.0.1',
      NODE_ENV: 'production',
      DATA_PATH: join(options.data, 'data'),
      CONFIG_PATH: join(options.data, 'config.json'),
      LOG_PATH: join(options.data, 'logs'),
      STATIC_PATH: join(options.data, 'public'),
      DISABLE_TELEMETRY: 'true',
    };
    // 保持符号链接路径，避免向上解析组件目录的父级路径
    const spawned = spawn(
      options.node ?? process.execPath,
      [
        '--permission',
        '--preserve-symlinks-main',
        '--preserve-symlinks',
        `--allow-fs-read=${options.app}`,
        `--allow-fs-read=${options.data}`,
        `--allow-fs-write=${options.data}`,
        '--import',
        EXIT_WITH_PARENT,
        join(options.app, 'index.js'),
      ],
      // 将工作目录重定向至数据目录，隔离运行期缓存与调试输出
      { cwd: options.data, env, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true },
    );
    spawned.stdin?.on('error', () => {});
    const gone = new Promise<void>((done) => {
      spawned.once('exit', () => done());
      spawned.once('error', () => done());
    });
    const current = { process: spawned, gone };
    child = current;
    void gone.then(() => {
      if (child !== current) return;
      child = null;
      starting = null;
    });

    const deadline = Date.now() + (options.startTimeoutMs ?? 15000);
    while (child === current) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
          headers: { 'x-frontend-auth': admin },
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) return { url: `http://127.0.0.1:${port}/`, adminPassword: admin };
      } catch {
        // 等待服务端口就绪
      }
      if (Date.now() >= deadline) {
        spawned.kill();
        throw new MusicError('timeout');
      }
      await pause(100);
    }
    throw new MusicError(disposed ? 'cancelled' : 'upstream-unavailable');
  }

  async function stop(): Promise<void> {
    const current = child;
    generation += 1;
    child = null;
    starting = null;
    if (!current) return;
    current.process.kill();
    await current.gone;
  }

  return {
    installed: options.installed,
    connect(): Promise<LxHostConnection> {
      if (disposed) return Promise.reject(new MusicError('cancelled'));
      if (!options.installed()) return Promise.reject(new MusicError('not-installed'));
      starting ??= launch().catch((error: unknown) => {
        starting = null;
        throw error instanceof MusicError ? error : new MusicError('upstream-unavailable');
      });
      return starting;
    },
    stop,
    async dispose(): Promise<void> {
      disposed = true;
      await stop();
    },
  } satisfies LxHost & { dispose(): Promise<void> };
}
