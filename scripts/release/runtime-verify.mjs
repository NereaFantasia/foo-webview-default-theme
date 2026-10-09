import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readRuntimeManifest } from '../../src/update/backendManifest.ts';
import { sha256 } from './artifacts.mjs';
import { DOWNLOAD_BASE } from './manifests.mjs';
import { downloadPublic } from './cnb.mjs';

/** @param {string} directory */
export function verifyRuntimeArtifacts(directory) {
  const bytes = new Uint8Array(readFileSync(join(directory, 'runtime.json')));
  return verifyBytes(bytes, (name) => new Uint8Array(readFileSync(join(directory, name))));
}

/** @param {Uint8Array} bytes @param {(name: string) => Uint8Array} load */
function verifyBytes(bytes, load) {
  const manifest = readRuntimeManifest(new TextDecoder().decode(bytes));
  if (!manifest) throw new Error('运行时清单无效');
  const tag = `rt-node-${manifest.version}-win-${manifest.arch}`;
  const base = `${DOWNLOAD_BASE}/${tag}`;
  if (
    manifest.source.url !==
    `https://nodejs.org/dist/v${manifest.version}/win-${manifest.arch}/node.exe`
  )
    throw new Error('运行时来源不是对应版本的官方文件');
  /** @type {import('./artifacts.mjs').Asset[]} */
  const assets = [{ name: 'runtime.json', bytes, sha256: sha256(bytes) }];
  /** @param {string} name @param {import('../../src/update/contract.ts').ReleaseFile} expected */
  function checked(name, expected) {
    const bytes = load(name);
    if (
      expected.url !== `${base}/${name}` ||
      expected.size !== bytes.length ||
      expected.sha256 !== sha256(bytes)
    )
      throw new Error(`运行时附件校验失败：${name}`);
    assets.push({ name, bytes, sha256: expected.sha256 });
    return bytes;
  }
  const complete = createHash('sha256');
  let length = 0;
  for (const [index, part] of manifest.parts.entries()) {
    const bytes = checked(`node.part${String(index).padStart(3, '0')}`, part);
    const raw = inflateRawSync(bytes, { maxOutputLength: part.unpackedSize });
    if (raw.length !== part.unpackedSize || sha256(raw) !== part.unpackedSha256)
      throw new Error('运行时分块解压校验失败');
    complete.update(raw);
    length += raw.length;
  }
  if (length !== manifest.size || complete.digest('hex') !== manifest.sha256)
    throw new Error('运行时完整文件校验失败');
  checked('LICENSE', manifest.license);
  return { tag, manifest, assets };
}

/** 主题引用的公共运行时必须已经完整可下载，才允许推进主题根清单。
 * @param {import('../../src/update/contract.ts').ReleaseFile} reference
 */
export async function verifyPublishedRuntime(reference) {
  const bytes = await downloadPublic(reference.url);
  if (!bytes || bytes.length !== reference.size || sha256(bytes) !== reference.sha256)
    throw new Error('公开运行时清单不可用或校验失败');
  const manifest = readRuntimeManifest(new TextDecoder().decode(bytes));
  if (!manifest) throw new Error('公开运行时清单无效');
  const base = `${DOWNLOAD_BASE}/rt-node-${manifest.version}-win-${manifest.arch}`;
  if (reference.url !== `${base}/runtime.json`) throw new Error('运行时清单地址与发行身份不符');
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (const part of [...manifest.parts, manifest.license]) {
    const name = part.url.slice(base.length + 1);
    if (!part.url.startsWith(`${base}/`) || !/^(?:node\.part\d{3}|LICENSE)$/.test(name))
      throw new Error('运行时附件地址无效');
    const content = await downloadPublic(part.url);
    if (!content || content.length !== part.size || sha256(content) !== part.sha256)
      throw new Error(`公开运行时附件不可用或校验失败：${name}`);
    files.set(name, content);
  }
  return verifyBytes(bytes, (name) => {
    const content = files.get(name);
    if (!content) throw new Error(`缺少运行时附件：${name}`);
    return content;
  });
}
