import { isSha256, isStableVersion, releaseFile, type ReleaseFile } from './contract.ts';
import { json, record } from './loaderContract.ts';

/** 后端与前端同版本；运行时另按精确发行身份复用。 */
export interface BackendManifest {
  readonly format: 1;
  readonly version: string;
  readonly protocol: 1;
  readonly backend: ReleaseFile;
  readonly runtime: ReleaseFile;
}

export interface RuntimePart extends ReleaseFile {
  readonly unpackedSize: number;
  readonly unpackedSha256: string;
}

export interface RuntimeManifest {
  readonly format: 1;
  readonly name: 'node';
  readonly version: string;
  readonly platform: 'win32';
  readonly arch: 'x64' | 'arm64';
  readonly compression: 'deflate-raw';
  readonly size: number;
  readonly sha256: string;
  readonly parts: readonly RuntimePart[];
  readonly license: ReleaseFile;
  readonly source: ReleaseFile;
}

export const BACKEND_MANIFEST_FILE = 'backend.json';
export const BACKEND_LIMIT = 16 * 1024 * 1024;
export const RUNTIME_MANIFEST_LIMIT = 256 * 1024;
export const RUNTIME_PART_LIMIT = 8 * 1024 * 1024;
export const RUNTIME_LIMIT = 192 * 1024 * 1024;

function size(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= limit;
}

/** 描述来自已安装前端包；调用方须先核对安装标记记录的文件哈希。 */
export function readBackendManifest(text: string, version: string): BackendManifest | null {
  const value = json(text);
  if (
    !record(value) ||
    value.format !== 1 ||
    value.version !== version ||
    !isStableVersion(value.version) ||
    value.protocol !== 1
  )
    return null;
  const backend = releaseFile(value.backend, BACKEND_LIMIT);
  const runtime = releaseFile(value.runtime, RUNTIME_MANIFEST_LIMIT);
  return backend && runtime
    ? { format: 1, version: value.version, protocol: 1, backend, runtime }
    : null;
}

/** 分块长度总和必须等于完整文件长度；URL、哈希和顺序共同确定组装结果。 */
export function readRuntimeManifest(text: string): RuntimeManifest | null {
  const value = json(text);
  if (
    !record(value) ||
    value.format !== 1 ||
    value.name !== 'node' ||
    !isStableVersion(value.version) ||
    value.platform !== 'win32' ||
    value.compression !== 'deflate-raw' ||
    !['x64', 'arm64'].includes(String(value.arch)) ||
    !size(value.size, RUNTIME_LIMIT) ||
    !isSha256(value.sha256) ||
    !Array.isArray(value.parts) ||
    value.parts.length === 0 ||
    value.parts.length > 96
  )
    return null;
  const parts: RuntimePart[] = [];
  const urls = new Set<string>();
  for (const item of value.parts) {
    const file = releaseFile(item, RUNTIME_PART_LIMIT);
    if (
      !file ||
      !record(item) ||
      !size(item.unpackedSize, RUNTIME_PART_LIMIT) ||
      !isSha256(item.unpackedSha256) ||
      urls.has(file.url)
    )
      return null;
    urls.add(file.url);
    parts.push({ ...file, unpackedSize: item.unpackedSize, unpackedSha256: item.unpackedSha256 });
  }
  if (parts.reduce((total, part) => total + part.unpackedSize, 0) !== value.size) return null;
  const license = releaseFile(value.license, 2 * 1024 * 1024);
  const source = releaseFile(value.source, RUNTIME_LIMIT);
  if (
    !license ||
    !source ||
    source.size !== value.size ||
    source.sha256 !== value.sha256 ||
    (value.arch !== 'x64' && value.arch !== 'arm64')
  )
    return null;
  return {
    format: 1,
    name: 'node',
    version: value.version,
    platform: 'win32',
    arch: value.arch,
    compression: 'deflate-raw',
    size: value.size,
    sha256: value.sha256,
    parts,
    license,
    source,
  };
}
