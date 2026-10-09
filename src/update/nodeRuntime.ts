import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { sha256 } from './contract.ts';
import type { RuntimeManifest } from './backendManifest.ts';
import {
  componentDirectories,
  freshComponentDirectory,
  verifiedLocal,
  type ComponentInstallOptions,
} from './componentFiles.ts';
import { json, record } from './loaderContract.ts';
import { fetchVerified, type ReleaseHttp } from './releaseFetch.ts';
import { TemplateFileError, type TemplateFiles } from './templateFiles.ts';
import { inflate } from './zipArchive.ts';

export interface InstalledRuntime {
  readonly directory: string;
  readonly executable: string;
  readonly version: string;
  readonly arch: RuntimeManifest['arch'];
  readonly sha256: string;
}

export interface RuntimeInstallHost {
  readonly file: Pick<typeof fb.file, 'list' | 'move'>;
  readonly http: ReleaseHttp;
}

export interface RuntimeInstallOptions extends ComponentInstallOptions {
  readonly selfTest: (runtime: InstalledRuntime) => Promise<void>;
}

/** UA Client Hints 报告的系统架构与版本。Windows 上的 UA 字符串固定为 x64，不能用来判断。 */
export interface PlatformHints {
  readonly architecture: string;
  readonly bitness: string;
  readonly platformVersion: string;
}

/** 页面不在安全上下文、接口缺失或读取失败时返回 null。 */
export async function readPlatformHints(): Promise<PlatformHints | null> {
  const data: unknown =
    typeof navigator === 'undefined' ? undefined : Reflect.get(navigator, 'userAgentData');
  const read: unknown = record(data) ? Reflect.get(data, 'getHighEntropyValues') : undefined;
  if (typeof read !== 'function') return null;
  try {
    const values: unknown = await Reflect.apply(read, data, [
      ['architecture', 'bitness', 'platformVersion'],
    ]);
    if (!record(values)) return null;
    const { architecture, bitness, platformVersion } = values;
    return typeof architecture === 'string' &&
      typeof bitness === 'string' &&
      typeof platformVersion === 'string'
      ? { architecture, bitness, platformVersion }
      : null;
  } catch {
    return null;
  }
}

/**
 * 只在能确定无法运行时返回 false：32 位系统，x64 机器上的 arm64 运行时，或 Windows 10 ARM 上的 x64
 * 运行时（x64 转译从 Windows 11 起才有）。其余情况交给下载后的自检。`platformVersion` 主版本 13 起为
 * Windows 11。
 */
export function runtimeRunsOn(arch: RuntimeManifest['arch'], hints: PlatformHints | null): boolean {
  if (!hints) return true;
  if (hints.bitness === '32') return false;
  if (hints.architecture === 'x86') return arch === 'x64';
  if (hints.architecture !== 'arm') return true;
  const major = Number.parseInt(hints.platformVersion, 10);
  return arch === 'arm64' || Number.isNaN(major) || major >= 13;
}

/** 运行时完整校验前只保留 partial 文件；已验证的块可以跨安装尝试复用。 */
export async function installNodeRuntime(
  files: TemplateFiles,
  host: RuntimeInstallHost,
  manifest: RuntimeManifest,
  options: RuntimeInstallOptions,
): Promise<InstalledRuntime> {
  const prefix = `node-${manifest.version}-${manifest.arch}`;
  const candidates = (await componentDirectories(files, host.file, 'rt', options.current))
    .filter(
      (name) =>
        name.startsWith(`${prefix}_`) && /^node-[\d.]+-(?:x64|arm64)_[a-z0-9]{6}$/.test(name),
    )
    .map((name) => `rt/${name}`);
  const installed = (directory: string): InstalledRuntime => ({
    directory,
    executable: `${directory}/node.exe`,
    version: manifest.version,
    arch: manifest.arch,
    sha256: manifest.sha256,
  });
  async function publish(directory: string): Promise<InstalledRuntime> {
    options.current();
    await files.writeText(
      `${directory}/installed.json`,
      JSON.stringify({
        schema: 1,
        version: manifest.version,
        arch: manifest.arch,
        sha256: manifest.sha256,
        size: manifest.size,
        licenseSha256: manifest.license.sha256,
      }),
      { atomic: true },
    );
    return installed(directory);
  }
  for (const directory of candidates) {
    const marker = json(await files.readText(`${directory}/installed.json`));
    if (
      (await verifiedLocal(options, `${directory}/node.exe`, manifest)) &&
      (await verifiedLocal(options, `${directory}/LICENSE`, manifest.license))
    ) {
      const runtime = installed(directory);
      await options.selfTest(runtime);
      return record(marker) &&
        marker.schema === 1 &&
        marker.sha256 === manifest.sha256 &&
        marker.version === manifest.version &&
        marker.arch === manifest.arch
        ? runtime
        : publish(directory);
    }
    await options.pause();
  }
  const directory = await freshComponentDirectory(files, `rt/${prefix}`, options);
  files.path(`${directory}/installed.json`, true);
  const partial = `${directory}/node.exe.partial`;
  for (const file of [
    partial,
    `${directory}/node.exe`,
    `${directory}/LICENSE`,
    `${directory}/.parts/part000`,
  ])
    files.path(file);
  let count = 0;
  for (const [index, part] of manifest.parts.entries()) {
    options.current();
    const name = `part${String(index).padStart(3, '0')}`;
    files.path(`${directory}/.parts/${name}`);
    let compressed: Uint8Array<ArrayBuffer> | null = null;
    for (const prior of candidates) {
      const cached = await files.readBytes(`${prior}/.parts/${name}`).catch(() => {
        options.current();
        return null;
      });
      if (cached && cached.length === part.size && (await sha256(cached)) === part.sha256) {
        compressed = cached;
        break;
      }
      await options.pause();
    }
    if (!compressed) {
      const downloaded = await fetchVerified(host.http, part.url, { ...part, limit: part.size });
      options.current();
      if (!downloaded.ok) throw new Error(`运行时下载失败：${downloaded.problem}`);
      compressed = downloaded.value;
    }
    await files.writeBytes(`${directory}/.parts/${name}`, compressed);
    await options.pause();
    const expanded = await inflate(compressed, part.unpackedSize);
    if ((await sha256(expanded)) !== part.unpackedSha256) throw new Error('运行时分块校验失败');
    await files.writeBytes(partial, expanded, { append: count > 0 });
    count += 1;
    options.progress?.(count, manifest.parts.length);
    await options.pause();
  }
  if (!(await verifiedLocal(options, partial, manifest))) throw new Error('运行时完整性校验失败');
  const license = await fetchVerified(host.http, manifest.license.url, {
    ...manifest.license,
    limit: manifest.license.size,
  });
  options.current();
  if (!license.ok) throw new Error('运行时许可下载失败');
  await files.writeBytes(`${directory}/LICENSE`, license.value);
  if (!(await verifiedLocal(options, `${directory}/LICENSE`, manifest.license)))
    throw new Error('运行时许可校验失败');
  options.current();
  const moved = await settle(() =>
    host.file.move(files.path(partial), files.path(`${directory}/node.exe`)),
  );
  options.current();
  if (!moved || moved.success === false) throw new TemplateFileError('write', partial);
  if (!(await verifiedLocal(options, `${directory}/node.exe`, manifest)))
    throw new Error('运行时移动后校验失败');
  await options.selfTest(installed(directory));
  return publish(directory);
}
