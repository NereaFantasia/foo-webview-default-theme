import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NcmComponentState, NcmInstallFailure } from '../../src/server/ncmComponent.ts';
import { readZip } from '../../src/update/zipArchive.ts';

/**
 * 远程音源扩展组件清单规格
 *
 * 描述网易云或 lxserver 外部组件的分发元数据；分发清单经签名校验后载入，
 * 包含版本、下载端点、校验哈希与安装大小限制
 */
export interface ComponentPackage {
  readonly version: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
  readonly unpackedSize: number;
  readonly licenses: readonly string[];
}

export type ComponentName = 'ncm' | 'lxserver';

export const COMPONENT_MARKER = 'installed.json';
const MAX_SIZE = 128 * 1024 * 1024;
const MAX_UNPACKED = 256 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function size(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= limit;
}

export function readComponentPackage(text: string, name: ComponentName): ComponentPackage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !record(value) ||
    value.format !== 1 ||
    value.name !== name ||
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    typeof value.url !== 'string' ||
    !value.url.startsWith('https://') ||
    !size(value.size, MAX_SIZE) ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    !size(value.unpackedSize, MAX_UNPACKED) ||
    !Array.isArray(value.licenses) ||
    value.licenses.length > 100
  )
    return null;
  const licenses = value.licenses.filter(
    (item): item is string => typeof item === 'string' && /^\S.{0,126}$/.test(item),
  );
  if (licenses.length !== value.licenses.length) return null;
  try {
    new URL(value.url);
  } catch {
    return null;
  }
  return {
    version: value.version,
    url: value.url,
    size: value.size,
    sha256: value.sha256,
    unpackedSize: value.unpackedSize,
    licenses,
  };
}

export function readNcmPackage(text: string): ComponentPackage | null {
  return readComponentPackage(text, 'ncm');
}

/** 包含版本号的组件安装路径；升级时并存隔离，避免就地覆盖正在运行的实例 */
export function componentDirectory(
  components: string,
  name: ComponentName,
  version: string,
): string {
  return join(components, `${name}-${version}`);
}

class InstallFailure extends Error {
  readonly reason: NcmInstallFailure;
  constructor(reason: NcmInstallFailure) {
    super(reason);
    this.reason = reason;
  }
}

export interface ComponentInstallOptions {
  /** 组件标识；省略时默认为 ncm */
  readonly name?: ComponentName;
  /** 扩展组件根目录 */
  readonly components: string;
  readonly package: ComponentPackage | null;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** 安装成功回调；由当前进程或并发进程完成均触发 */
  readonly onInstalled?: () => void;
}

export type ComponentInstall = ReturnType<typeof startComponentInstall>;

export function startComponentInstall(options: ComponentInstallOptions) {
  const name = options.name ?? 'ncm';
  const component = options.package;
  const target = component ? componentDirectory(options.components, name, component.version) : null;
  const lifetime = new AbortController();
  const installed = () => target !== null && existsSync(join(target, COMPONENT_MARKER));
  let phase: NcmComponentState['phase'] = installed() ? 'installed' : 'missing';
  let received = 0;
  let failure: NcmInstallFailure | null = null;
  let running = false;

  // 全量下载至内存校验 SHA-256 后解压；中断后重新完整下载
  async function download(source: ComponentPackage): Promise<Uint8Array<ArrayBuffer>> {
    const signal = AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(options.timeoutMs ?? 10 * 60 * 1000),
    ]);
    const bytes = new Uint8Array(source.size);
    const hash = createHash('sha256');
    try {
      const response = await (options.fetch ?? fetch)(source.url, { signal });
      if (!response.ok || !response.body) throw new InstallFailure('download');
      const reader = response.body.getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        if (received + chunk.value.length > source.size) {
          void reader.cancel();
          throw new InstallFailure('verify');
        }
        bytes.set(chunk.value, received);
        received += chunk.value.length;
        hash.update(chunk.value);
      }
    } catch (error) {
      throw error instanceof InstallFailure ? error : new InstallFailure('download');
    }
    if (received !== source.size || hash.digest('hex') !== source.sha256)
      throw new InstallFailure('verify');
    return bytes;
  }

  /** 解压至临时目录并写入安装凭证文件后原子重命名，保证安装完整性 */
  async function extract(source: ComponentPackage, bytes: Uint8Array<ArrayBuffer>, into: string) {
    const reading = await readZip(bytes);
    if (!reading.ok) throw new InstallFailure('verify');
    const temp = join(
      options.components,
      `.${name}-${source.version}-${randomBytes(4).toString('hex')}`,
    );
    try {
      for (const file of reading.files) {
        const path = join(temp, ...file.path.split('/'));
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.bytes, { flag: 'wx' });
      }
      const marker = { format: 1, version: source.version, sha256: source.sha256 };
      await writeFile(join(temp, COMPONENT_MARKER), JSON.stringify(marker) + '\n', { flag: 'wx' });
      await rename(temp, into);
    } catch {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
      // 重命名冲突：并发后端进程已先完成同版本安装
      if (!installed()) throw new InstallFailure('write');
    }
  }

  async function run(source: ComponentPackage, into: string): Promise<void> {
    running = true;
    phase = 'downloading';
    received = 0;
    failure = null;
    try {
      if (!installed()) {
        const bytes = await download(source);
        phase = 'installing';
        await extract(source, bytes, into);
      }
      phase = 'installed';
      options.onInstalled?.();
    } catch (error) {
      phase = 'missing';
      failure = error instanceof InstallFailure ? error.reason : 'write';
    } finally {
      running = false;
    }
  }

  return {
    /** 组件所在目录；后端没有登记组件时为 null */
    directory: target,
    state(): NcmComponentState {
      return {
        package: component && {
          version: component.version,
          size: component.size,
          unpackedSize: component.unpackedSize,
          licenses: component.licenses,
        },
        phase,
        received,
        failure,
      };
    },
    /** 触发后台异步安装；若已就绪、正在执行或未声明组件包则忽略请求 */
    install(): void {
      if (!component || !target || running || phase === 'installed') return;
      void run(component, target);
    },
    dispose(): void {
      lifetime.abort();
    },
  };
}
