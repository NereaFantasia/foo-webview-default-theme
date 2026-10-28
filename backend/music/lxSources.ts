import type { MusicLxSource } from '../../src/server/musicLxSources.ts';
import type { LxHost } from './lxHost.ts';
import {
  cleanMessage,
  isRecord,
  LX_PLATFORMS,
  lxRequest,
  type LxSourceOptions,
} from './lxSource.ts';
import { MusicError } from './musicError.ts';
import {
  empty,
  lxSourceAddRequest,
  lxSourceIdRequest,
  lxSourceOrderRequest,
  lxSourceToggleRequest,
} from './musicRequests.ts';

/** 自定义音源脚本大小上限（1 MB） */
export const MAX_SCRIPT_BYTES = 1024 * 1024;

/** 音源管理的路由动作，写操作完成后都答最新的音源列表 */
export const LX_SOURCE_ACTIONS = [
  'lx-sources',
  'lx-source-add',
  'lx-source-toggle',
  'lx-source-delete',
  'lx-source-order',
] as const;

export type LxSourceAction = (typeof LX_SOURCE_ACTIONS)[number];

export function isLxSourceAction(action: string): action is LxSourceAction {
  return LX_SOURCE_ACTIONS.some((item) => item === action);
}

function optional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 512) : null;
}

function platformsOf(value: unknown) {
  const supported = Array.isArray(value) ? value : [];
  return LX_PLATFORMS.filter((platform) => supported.includes(platform));
}

function readSource(value: unknown): MusicLxSource | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 256)
    return null;
  return {
    id: value.id,
    name: optional(value.name) ?? value.id,
    version: optional(value.version),
    author: optional(value.author),
    description: optional(value.description),
    platforms: platformsOf(value.supportedSources),
    enabled: value.enabled === true,
    failed: value.enabled === true && value.status === 'failed',
    error: value.enabled === true && value.status === 'failed' ? cleanMessage(value.error) : null,
    health: {},
  };
}

/** 读取响应流文本并限制最大字节数；超出配额时中止读取并抛出错误 */
async function readScript(response: Response): Promise<string> {
  if (!response.body) throw new MusicError('source-rejected');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > MAX_SCRIPT_BYTES) throw new MusicError('source-rejected');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 托管 lxserver 音源脚本管理
 *
 * 提供音源脚本的列表查询、上传导入、状态切换、删除与解析优先级排序；
 * 内部自动注入服务连接与管理认证凭据
 */
export function startLxSources(host: LxHost, options: LxSourceOptions = {}) {
  async function request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    failure?: 'source-rejected',
  ) {
    const { url, adminPassword } = await host.connect();
    return lxRequest({ schema: 1, url, adminPassword }, options)(path, signal, body, failure);
  }

  async function list(signal: AbortSignal): Promise<MusicLxSource[]> {
    const value = await request('api/custom-source/list', signal);
    if (!Array.isArray(value)) throw new MusicError('invalid-upstream');
    return value.flatMap((item) => readSource(item) ?? []);
  }

  async function toggle(id: string, enabled: boolean, signal: AbortSignal): Promise<void> {
    // 启用时由服务端执行沙箱加载；若脚本要求不安全权限则服务端拒绝并回滚
    const value = await request(
      'api/custom-source/toggle',
      signal,
      { id, enabled },
      enabled ? 'source-rejected' : undefined,
    );
    if (!isRecord(value) || value.success !== true) throw new MusicError('source-rejected');
  }

  async function remove(id: string, signal: AbortSignal): Promise<void> {
    await request('api/custom-source/delete', signal, { id });
  }

  /**
   * 导入并启用音源脚本
   *
   * 上传后验证其支持的目标平台与沙箱兼容性；若校验失败或启用异常则回滚删除已上传脚本
   */
  async function add(name: string, script: string, signal: AbortSignal): Promise<void> {
    if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) throw new MusicError('invalid-request');
    const value = await request(
      'api/custom-source/upload',
      signal,
      { filename: name, content: script },
      'source-rejected',
    );
    if (!isRecord(value) || value.success !== true || typeof value.id !== 'string')
      throw new MusicError('source-rejected');
    const id = value.id;
    try {
      if (!platformsOf(value.supportedSources).length) throw new MusicError('source-rejected');
      await toggle(id, true, signal);
    } catch (error) {
      // 客户端中断时执行清理，使用独立超时信号确保未完成文件彻底删除
      await remove(id, AbortSignal.timeout(30000)).catch(() => {});
      throw error;
    }
  }

  /** 从远程 URL 下载并导入音源脚本 */
  async function addFromUrl(address: string, signal: AbortSignal): Promise<void> {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      throw new MusicError('invalid-request');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new MusicError('invalid-request');
    const timeout = AbortSignal.timeout(30000);
    let script: string;
    try {
      const response = await (options.fetch ?? fetch)(url, {
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MusicError('upstream-unavailable');
      }
      script = await readScript(response);
    } catch (error) {
      if (signal.aborted) throw new MusicError('cancelled');
      if (timeout.aborted) throw new MusicError('timeout');
      throw error instanceof MusicError ? error : new MusicError('upstream-unavailable');
    }
    // 提取 URL 文件名作为后备脚本名称；最终音源 ID 由服务端解析脚本元数据生成
    const name = url.pathname.split('/').pop() || 'source.js';
    await add(name, script, signal);
  }

  async function reorder(ids: readonly string[], signal: AbortSignal): Promise<void> {
    await request('api/custom-source/reorder', signal, { sourceIds: ids });
  }

  /** 校验请求体、执行动作，再答最新的音源列表 */
  async function run(
    action: LxSourceAction,
    body: unknown,
    signal: AbortSignal,
  ): Promise<MusicLxSource[]> {
    switch (action) {
      case 'lx-sources':
        empty(body);
        break;
      case 'lx-source-add': {
        const input = lxSourceAddRequest(body);
        await ('url' in input
          ? addFromUrl(input.url, signal)
          : add(input.name, input.script, signal));
        break;
      }
      case 'lx-source-toggle': {
        const input = lxSourceToggleRequest(body);
        await toggle(input.id, input.enabled, signal);
        break;
      }
      case 'lx-source-delete':
        await remove(lxSourceIdRequest(body), signal);
        break;
      case 'lx-source-order':
        await reorder(lxSourceOrderRequest(body), signal);
        break;
    }
    // 音源有了增减、启停或调序，之前记下的失败不再作数
    if (action !== 'lx-sources') options.book?.clear();
    return list(signal);
  }

  return { list, add, addFromUrl, toggle, remove, reorder, run };
}
