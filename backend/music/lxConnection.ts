import { lstat, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  MusicLxAuth,
  MusicLxConfigRequest,
  MusicStatus,
} from '../../src/server/musicProtocol.ts';
import {
  readLxConfig,
  startLxSource,
  type LxSourceConfig,
  type LxSourceOptions,
} from './lxSource.ts';
import type { LxHost } from './lxHost.ts';
import { startMusicCatalog } from './musicCatalog.ts';
import { MusicError } from './musicError.ts';
import { writeStateFile } from './stateFile.ts';

const MAX_CONFIG_BYTES = 16384;

async function readConfig(path: string): Promise<LxSourceConfig> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES)
    throw new MusicError('invalid-config');
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_CONFIG_BYTES) throw new MusicError('invalid-config');
  const config = readLxConfig(JSON.parse(bytes.toString('utf8')));
  if (!config) throw new MusicError('invalid-config');
  return config;
}

type LxSource = ReturnType<typeof startLxSource>;

/** 包装托管服务音源实例；监听服务端口与密码轮换并在变更时重建适配器 */
function hostedSource(host: LxHost, options: LxSourceOptions) {
  let current: { readonly url: string; readonly source: LxSource } | null = null;
  async function source(): Promise<LxSource> {
    const { url, adminPassword } = await host.connect();
    if (current?.url !== url)
      current = { url, source: startLxSource({ schema: 1, url, adminPassword }, options) };
    return current.source;
  }
  return {
    origin: () => (current ? new URL(current.url).origin : null),
    source: {
      verify: async (signal) => (await source()).verify(signal),
      search: async (input, signal) => (await source()).search(input, signal),
      resolve: async (record, quality, signal, exclude, fresh) =>
        (await source()).resolve(record, quality, signal, exclude, fresh),
    } satisfies LxSource,
  };
}

export interface LxConnectionOptions extends LxSourceOptions {
  /** 托管的 lxserver 服务实例；未配置自建服务器且组件已安装时启用 */
  readonly host?: LxHost | null;
}

/**
 * lxserver 连接生命周期管理
 *
 * 优先连接用户自建服务器（`music-source.v1.json`）；未配置时回退至本地托管实例，
 * 负责曲目目录缓存初始化与音源请求分发
 */
export async function startLxConnection(directory: string, options: LxConnectionOptions = {}) {
  const path = join(directory, 'music-source.v1.json');
  const host = options.host ?? null;
  let config: LxSourceConfig | null = null;
  let hosted: ReturnType<typeof hostedSource> | null = null;
  let source: LxSource | null = null;
  let catalog: Awaited<ReturnType<typeof startMusicCatalog>> | null = null;
  /** 自建服务配置解析状态；未配置时由托管组件就绪状态决定，详见 `phase()` */
  let configPhase: MusicStatus['lx'] = 'unconfigured';
  let changes: Promise<unknown> = Promise.resolve();

  /**
   * 切换音源配置（传入 null 表示切回本地托管实例）
   *
   * 释放前序目录缓存并建立新适配器；切换至自建服务时终止托管子进程，
   * 目录加载失败时保持连接可用但禁用检索与播放
   */
  async function switchTo(next: LxSourceConfig | null): Promise<void> {
    const old = catalog;
    config = next;
    hosted = null;
    source = null;
    catalog = null;
    configPhase = next ? 'catalog-unavailable' : 'unconfigured';
    await old?.dispose();
    if (next) {
      await host?.stop();
      source = startLxSource(next, options);
    } else if (host) {
      hosted = hostedSource(host, options);
      source = hosted.source;
    } else return;
    try {
      catalog = await startMusicCatalog(directory, next);
      if (next) configPhase = 'ready';
    } catch {
      // 目录数据损坏时保留原始文件，标记状态为 catalog-unavailable
    }
  }

  let initial: LxSourceConfig | null = null;
  try {
    initial = await readConfig(path);
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!missing) configPhase = 'invalid-config';
  }
  if (configPhase !== 'invalid-config') await switchTo(initial);

  const isHosted = () => !config && configPhase !== 'invalid-config' && !!host?.installed();

  function phase(): MusicStatus['lx'] {
    if (!isHosted()) return configPhase;
    return catalog ? 'ready' : 'catalog-unavailable';
  }

  function ready() {
    const current = phase();
    if (current === 'ready' && source && catalog) return { source, catalog };
    throw new MusicError(
      current === 'unconfigured'
        ? 'not-configured'
        : current === 'invalid-config'
          ? 'invalid-config'
          : 'catalog-unavailable',
    );
  }

  /**
   * 合并服务器配置与登录凭据
   *
   * 仅当服务源（origin）及用户名一致时复用已有令牌；
   * playerSession 仅在服务源未变更时保留，避免凭据泄露至异构端点
   */
  function merge(input: Exclude<MusicLxConfigRequest, { url: null }>): LxSourceConfig {
    let target: URL;
    try {
      target = new URL(input.url);
    } catch {
      throw new MusicError('invalid-request');
    }
    const sameOrigin = !!config && new URL(config.url).origin === target.origin;
    const sameUser = sameOrigin && config?.username === input.username;
    const userToken = input.userToken ?? (sameUser ? config?.userToken : undefined);
    if (input.username !== null && userToken === undefined) throw new MusicError('invalid-request');
    if (input.username === null && input.userToken !== undefined)
      throw new MusicError('invalid-request');
    const next = readLxConfig({
      schema: 1,
      url: input.url,
      ...(input.username === null ? {} : { username: input.username, userToken }),
      ...(sameOrigin && config?.playerSession ? { playerSession: config.playerSession } : {}),
    });
    if (!next) throw new MusicError('invalid-request');
    return next;
  }

  return {
    phase,
    /** 当前是否使用托管实例 */
    hosted: isHosted,
    /** 当前生效的服务源（origin），用于音频流路由安全校验 */
    origin: () => (config ? new URL(config.url).origin : (hosted?.origin() ?? null)),
    summary: (): MusicStatus['lxServer'] =>
      config
        ? { url: config.url, username: config.username ?? null, hasToken: !!config.userToken }
        : null,
    ready,
    /** 持久化配置并原子切换连接；并发配置请求排队串行处理 */
    configure(input: MusicLxConfigRequest): Promise<void> {
      const change = changes
        .catch(() => {})
        .then(async () => {
          if (input.url === null) {
            await unlink(path).catch((error: unknown) => {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                throw new MusicError('settings-unavailable');
            });
            await switchTo(null);
            return;
          }
          const next = merge(input);
          await writeStateFile(path, next);
          await switchTo(next);
        });
      changes = change;
      return change;
    },
    async test(signal: AbortSignal): Promise<MusicLxAuth> {
      if (!source || !config)
        throw new MusicError(
          configPhase === 'invalid-config' ? 'invalid-config' : 'not-configured',
        );
      const withToken = !!config.userToken;
      const valid = await source.verify(signal);
      return withToken ? (valid ? 'valid' : 'invalid') : 'none';
    },
    async dispose(): Promise<void> {
      await changes.catch(() => {});
      await catalog?.dispose();
    },
  };
}
