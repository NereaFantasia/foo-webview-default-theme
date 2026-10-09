import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { readRuntimeManifest } from '../../src/update/backendManifest.ts';
import { isStableVersion } from '../../src/update/contract.ts';
import { DOWNLOAD_BASE } from './manifests.mjs';

/** @param {Uint8Array} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PART_SIZE = 4 * 1024 * 1024;

/**
 * @param {{ version: string, arch: 'x64' | 'arm64', node: Uint8Array, license: Uint8Array,
 *   source: { url: string, size: number, sha256: string } }} input
 */
export function runtimeArtifacts(input) {
  if (
    !isStableVersion(input.version) ||
    !input.license.length ||
    input.source.size !== input.node.length ||
    input.source.sha256 !== hash(input.node)
  )
    throw new Error('运行时来源或许可校验失败');
  const tag = `rt-node-${input.version}-win-${input.arch}`;
  const url = (/** @type {string} */ name) => `${DOWNLOAD_BASE}/${tag}/${name}`;
  /** @type {{ name: string, bytes: Uint8Array }[]} */
  const assets = [];
  /** @type {import('../../src/update/backendManifest.ts').RuntimePart[]} */
  const parts = [];
  for (let offset = 0; offset < input.node.length; offset += PART_SIZE) {
    const raw = input.node.slice(offset, offset + PART_SIZE);
    const bytes = new Uint8Array(deflateRawSync(raw));
    const name = `node.part${String(parts.length).padStart(3, '0')}`;
    assets.push({ name, bytes });
    parts.push({
      url: url(name),
      size: bytes.length,
      sha256: hash(bytes),
      unpackedSize: raw.length,
      unpackedSha256: hash(raw),
    });
  }
  assets.push({ name: 'LICENSE', bytes: input.license });
  const text =
    JSON.stringify(
      {
        format: 1,
        name: 'node',
        version: input.version,
        platform: 'win32',
        arch: input.arch,
        compression: 'deflate-raw',
        size: input.node.length,
        sha256: hash(input.node),
        parts,
        license: { url: url('LICENSE'), size: input.license.length, sha256: hash(input.license) },
        source: input.source,
      },
      null,
      2,
    ) + '\n';
  const manifest = readRuntimeManifest(text);
  if (!manifest) throw new Error('客户端不接受运行时清单');
  assets.push({ name: 'runtime.json', bytes: new TextEncoder().encode(text) });
  return { tag, manifest, assets };
}
